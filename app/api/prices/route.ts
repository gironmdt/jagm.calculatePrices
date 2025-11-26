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

// Force dynamic rendering to avoid caching issues with large PDFs
export const dynamic = 'force-dynamic';

/**
 * @swagger
 * /api/prices:
 *   get:
 *     summary: Get product prices from Corabastos daily bulletin
 *     description: Downloads and parses the daily bulletin PDF to extract product prices. Date parameter is optional, defaults to today.
 *     tags:
 *       - Prices
 *     parameters:
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: Date in format YYYY-MM-DD (e.g., 2025-11-20). If not provided, uses today's date.
 *         example: "2025-11-20"
 *     responses:
 *       200:
 *         description: List of products with their prices
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 fecha:
 *                   type: string
 *                   example: "2025-11-21"
 *                 productos:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       presentation:
 *                         type: string
 *                       quantity:
 *                         type: string
 *                       unit:
 *                         type: string
 *                       extraQualityPrice:
 *                         type: string
 *                       firstQualityPrice:
 *                         type: string
 *                       unitPrice:
 *                         type: string
 *                       previousDayVariation:
 *                         type: string
 *       400:
 *         description: Invalid date format
 *       500:
 *         description: Error processing the PDF
 */
export async function GET(request: Request) {
  try {
    // Get date parameter from query string
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');

    // Parse and validate date
    let targetDate: Date;
    if (dateParam) {
      // Validate date format (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(dateParam)) {
        return NextResponse.json(
          { error: 'Invalid date format. Use YYYY-MM-DD (e.g., 2025-11-20)' },
          { status: 400 }
        );
      }

      targetDate = new Date(dateParam);
      // Check if date is valid
      if (isNaN(targetDate.getTime())) {
        return NextResponse.json(
          { error: 'Invalid date. Please provide a valid date in format YYYY-MM-DD' },
          { status: 400 }
        );
      }
    } else {
      // Use today's date if no date provided
      targetDate = new Date();
    }

    // Format date for URL: YYYY/MM/DD -> YYYY/MM/Boletin_diario_YYYYMMDD.pdf
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const day = String(targetDate.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;

    // Build PDF URL
    const pdfUrl = `https://corabastos.com.co/wp-content/uploads/${year}/${month}/Boletin_diario_${dateStr}.pdf`;

    // Download the PDF (disable cache to avoid Next.js 2MB limit)
    const response = await fetch(pdfUrl, {
      cache: 'no-store',
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: 'Could not download the PDF' },
        { status: 500 }
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Parse the PDF
    const data = await pdfParse(buffer);
    const text = data.text;
    // Extract prices from parsed text
    const productos = extractPrices(text);

    // Use the provided date or extracted date from PDF
    const fecha = extractDate(text) || `${year}-${month}-${day}`;

    return NextResponse.json({
      fecha,
      totalProductos: productos.length,
      productos,
      fuente: pdfUrl,
    });
  } catch (error) {
    console.error('Error processing PDF:', error);
    return NextResponse.json(
      { error: 'Error processing the PDF', details: String(error) },
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
      // Format: "VALENTON KILO 1 KILO $35,000 $35,000 $35,000 Estable"
      // Should have: name, presentation, quantity, unit, 3 prices, variation
      const row = parseTableRow(lines[i]);
      if (row) {
        productos.push(row);
      } else {
        // If we can't parse a row and we've been in table mode,
        // check if we've reached the end of the table
        // (empty line or new section)
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
  const sectionIndicators = [
    /^página/i,
    /^total/i,
    /^resumen/i,
    /^nota/i,
    /^fuente/i,
  ];

  return sectionIndicators.some((pattern) => pattern.test(line));
}

/**
 * Extracts date from PDF text
 */
function extractDate(text: string): string | null {
  // Search for common date patterns
  const datePatterns = [
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
    /(\d{4})-(\d{1,2})-(\d{1,2})/,
    /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      // Format as YYYY-MM-DD
      if (pattern === datePatterns[0]) {
        // DD/MM/YYYY
        return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
      } else if (pattern === datePatterns[1]) {
        // YYYY-MM-DD
        return match[0];
      }
    }
  }

  return null;
}

