/**
 * Post-processing for parsed curriculum rows
 *
 * Filters out parsing artifacts: header bleeds, absurd units, invalid codes.
 * Ported from curriculum_parser.py post_process_rows()
 */

import type { ParsedCourse } from '../types.js';
import { VALID_CODE_PATTERN, SPECIAL_SUBJECTS } from './courseCodeExtractor.js';
import { logger } from '../utils/logger.js';

/** Minimum length for a valid course code */
const MIN_CODE_LENGTH = 4;

/** Maximum plausible unit value for a single course */
const MAX_REASONABLE_UNITS = 30.0;

/** Regex for detecting header bleed rows */
const HEADER_REGEX =
  /(effective\s+\d{4}|revised\s+\d{4}|curriculum\s+effective\s+\d{4}|semester\s+sy\s+\d{4})/i;

/** Regex for detecting 4-digit years (1900-2099) */
const YEAR_REGEX = /\b(19|20)\d{2}\b/;

/** Titles that are footnote markers or noise, not real course titles */
const JUNK_TITLE_PATTERNS = [
  /^\*+$/,                    // "*", "**", "***"
  /^\*\*\s*Pre\s*requisite/i, // "** Pre requisite of ..."
  /^Depending on the topic/i, // Footnote continuation text
  /^~~~/,                     // "~~~ Effective ..."
  /^\(Revised Version/i,      // "(Revised Version, ...)"
  /^Page\s+\d/i,              // "Page 1"
];

function isSpecialSubject(code: string): boolean {
  if (!code) return false;
  const upper = code.toUpperCase();
  return [...SPECIAL_SUBJECTS].some((s) => upper.includes(s));
}

function containsYear(text: string): boolean {
  if (!text) return false;
  return YEAR_REGEX.test(text);
}

/** Elective prefix pattern — valid even though it doesn't match VALID_CODE_PATTERN */
const ELECTIVE_PREFIX_RE = /^[A-Za-z]+\s+ELEC(?:TIVE)?(\s+\d{1,4})?$/i;

/**
 * Clean up parsing artifacts from curriculum rows.
 */
export function postProcessRows(rows: ParsedCourse[]): ParsedCourse[] {
  if (!rows || rows.length === 0) return rows;

  const cleaned: ParsedCourse[] = [];
  const seen = new Set<string>();
  const originalCount = rows.length;

  for (const row of rows) {
    const code = (row.course_code ?? '').trim();
    const title = (row.course_title ?? '').trim();
    const unitRaw = row.unit;

    // Drop header bleed rows
    if (HEADER_REGEX.test(code) || HEADER_REGEX.test(title)) {
      logger.debug('PostProcess', `Dropping header bleed: code='${code}', title='${title}'`);
      continue;
    }

    // Drop rows where code looks like a date/year fragment (e.g. "SY 2020", "August 2016")
    if (/^(SY|AY|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i.test(code)) {
      logger.debug('PostProcess', `Dropping date code: '${code}'`);
      continue;
    }

    // Drop rows where title is footnote noise
    if (JUNK_TITLE_PATTERNS.some((p) => p.test(title))) {
      logger.debug('PostProcess', `Dropping junk title: code='${code}', title='${title}'`);
      continue;
    }

    // Drop "COMPREHENSIVE" (exam, not a course)
    if (/^COMPREHENSIVE$/i.test(code)) {
      logger.debug('PostProcess', `Dropping comprehensive exam: '${code}'`);
      continue;
    }

    // Drop codes with overly long alphabetic prefixes (garbage from PDF text
    // like "ospectus 0816" from "Prospectus 0816" with broken first letter),
    // but exempt special subjects (DISSERTATION, PRACTICUM, INTERNSHIP) and electives.
    const prefixMatch = code.match(/^([A-Za-z]+)/);
    if (
      prefixMatch &&
      prefixMatch[1].length > 7 &&
      !isSpecialSubject(code) &&
      !ELECTIVE_PREFIX_RE.test(code)
    ) {
      logger.debug('PostProcess', `Dropping long-prefix code: '${code}'`);
      continue;
    }

    // Validate course codes (skip for special subjects and elective prefixes)
    if (!isSpecialSubject(code) && !ELECTIVE_PREFIX_RE.test(code)) {
      if (!VALID_CODE_PATTERN.test(code)) {
        if (code.length < MIN_CODE_LENGTH || containsYear(code)) {
          logger.debug('PostProcess', `Dropping invalid code: '${code}'`);
          continue;
        }
      }
    }

    // Check for absurd unit values
    const unitNum = typeof unitRaw === 'number' ? unitRaw : parseFloat(String(unitRaw));

    if (!isNaN(unitNum) && unitNum > MAX_REASONABLE_UNITS) {
      logger.warn('PostProcess', `Dropping absurd units: code='${code}', unit=${unitNum}`);
      continue;
    }

    // Deduplicate: same program + code + year + semester = duplicate
    const dedupeKey = `${row.program_name}|${code}|${row.year_level}|${row.semester}`;
    if (seen.has(dedupeKey)) {
      logger.debug('PostProcess', `Dropping duplicate: '${code}' in ${row.program_name}`);
      continue;
    }
    seen.add(dedupeKey);

    // Store normalized float
    cleaned.push({
      ...row,
      unit: isNaN(unitNum) ? 0 : unitNum,
    });
  }

  logger.debug('PostProcess', `Cleaned: ${originalCount} -> ${cleaned.length} rows`);
  return cleaned;
}
