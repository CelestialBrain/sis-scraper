/**
 * PDF text extraction via pdfjs-dist
 *
 * Replaces Python pdfplumber. Extracts text items with positions from each page
 * so downstream table detection can reconstruct tabular structure.
 */

import { createRequire } from 'module';
import type { TextItem, PageTextItems } from '../types.js';

// pdfjs-dist ships ESM under legacy/build for Node
let pdfjsLib: typeof import('pdfjs-dist');

let standardFontDataUrl: string | undefined;

async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

    // Point to the bundled worker for Node.js
    const require = createRequire(import.meta.url);
    const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;

    // Resolve standard font data path to suppress warnings
    try {
      const fontDir = require.resolve('pdfjs-dist/standard_fonts/FoxitSans.pfb');
      standardFontDataUrl = 'file://' + fontDir.replace(/\/[^/]+$/, '/');
    } catch {
      // Fallback: font data may not be available
    }
  }
  return pdfjsLib;
}

/**
 * Extract text items with positions from every page of a PDF buffer.
 */
export async function extractPdfPages(
  data: ArrayBuffer | Uint8Array,
): Promise<PageTextItems[]> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({
    data: data instanceof Uint8Array ? new Uint8Array(data) : data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    standardFontDataUrl,
    disableAutoFetch: true,
  }).promise;
  const pages: PageTextItems[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.0 });
    const content = await page.getTextContent();

    const items: TextItem[] = [];

    for (const raw of content.items) {
      // Skip marker items that have no string
      if (!('str' in raw)) continue;
      const item = raw as {
        str: string;
        transform: number[];
        width: number;
        height: number;
        fontName: string;
      };

      if (!item.str.trim()) continue;

      // transform[4] = x, transform[5] = y (from bottom)
      // Convert y to top-down coordinate
      const x = item.transform[4];
      const y = viewport.height - item.transform[5];

      items.push({
        text: item.str.trim(),
        x,
        y,
        width: item.width,
        height: Math.abs(item.transform[3]) || item.height,
        font_name: item.fontName || '',
      });
    }

    pages.push({
      page_number: i,
      width: viewport.width,
      height: viewport.height,
      item: items,
    });
  }

  doc.destroy();
  return pages;
}
