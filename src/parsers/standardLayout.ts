/**
 * Standard / stacked layout parser
 *
 * Handles tables where courses are listed sequentially with year/semester
 * context provided by header rows. Used by Arts & Sciences, Social Work, etc.
 *
 * Ported from curriculum_parser.py _parse_standard_layout()
 */

import type { ParsedCourse, Table } from '../types.js';
import type { LayoutParseResult } from './types.js';
import { extractCourseCode, parseUnits, cleanText } from './courseCodeExtractor.js';

/** Skip patterns for non-data rows */
const SKIP_ROW_PATTERNS = [
  'total number',
  'total units',
  'total:',
  'summary',
  '* same content',
  '---',
];

const SKIP_FIRST_CELL = new Set([
  'course',
  'course code',
  'course no',
  'course no.',
  'course#',
  'description',
  'course description',
  'units',
  'subject',
  'subjects',
]);

/** Header keywords that identify prerequisite/non-data columns */
const PREREQ_COLUMN_HEADERS = ['pre-requisite', 'prerequisite', 'pre-req', 'prof'];

/** Context keywords that mark non-title rows */
const CONTEXT_KEYWORDS = /\b(year|semester|summer|total|course code|course title|units|course no|course #|description|subject)\b/i;

/** Pattern for bare elective prefixes like "SOCIO ELEC", "FREE ELEC" */
const ELECTIVE_PREFIX_RE = /^[A-Za-z]+\s+ELEC(?:TIVE)?\s*$/i;

/**
 * Detect columns that contain prerequisites or other non-course-data
 * by scanning the first few rows for header keywords.
 */
function detectSkipColumns(table: Table): Set<number> {
  const skipCols = new Set<number>();
  const scanRows = table.slice(0, Math.min(6, table.length));
  for (const row of scanRows) {
    for (let i = 0; i < row.length; i++) {
      const cell = (row[i] || '').toLowerCase().trim();
      if (PREREQ_COLUMN_HEADERS.some((h) => cell.includes(h))) {
        skipCols.add(i);
      }
    }
  }
  return skipCols;
}

/**
 * Fix number-bleed in elective rows.
 *
 * Some PDFs render "SOCIO ELEC 1331" with the number on the next row:
 *   Row N:   col[0]="SOCIO ELEC"        col[1]="WORLD HISTORY..."
 *   Row N+1: col[0]="1331 SOCIO ELEC"   col[1]="CULTURAL ANTHROPOLOGY"
 *
 * This pre-processing step moves the bleeding number back to the correct row.
 */
function fixElectiveNumberBleed(table: Table): Table {
  const result = table.map((row) => [...row]);

  for (let r = 0; r < result.length - 1; r++) {
    const col0 = (result[r][0] || '').trim();
    if (!ELECTIVE_PREFIX_RE.test(col0)) continue;

    const nextCol0 = (result[r + 1][0] || '').trim();
    const bleedMatch = nextCol0.match(/^(\d{3,4})\s*(.*)/);
    if (bleedMatch) {
      result[r][0] = col0 + ' ' + bleedMatch[1];
      result[r + 1][0] = bleedMatch[2] || '';
    }
  }

  return result;
}

/**
 * Extract the best title text from an adjacent row (for split-title courses).
 * Returns empty string if the row is a context/header/data row.
 */
function getAdjacentTitleText(row: string[], skipColumns: Set<number>): string {
  const cells = row
    .map((c, i) => ({ text: cleanText(c), idx: i }))
    .filter((c) => c.text && !skipColumns.has(c.idx));

  if (cells.length === 0) return '';

  // Skip if this row has a course code (it's a data row, not a title fragment)
  for (const cell of cells) {
    const [code] = extractCourseCode(cell.text);
    if (code) return '';
  }

  // Skip context rows (year/semester/total/header)
  const rowText = cells.map((c) => c.text).join(' ');
  if (SKIP_ROW_PATTERNS.some((p) => rowText.toLowerCase().includes(p))) return '';
  if (CONTEXT_KEYWORDS.test(rowText)) return '';
  if (/^\(?\d+\.?\d*\)?$/.test(rowText.trim())) return ''; // Just a number (total)

  // Get text cells (skip number-only), sorted by length descending
  const textCells = cells
    .filter((c) => !/^\(?\d+\.?\d*\)?$/.test(c.text))
    .filter((c) => c.text.length > 2);

  if (textCells.length === 0) return '';

  // Return the longest text cell (most likely the title fragment)
  return textCells.sort((a, b) => b.text.length - a.text.length)[0].text;
}

export function parseStandardLayout(
  table: Table,
  programName: string,
  currentYear: number,
  currentSemester: string,
): LayoutParseResult {
  const courses: ParsedCourse[] = [];
  const processed = fixElectiveNumberBleed(table);
  const skipColumns = detectSkipColumns(processed);

  for (let r = 0; r < processed.length; r++) {
    const row = processed[r];
    // Collect all non-empty cells for context, excluding prerequisite columns
    const nonEmptyCells = row
      .map((c, i) => ({ text: cleanText(c), idx: i }))
      .filter((c) => c.text && !skipColumns.has(c.idx));
    const rowText = nonEmptyCells.map((c) => c.text).join(' ').toLowerCase();

    // ── State machine: detect context changes ──

    if (rowText.includes('1st year') || rowText.includes('first year')) {
      currentYear = 1;
    } else if (rowText.includes('2nd year') || rowText.includes('second year')) {
      currentYear = 2;
    } else if (rowText.includes('3rd year') || rowText.includes('third year')) {
      currentYear = 3;
    } else if (rowText.includes('4th year') || rowText.includes('fourth year')) {
      currentYear = 4;
    } else if (rowText.includes('5th year') || rowText.includes('fifth year')) {
      currentYear = 5;
    }

    if (rowText.includes('1st semester') || rowText.includes('first semester')) {
      currentSemester = '1st Semester';
    } else if (rowText.includes('2nd semester') || rowText.includes('second semester')) {
      currentSemester = '2nd Semester';
    } else if (rowText.includes('summer')) {
      currentSemester = 'Summer';
    }

    // ── Skip non-data rows ──

    if (SKIP_ROW_PATTERNS.some((p) => rowText.includes(p))) continue;
    if (nonEmptyCells.length === 0) continue;

    // Check if first non-empty cell is a header keyword
    const firstNonEmpty = nonEmptyCells[0].text.toLowerCase();
    if (SKIP_FIRST_CELL.has(firstNonEmpty)) continue;

    // Skip rows that are just context (semester/year markers with no course data)
    if (
      nonEmptyCells.length <= 2 &&
      (firstNonEmpty.includes('semester') || firstNonEmpty.includes('year'))
    ) {
      continue;
    }

    // ── Extract data: scan cells for a course code ──

    try {
      let code: string | null = null;
      let leftover = '';
      let codeIdx = -1;

      // Strategy 1: Try each non-empty cell for a course code
      for (const cell of nonEmptyCells) {
        [code, leftover] = extractCourseCode(cell.text);
        if (code) {
          codeIdx = cell.idx;
          break;
        }
      }

      // Strategy 2: Try combining adjacent non-empty cells (handles split codes)
      if (!code && nonEmptyCells.length >= 2) {
        for (let i = 0; i < nonEmptyCells.length - 1; i++) {
          const combined = nonEmptyCells[i].text + ' ' + nonEmptyCells[i + 1].text;
          [code, leftover] = extractCourseCode(combined);
          if (code) {
            codeIdx = nonEmptyCells[i + 1].idx;
            break;
          }
          // Try without space
          const combined2 = nonEmptyCells[i].text + nonEmptyCells[i + 1].text;
          [code, leftover] = extractCourseCode(combined2);
          if (code) {
            codeIdx = nonEmptyCells[i + 1].idx;
            break;
          }
        }
      }

      if (!code) continue;

      // ── Find title: first non-empty text cell AFTER the code cell ──
      let title = '';
      let titleCellIdx = -1;
      for (const cell of nonEmptyCells) {
        if (cell.idx <= codeIdx) continue;
        const cellText = cell.text;
        // Skip if it looks like a number/unit
        if (/^\(?\d+\.?\d*\)?$/.test(cellText)) continue;
        // Skip short fragments that are continuation of broken text
        if (cellText.length <= 2 && /^\d/.test(cellText)) continue;
        title = cellText;
        titleCellIdx = cell.idx;
        break;
      }

      if (!title) title = leftover;

      // ── Fix number-bleed: code has short number and title starts with digits ──
      // e.g. "PIDS 5" + "07 Monitoring..." → "PIDS 507" + "Monitoring..."
      // or "DPA 302" + "9 Philosophy..." → "DPA 3029" + "Philosophy..."
      if (code && title) {
        const codeNumMatch = code.match(/^([A-Za-z].+?)(\d{1,2})$/);
        const titleLeadDigits = title.match(/^(\d{1,3})\s+(.*)/);
        if (codeNumMatch && titleLeadDigits) {
          const mergedNum = codeNumMatch[2] + titleLeadDigits[1];
          // Only merge if result is 3-4 digit number (typical course numbers)
          if (mergedNum.length >= 3 && mergedNum.length <= 5) {
            code = codeNumMatch[1] + mergedNum;
            title = titleLeadDigits[2];
          }
        }
      }

      // ── Look at adjacent rows for title when current row has none ──
      if (!title) {
        const fragments: string[] = [];
        if (r > 0) {
          const prevFragment = getAdjacentTitleText(processed[r - 1], skipColumns);
          if (prevFragment) fragments.push(prevFragment);
        }
        if (r < processed.length - 1) {
          const nextFragment = getAdjacentTitleText(processed[r + 1], skipColumns);
          if (nextFragment) fragments.push(nextFragment);
        }
        title = fragments.join(' ').trim();
      }

      // Skip rows with no title — likely prerequisite codes or noise
      if (!title) continue;

      // ── Find units: last numeric-only cell in the row ──
      // Skip cells containing letters (e.g. prerequisite codes like "ASF 1102")
      let unit = 0.0;
      const searchAfter = titleCellIdx >= 0 ? titleCellIdx : codeIdx;
      for (let i = row.length - 1; i > searchAfter; i--) {
        const cellVal = row[i]?.trim();
        if (!cellVal) continue;
        // Skip cells with alphabetic characters — units are always numeric
        // (e.g. "3.0", "5.0", "0.0") or engineering format ("1-3-2")
        if (/[a-zA-Z]/.test(cellVal)) continue;
        const parsed = parseUnits(cellVal);
        if (parsed > 0) {
          unit = parsed;
          break;
        }
      }

      courses.push({
        program_name: programName,
        year_level: currentYear,
        semester: currentSemester,
        course_code: code,
        course_title: title,
        unit,
      });
    } catch {
      // Skip unparseable rows
      continue;
    }
  }

  return {
    course: courses,
    updated_year: currentYear,
    updated_semester: currentSemester,
  };
}
