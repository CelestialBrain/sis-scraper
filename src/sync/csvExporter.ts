/**
 * CSV exporter — backward-compatible CSV output
 *
 * Writes both the raw curriculum CSV and the AISIS-schema CSV.
 */

import { promises as fs } from 'fs';
import type { ParsedCourse, AisisRow } from '../types.js';
import { extractDegreeCode } from '../db/writer.js';
import { logger } from '../utils/logger.js';

const UNIVERSITY_CODE = 'ADDU';

function escapeCsv(value: string | number): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvLine(values: (string | number)[]): string {
  return values.map(escapeCsv).join(',');
}

/**
 * Export raw curriculum CSV (backward-compatible format).
 */
export async function exportRawCsv(
  courses: ParsedCourse[],
  outputPath = 'addu_curriculum_database.csv',
): Promise<void> {
  const header = 'program,year,semester,code,title,units';
  const lines = [
    header,
    ...courses.map((c) =>
      toCsvLine([c.program_name, c.year_level, c.semester, c.course_code, c.course_title, c.unit]),
    ),
  ];

  await fs.writeFile(outputPath, lines.join('\n'), 'utf-8');
  logger.info('CSV', `Raw data saved to ${outputPath} (${courses.length} rows)`);
}

/**
 * Export AISIS-schema CSV (backward-compatible format).
 */
export async function exportAisisCsv(
  courses: ParsedCourse[],
  outputPath = 'addu_curriculum_aisis.csv',
): Promise<void> {
  const header =
    'deg_code,program_label,program_title,year_level,semester,course_code,course_title,unit,prerequisite,category,university_code';

  const rows: AisisRow[] = courses.map((c) => ({
    deg_code: extractDegreeCode(c.program_name),
    program_label: c.program_name,
    program_title: c.program_name,
    year_level: c.year_level,
    semester: c.semester,
    course_code: c.course_code,
    course_title: c.course_title,
    unit: c.unit,
    prerequisite: '',
    category: '',
    university_code: UNIVERSITY_CODE,
  }));

  const lines = [
    header,
    ...rows.map((r) =>
      toCsvLine([
        r.deg_code,
        r.program_label,
        r.program_title,
        r.year_level,
        r.semester,
        r.course_code,
        r.course_title,
        r.unit,
        r.prerequisite,
        r.category,
        r.university_code,
      ]),
    ),
  ];

  await fs.writeFile(outputPath, lines.join('\n'), 'utf-8');
  logger.info('CSV', `AISIS schema saved to ${outputPath} (${rows.length} rows)`);
}
