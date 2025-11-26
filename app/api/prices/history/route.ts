import { NextResponse } from 'next/server';
import pdfParse from 'pdf-parse';

interface ProductPrice {
  name: string;
  presentation: string;
  quantity: string;
  unit: string;
  extraQualityPrice: string;
  firstQualityPrice: string;
  unitPrice: string;
  previousDayVariation: string;
}

interface DateSummary {
  date: string;
  totalProductos: number;
  status: 'success' | 'error' | 'not_found';
  fuente: string;
  error?: string;
}

// Force dynamic rendering to avoid caching issues with large PDFs
export const dynamic = 'force-dynamic';

/**
 * @swagger
 * /api/prices/history:
 *   get:
 *     summary: Get historical product prices from Corabastos daily bulletins
 *     description: Downloads and parses multiple daily bulletin PDFs within a date range to extract product prices
 *     tags:
 *       - Prices
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date in format YYYY-MM-DD (e.g., 2025-11-20)
 *         example: "2025-11-20"
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: End date in format YYYY-MM-DD (e.g., 2025-11-25)
 *         example: "2025-11-25"
 *     responses:
 *       200:
 *         description: Summary of processed dates with product counts (products data not included, ready for database storage)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 from:
 *                   type: string
 *                 to:
 *                   type: string
 *                 totalDays:
 *                   type: number
 *                 processedDays:
 *                   type: number
 *                 successfulDays:
 *                   type: number
 *                 failedDays:
 *                   type: number
 *                 totalProductos:
 *                   type: number
 *                 summary:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                       totalProductos:
 *                         type: number
 *                       status:
 *                         type: string
 *                       fuente:
 *                         type: string
 *                       error:
 *                         type: string
 *       400:
 *         description: Invalid date format or date range
 *       500:
 *         description: Error processing the request
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    // Validate required parameters
    if (!fromParam || !toParam) {
      return NextResponse.json(
        { error: 'Both "from" and "to" date parameters are required. Format: YYYY-MM-DD' },
        { status: 400 }
      );
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(fromParam) || !dateRegex.test(toParam)) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD (e.g., 2025-11-20)' },
        { status: 400 }
      );
    }

    // Parse dates
    const fromDate = new Date(fromParam);
    const toDate = new Date(toParam);

    // Validate dates
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date. Please provide valid dates in format YYYY-MM-DD' },
        { status: 400 }
      );
    }

    // Validate date range
    if (fromDate > toDate) {
      return NextResponse.json(
        { error: '"from" date must be before or equal to "to" date' },
        { status: 400 }
      );
    }

    // Generate array of dates in range
    const dates: Date[] = [];
    const currentDate = new Date(fromDate);
    while (currentDate <= toDate) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Process dates in batches to avoid timeout (process 5 dates at a time)
    const batchSize = 5;
    const summary: DateSummary[] = [];
    let totalProductos = 0;

    for (let i = 0; i < dates.length; i += batchSize) {
      const batch = dates.slice(i, i + batchSize);
      
      const batchResults = await Promise.allSettled(
        batch.map(async (date) => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const dateStr = `${year}${month}${day}`;
          const pdfUrl = `https://corabastos.com.co/wp-content/uploads/${year}/${month}/Boletin_diario_${dateStr}.pdf`;

          try {
            // Download the PDF with timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout per PDF

            const response = await fetch(pdfUrl, {
              cache: 'no-store',
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              return {
                date: `${year}-${month}-${day}`,
                totalProductos: 0,
                status: 'not_found' as const,
                fuente: pdfUrl,
                error: `PDF not found or could not be downloaded (${response.status})`,
              };
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // Parse the PDF
            const data = await pdfParse(buffer);
            const text = data.text;

            // Extract prices from parsed text
            const productos = extractPrices(text);
            totalProductos += productos.length;

            return {
              date: `${year}-${month}-${day}`,
              totalProductos: productos.length,
              status: 'success' as const,
              fuente: pdfUrl,
            };
          } catch (error) {
            return {
              date: `${year}-${month}-${day}`,
              totalProductos: 0,
              status: 'error' as const,
              fuente: pdfUrl,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );

      // Process batch results
      batchResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          summary.push(result.value);
        } else {
          // This shouldn't happen with Promise.allSettled, but handle it just in case
          summary.push({
            date: 'unknown',
            totalProductos: 0,
            status: 'error',
            fuente: '',
            error: result.reason?.message || 'Unknown error',
          });
        }
      });
    }

    const successfulDays = summary.filter((s) => s.status === 'success').length;
    const failedDays = summary.filter((s) => s.status !== 'success').length;

    return NextResponse.json({
      from: fromParam,
      to: toParam,
      totalDays: dates.length,
      processedDays: summary.length,
      successfulDays,
      failedDays,
      totalProductos,
      summary,
      message: 'Data processed successfully. Products are ready to be stored in database. Use individual date endpoints to retrieve full product details if needed.',
    });
  } catch (error) {
    console.error('Error processing historical data:', error);
    return NextResponse.json(
      { error: 'Error processing historical data', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * Extracts product prices from PDF text by detecting table structure
 */
