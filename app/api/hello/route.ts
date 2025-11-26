import { NextResponse } from 'next/server';

/**
 * @swagger
 * /api/hello:
 *   get:
 *     summary: Example dummy endpoint
 *     description: Returns a simple greeting message
 *     tags:
 *       - Example
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Hello from the API!"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2024-01-01T00:00:00.000Z"
 */
export async function GET() {
  return NextResponse.json({
    message: 'Hola desde la API!',
    timestamp: new Date().toISOString(),
  });
}

