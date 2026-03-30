/**
 * Parser router — detects PDF layout and delegates to the appropriate parser
 *
 * Ported from curriculum_parser.py parse_curriculum_pdf()
 */

import type { ParsedCourse, Table, PageTextItems, DetectionResult, LayoutType } from '../types.js';
import { extractPdfPages } from './pdfExtractor.js';
import { reconstructTables } from './tableDetector.js';
import { parseStandardLayout } from './standardLayout.js';
import { parseSplitLayout } from './splitLayout.js';
import { postProcessRows } from './postProcessor.js';
import { logger } from '../utils/logger.js';

// ────────────────────────────────────────────────────────────────────────────
// Layout detection
// ────────────────────────────────────────────────────────────────────────────

function detectLayout(table: Table): DetectionResult {
  if (!table || !table[0]) return { layout: 'standard', reason: 'Empty table' };

  // Scan first 10 rows for header indicators (2015 PDFs have university name,
  // college, program, year, semester headers before data — can be 6+ rows deep)
  const scanRows = table.slice(0, Math.min(10, table.length));
  const allHeaderText = scanRows
    .map((row) =>
      row
        .filter((x) => x)
        .map((x) => String(x).toLowerCase())
        .join(' '),
    )
    .join(' ');

  // Engineering: lec + lab column headers — only indicates split layout
  // when they appear MULTIPLE times in a single row (once per semester half).
  // A single occurrence of lec/lab means engineering sub-columns in a
  // standard stacked layout (e.g. 2015 ECE: "Code | Title | Lec | Lab | Credit").
  for (const row of scanRows) {
    const cells = row.filter((x) => x).map((x) => String(x).toLowerCase().trim());
    const lecCount = cells.filter((c) => /^\s*lec\.?\s*$/i.test(c)).length;
    const labCount = cells.filter((c) => /^\s*lab\.?\s*$/i.test(c)).length;
    if (lecCount >= 2 && labCount >= 2) {
      return { layout: 'split', reason: "Headers have duplicate 'lec' and 'lab' columns" };
    }
  }

  // Dual semester headers in same row (strong indicator for side-by-side layout)
  for (const row of scanRows) {
    const rowText = row
      .filter((x) => x)
      .map((x) => String(x).toLowerCase())
      .join(' ');
    if (
      (rowText.includes('first semester') || rowText.includes('1st semester')) &&
      (rowText.includes('second semester') || rowText.includes('2nd semester'))
    ) {
      return { layout: 'split', reason: 'Row contains both semester labels' };
    }
  }

  // Wide table: check for the SAME header cell text appearing at two
  // positions with a significant gap (indicating left/right halves).
  // "Course Code" at col 1 and "Course Title" at col 7 are DIFFERENT headers
  // and should NOT trigger this — we require exact cell text match.
  if (table[0].length > 8) {
    for (const row of scanRows) {
      const cellsByText = new Map<string, number[]>();
      for (let i = 0; i < row.length; i++) {
        const cell = (row[i] || '').toLowerCase().trim();
        if (!cell || cell.length > 25) continue;
        if (!cellsByText.has(cell)) cellsByText.set(cell, []);
        cellsByText.get(cell)!.push(i);
      }
      for (const [text, positions] of cellsByText) {
        if (positions.length >= 2) {
          const maxGap = Math.max(
            ...positions.slice(1).map((p, idx) => p - positions[idx]),
          );
          if (maxGap > 2) {
            return {
              layout: 'split',
              reason: `Wide table with duplicate '${text}' headers (gap=${maxGap}, ${table[0].length} cols)`,
            };
          }
        }
      }
    }
  }

  return { layout: 'standard', reason: 'Standard stacked layout' };
}

// ────────────────────────────────────────────────────────────────────────────
// Main parse function
// ────────────────────────────────────────────────────────────────────────────

/**
 * Try to extract the actual program title from the PDF header text.
 * Many AdDU PDFs have the program name in the first few text items.
 */
export function extractProgramTitleFromPage(page: PageTextItems): string | null {
  // Look at the first ~15 text items on the first page
  const headerItems = page.item.slice(0, 15);

  // Common degree keywords to look for
  const degreePatterns = [
    /bachelor\s+of\s+\w+/i,
    /master\s+of\s+\w+/i,
    /master\s+in\s+\w+/i,
    /doctor\s+of\s+\w+/i,
    /\bBS\s+in\s+/i,
    /\bMA\s+in\s+/i,
    /\bMS\s+in\s+/i,
    /\bMBA\b/i,
    /\bMPA\b/i,
    /\bDBA\b/i,
    /\bDPA\b/i,
  ];

  for (const item of headerItems) {
    const text = item.text.trim();
    if (text.length < 10) continue;
    // Skip university name and generic headers
    if (/ateneo|davao|university|graduate school|college|school of/i.test(text)) continue;
    if (/revised|effective|curriculum/i.test(text)) continue;

    if (degreePatterns.some((p) => p.test(text))) {
      return text;
    }
  }

  return null;
}

/**
 * Parse a curriculum PDF buffer and return a list of parsed courses.
 */
export async function parseCurriculumPdf(
  data: ArrayBuffer | Uint8Array,
  programName: string,
): Promise<ParsedCourse[]> {
  const allCourses: ParsedCourse[] = [];

  logger.info('PDF', `Parsing: ${programName}`);

  try {
    // Step 1: Extract text items from every page
    const pages = await extractPdfPages(data);
    logger.info('PDF', `Page count: ${pages.length}`);

    // Try to extract actual program title from PDF header
    if (pages.length > 0) {
      const pdfTitle = extractProgramTitleFromPage(pages[0]);
      if (pdfTitle) {
        logger.info('PDF', `Detected title: "${pdfTitle}"`);
        programName = pdfTitle;
      }
    }

    // Track context across pages
    let currentYear = 1;
    let currentSemester = '1st Semester';

    for (const page of pages) {
      // Step 2: Reconstruct tables from text items
      const tables = reconstructTables(page);
      logger.debug('PDF', `Page ${page.page_number}: ${tables.length} table(s)`);

      for (let t = 0; t < tables.length; t++) {
        const table = tables[t];
        if (!table || table.length === 0) continue;

        // Step 3: Detect layout
        const detection = detectLayout(table);

        logger.debug(
          'PDF',
          `Page ${page.page_number}, Table ${t + 1}: ${detection.layout} (${detection.reason}), Cols=${table[0].length}`,
        );

        const coursesBefore = allCourses.length;

        // Step 4: Parse with appropriate layout parser
        if (detection.layout === 'split') {
          const result = parseSplitLayout(table, programName, currentYear);
          allCourses.push(...result.course);
          currentYear = result.updated_year;
        } else {
          const result = parseStandardLayout(
            table,
            programName,
            currentYear,
            currentSemester,
          );
          allCourses.push(...result.course);
          currentYear = result.updated_year;
          currentSemester = result.updated_semester;
        }

        const added = allCourses.length - coursesBefore;
        logger.debug('PDF', `  Rows added: ${added}`);
      }
    }
  } catch (err) {
    logger.error('PDF', `Error parsing PDF: ${err}`);
    return [];
  }

  // Step 5: Post-process
  const cleaned = postProcessRows(allCourses);
  logger.info('PDF', `Total courses extracted: ${cleaned.length}`);
  return cleaned;
}