function extractPrices(text: string): ProductPrice[] {
  const productos: ProductPrice[] = [];
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);

  // Table header keywords to detect (can be split across multiple lines)
  const headerKeywords = [
    'nombre',
    'presentación',
    'cantidad',
    'unidad',
    'medida',
    'precio',
    'calidad',
    'extra',
    'primera',
    'unidad',
    'variación',
    'día',
    'anterior',
  ];

  let inTable = false;
  let headerFound = false;
  let headerLines: string[] = [];
  const requiredHeaderWords = ['nombre', 'presentación', 'cantidad', 'precio'];

  // First, find where the table starts (header detection)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    const originalLine = lines[i];

    // Collect potential header lines (lines containing header keywords)
    const hasHeaderKeyword = headerKeywords.some((keyword) => line.includes(keyword));

    if (hasHeaderKeyword && !headerFound) {
      headerLines.push(originalLine);
      // Check if we have enough header words across collected lines
      const combinedHeaders = headerLines.join(' ').toLowerCase();
      const foundRequiredWords = requiredHeaderWords.filter((word) =>
        combinedHeaders.includes(word)
      );

      if (foundRequiredWords.length >= 3) {
        // Found table header, start extracting from next lines
        headerFound = true;
        inTable = true;
        continue;
      }
    } else if (headerFound && !inTable) {
      // Reset if we haven't found the header yet
      headerLines = [];
    }

    // If we found the header, start processing table rows
    if (headerFound && inTable) {
      // If we encounter a new header line while in table mode, it might be a new table
      if (hasHeaderKeyword && productos.length > 0) {
        // This could be a new table, but continue processing current one
        // Just skip this header line
        continue;
      }

      // Check if this is a valid table row
      const row = parseTableRow(lines[i]);
      if (row) {
        productos.push(row);
      } else {
        // If we can't parse a row and we've been in table mode,
        // check if we've reached the end of the table
        if (lines[i].length === 0 || isNewSection(lines[i])) {
          inTable = false;
        }
      }
    }
  }

  return productos;
}

/**
 * Parses a table row into ProductPrice object
 * Expected format: "ALAS DE POLLO KILO 1 KILO $16,000 $16,000 $16,000 Estable"
 * Structure: [Name (multiple words)] [Presentation] [Quantity] [Unit] [Price1] [Price2] [Price3] [Variation]
 */
function parseTableRow(line: string): ProductPrice | null {
  // Remove extra spaces and normalize
  const normalized = line.replace(/\s+/g, ' ').trim();

  // Pattern to match prices: $16,000 or $16.000 or $16000 (must start with $ and have digits)
  // Matches: $ followed by digits, with optional commas/dots as thousands separators
  const pricePattern = /\$[\d.,]+/g;
  const priceMatches = normalized.match(pricePattern);

  // Filter to ensure we have valid price formats (at least 4 digits total)
  const validPrices = priceMatches?.filter((price) => {
    const digitsOnly = price.replace(/[$,.]/g, '');
    return digitsOnly.length >= 4; // At least 4 digits for a valid price
  });

  // We need exactly 3 valid prices
  if (!validPrices || validPrices.length < 3) {
    return null;
  }

  // Get the last 3 prices (in case there are more numbers in the name)
  const lastThreePrices = validPrices.slice(-3);

  // Find the position of the first price in the string
  const firstPriceIndex = normalized.indexOf(lastThreePrices[0]);
  if (firstPriceIndex === -1) {
    return null;
  }

  // Extract everything before the first price
  const beforePrices = normalized.substring(0, firstPriceIndex).trim();
  const beforeParts = beforePrices.split(/\s+/);

  // Extract variation (everything after the last price)
  const lastPriceIndex = normalized.lastIndexOf(lastThreePrices[2]);
  const afterLastPrice = normalized.substring(lastPriceIndex + lastThreePrices[2].length).trim();
  const variation = afterLastPrice || '';

  // We need at least 4 parts before prices: name, presentation, quantity, unit
  if (beforeParts.length < 4) {
    return null;
  }

  // The structure before prices is: [Name...] [Presentation] [Quantity] [Unit]
  // The last 3 items are: presentation, quantity, unit
  // Everything before that is the product name
  const unit = beforeParts[beforeParts.length - 1];
  const quantity = beforeParts[beforeParts.length - 2];
  const presentation = beforeParts[beforeParts.length - 3];
  const name = beforeParts.slice(0, beforeParts.length - 3).join(' ');

  // Validate that we have meaningful data
  // Quantity should be a number
  if (!name || !presentation || !/^\d+$/.test(quantity) || !unit) {
    return null;
  }

  // Clean prices (remove $ and keep digits, but preserve format for display)
  const cleanPrice = (price: string) => {
    // Remove $ and keep the number with commas/dots
    return price.replace('$', '').trim();
  };

  return {
    name: name.trim(),
    presentation: presentation.trim(),
    quantity: quantity.trim(),
    unit: unit.trim(),
    extraQualityPrice: `$${cleanPrice(lastThreePrices[0])}`,
    firstQualityPrice: `$${cleanPrice(lastThreePrices[1])}`,
    unitPrice: `$${cleanPrice(lastThreePrices[2])}`,
    previousDayVariation: variation.trim() || 'N/A',
  };
}

/**
 * Checks if a line indicates a new section (end of table)
 */
function isNewSection(line: string): boolean {
  const sectionIndicators = [/^página/i, /^total/i, /^resumen/i, /^nota/i, /^fuente/i];

  return sectionIndicators.some((pattern) => pattern.test(line));
}

