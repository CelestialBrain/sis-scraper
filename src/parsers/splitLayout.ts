/**
 * Split / parallel layout parser
 *
 * Handles tables where each row contains data for both semesters,
 * with the left half = 1st Semester and right half = 2nd Semester.
 * Used by Engineering, Biology (dual-semester headers), etc.
 *
 * Ported from curriculum_parser.py _parse_split_layout()
 */

import type { ParsedCourse, Table } from '../types.js';
import type { LayoutParseResult } from './types.js';
import { extractCourseCode, parseUnits, cleanText } from './courseCodeExtractor.js';

/** Skip patterns for header/total rows */
const SKIP_PATTERNS = [
  'course no',
  'course #',
  'course description',
  'total',
  'summary',
];

function parseSide(
  cells: string[],
  programName: string,
  currentYear: number,
  semester: string,
): ParsedCourse | null {
  // Gather non-empty cells with indices
  const nonEmpty = cells
    .map((c, i) => ({ text: cleanText(c), idx: i }))
    .filter((c) => c.text);

  if (nonEmpty.length === 0) return null;

  // Try to find a course code in any cell
  let code: string | null = null;
  let leftover = '';
  let codeIdx = -1;

  // Strategy 1: try each non-empty cell
  for (const cell of nonEmpty) {
    [code, leftover] = extractCourseCode(cell.text);
    if (code) {
      codeIdx = cell.idx;
      break;
    }
  }

  // Strategy 2: combine adjacent cells (handles split codes like "B.A. 90" + "7")
  if (!code && nonEmpty.length >= 2) {
    for (let i = 0; i < nonEmpty.length - 1; i++) {
      const combined = nonEmpty[i].text + nonEmpty[i + 1].text;
      [code, leftover] = extractCourseCode(combined);
      if (code) {
        codeIdx = nonEmpty[i + 1].idx;
        break;
      }
      const combined2 = nonEmpty[i].text + ' ' + nonEmpty[i + 1].text;
      [code, leftover] = extractCourseCode(combined2);
      if (code) {
        codeIdx = nonEmpty[i + 1].idx;
        break;
      }
    }
  }

  if (!code) return null;

  // Find title: first non-empty text cell after the code cell
  let title = '';
  for (const cell of nonEmpty) {
    if (cell.idx <= codeIdx) continue;
    const cellText = cell.text;
    // Skip if it looks like a number/unit
    if (/^\(?\d+\.?\d*\)?$/.test(cellText)) continue;
    title = cellText;
    break;
  }
  if (!title) title = leftover;

  // Skip rows with no title — likely prerequisite codes or noise
  if (!title) return null;

  // Find units: scan from the end of the half
  // Skip cells containing letters (prerequisite codes like "ASF 1102")
  let unit = 0.0;
  for (let i = cells.length - 1; i > codeIdx; i--) {
    const cellVal = cells[i]?.trim();
    if (!cellVal) continue;
    if (/[a-zA-Z]/.test(cellVal)) continue;
    const parsed = parseUnits(cellVal);
    if (parsed > 0) {
      unit = parsed;
      break;
    }
  }

  return {
    program_name: programName,
    year_level: currentYear,
    semester,
    course_code: code,
    course_title: title,
    unit,
  };
}

/**
 * Detect the split point between left and right halves of a side-by-side table.
 *
 * Primarily uses data rows to find pairs of course codes, which is the most
 * reliable signal. Falls back to Math.ceil(cols/2).
 */
function detectMidpoint(table: Table): number {
  const cols = table[0]?.length ?? 0;
  if (cols <= 2) return Math.ceil(cols / 2);

  const scanRows = table.slice(0, Math.min(10, table.length));
  const codePattern = /^[A-Za-z]{1,8}[\s.\-]?\d{1,4}/;

  // Strategy 1: Find data rows with exactly 2 course codes (left and right halves)
  for (const row of scanRows) {
    const codeCols: number[] = [];
    for (let i = 0; i < row.length; i++) {
      const cell = (row[i] || '').trim();
      if (codePattern.test(cell)) {
        codeCols.push(i);
      }
    }
    if (codeCols.length === 2 && codeCols[1] > codeCols[0] + 1) {
      return codeCols[1];
    }
  }

  // Strategy 2: Find duplicate header keywords with a significant gap
  // (e.g. "Course No." at col 0 and "Course No." at col 8)
  for (const row of scanRows) {
    const courseCols: number[] = [];
    for (let i = 0; i < row.length; i++) {
      const cell = (row[i] || '').toLowerCase().trim();
      if (cell.includes('course')) {
        courseCols.push(i);
      }
    }
    // Find first pair with gap > 2 (avoids adjacent "Course No."/"Course Description")
    for (let i = 1; i < courseCols.length; i++) {
      if (courseCols[i] - courseCols[i - 1] > 2) {
        return courseCols[i];
      }
    }
  }

  // Fallback: use ceil so left half gets the center column (units)
  return Math.ceil(cols / 2);
}

export function parseSplitLayout(
  table: Table,
  programName: string,
  currentYear: number,
): LayoutParseResult {
  const courses: ParsedCourse[] = [];
  const midpoint = detectMidpoint(table);

  for (const row of table) {
    const rowText = row
      .filter((x) => x)
      .map((x) => String(x))
      .join(' ')
      .toLowerCase();

    // Skip header and total rows
    if (SKIP_PATTERNS.some((p) => rowText.includes(p))) continue;

    // Detect year context
    if (rowText.includes('first year') || rowText.includes('1st year')) {
      currentYear = 1;
    } else if (rowText.includes('second year') || rowText.includes('2nd year')) {
      currentYear = 2;
    } else if (rowText.includes('third year') || rowText.includes('3rd year')) {
      currentYear = 3;
    } else if (rowText.includes('fourth year') || rowText.includes('4th year')) {
      currentYear = 4;
    } else if (rowText.includes('fifth year') || rowText.includes('5th year')) {
      currentYear = 5;
    }

    // Detect semester in row text (for summer semesters)
    let leftSemester = '1st Semester';
    let rightSemester = '2nd Semester';
    if (rowText.includes('summer')) {
      leftSemester = 'Summer';
      rightSemester = 'Summer';
    }

    // LEFT SIDE (1st Semester)
    const leftCourse = parseSide(
      row.slice(0, midpoint),
      programName,
      currentYear,
      leftSemester,
    );
    if (leftCourse) courses.push(leftCourse);

    // RIGHT SIDE (2nd Semester)
    const rightCourse = parseSide(
      row.slice(midpoint),
      programName,
      currentYear,
      rightSemester,
    );
    if (rightCourse) courses.push(rightCourse);
  }

  return {
    course: courses,
    updated_year: currentYear,
    updated_semester: '1st Semester', // reset after split layout
  };
}
