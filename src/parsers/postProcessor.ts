/**
 * Post-processing for parsed curriculum rows
 *
 * Filters out parsing artifacts: header bleeds, absurd units, invalid codes.
 * Ported from curriculum_parser.py post_process_rows()
 */

import type { ParsedCourse } from '../types.js';
import { VALID_CODE_PATTERN, SPECIAL_SUBJECTS, COMPLETION_SUBJECTS } from './courseCodeExtractor.js';
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

/** Codes that are noise from broken PDF text, not real course codes */
const JUNK_CODE_PATTERNS = [
  /^rk\s+\d/i,       // "rk 6" — broken "Work 6xx"
  /^Core\s+\d/i,     // "Core 18" — broken header text
  /^tic\s+\d/i,      // "tic 101" — broken "Practic..."
  /^Revised\s+\d/i,  // "Revised 20" — broken header "Revised 2020"
  /^lec$/i,           // "lec" — column header
  /^lab$/i,           // "lab" — column header
  /^credit$/i,        // "credit" — column header
  /^unit$/i,          // "unit" — column header
  /^pre$/i,           // "pre" — "Pre requisite" header
  /^and\s+[A-Z]/,     // "and BA 910" — broken text continuation
  /^ive\s+\d/i,       // "ive 3" — broken "Elective 3"
  /^the\s+\d/i,       // "the 20" / "the 1983" — broken sentence fragments
  /^o\s+\d{3}/i,      // "o 603d" — broken "Theo 603d" with missing prefix
];

/** Titles that are footnote markers or noise, not real course titles */
const JUNK_TITLE_PATTERNS = [
  /^\*+$/,                    // "*", "**", "***"
  /^\*\*\s*Pre\s*requisite/i, // "** Pre requisite of ..."
  /^Depending on the topic/i, // Footnote continuation text
  /^~~~/,                     // "~~~ Effective ..."
  /^\(Revised Version/i,      // "(Revised Version, ...)"
  /^Page\s+\d/i,              // "Page 1"
  /^&\d/,                      // "&3101" — broken ampersand-merged code in title
  /^[,/:;]\s*$/,               // ",", "/", ":", ";" — punctuation-only titles
  /^[,/:;]\s/,                 // ", BA908..." — title starting with punctuation
  /^\(non/i,                   // "(non" — broken "non-thesis" fragment
];

function isSpecialSubject(code: string): boolean {
  if (!code) return false;
  const upper = code.toUpperCase();
  return (
    [...SPECIAL_SUBJECTS].some((s) => upper.includes(s)) ||
    [...COMPLETION_SUBJECTS].some((s) => upper.includes(s))
  );
}

function containsYear(text: string): boolean {
  if (!text) return false;
  return YEAR_REGEX.test(text);
}

/** Elective prefix pattern — valid even though it doesn't match VALID_CODE_PATTERN */
const ELECTIVE_PREFIX_RE = /^[A-Za-z]+[-\s]+ELEC(?:TIVE)?(\s+\d{1,4})?$/i;

/**
 * Clean up parsing artifacts from curriculum rows.
 */
export function postProcessRows(rows: ParsedCourse[]): ParsedCourse[] {
  if (!rows || rows.length === 0) return rows;

  const cleaned: ParsedCourse[] = [];
  const seen = new Set<string>();
  const originalCount = rows.length;

  for (const row of rows) {
    // Normalize en-dash/em-dash to ASCII dash in codes (e.g. "NSTP – CWTS" → "NSTP - CWTS")
    const code = (row.course_code ?? '').trim().replace(/[\u2013\u2014]/g, '-');
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

    // Drop junk codes from broken PDF text
    if (JUNK_CODE_PATTERNS.some((p) => p.test(code))) {
      logger.debug('PostProcess', `Dropping junk code: '${code}'`);
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

    // Drop standalone completion requirements (no number = not a course section).
    // "THESIS", "DISSERTATION", "PRACTICUM", "INTERNSHIP" alone are degree
    // milestones, not enrollable courses. Numbered variants like "THESIS 1"
    // or "PRACTICUM 600" are kept.
    if (/^(THESIS|DISSERTATION|PRACTICUM|INTERNSHIP)$/i.test(code)) {
      logger.debug('PostProcess', `Dropping standalone completion requirement: '${code}'`);
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
    // Normalize code to uppercase for dedup (catches "Theo 603a" vs "THEO 603A")
    const dedupeKey = `${row.program_name}|${code.toUpperCase()}|${row.year_level}|${row.semester}`;
    if (seen.has(dedupeKey)) {
      logger.debug('PostProcess', `Dropping duplicate: '${code}' in ${row.program_name}`);
      continue;
    }
    seen.add(dedupeKey);

    // Store with normalized code (en-dash→dash) and float unit
    cleaned.push({
      ...row,
      course_code: code,
      unit: isNaN(unitNum) ? 0 : unitNum,
    });
  }

  // Secondary dedup: within a single curriculum, a course code only appears
  // once. If the same code appears in different year/semesters for the same
  // program, it's a catalog repeat (graduate prospectus listing the same
  // course under multiple sections). Keep only the first occurrence.
  const codeOnlySeen = new Set<string>();
  const deduped: ParsedCourse[] = [];
  for (const row of cleaned) {
    const codeKey = `${row.program_name}|${row.course_code.toUpperCase()}`;
    if (codeOnlySeen.has(codeKey)) {
      logger.debug('PostProcess', `Dropping catalog repeat: '${row.course_code}' Y${row.year_level}/${row.semester}`);
      continue;
    }
    codeOnlySeen.add(codeKey);
    deduped.push(row);
  }

  logger.debug('PostProcess', `Cleaned: ${originalCount} -> ${cleaned.length} -> ${deduped.length} rows`);
  return deduped;
}
