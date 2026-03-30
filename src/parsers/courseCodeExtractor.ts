/**
 * Course code extraction and unit parsing
 *
 * Ported from curriculum_parser.py — preserves exact behavior and edge cases.
 */

/** Words that look like course codes but aren't */
const IGNORE_CODES = new Set([
  'FORMATION',
  'SEMESTER',
  'YEAR',
  'PAGE',
  'TOTAL',
  'UNITS',
]);

/** Regex for validating course codes after extraction */
export const VALID_CODE_PATTERN =
  /^(?:[A-Za-z]{1,6}\.?\s?-?\d{1,5}[A-Za-z]?|[A-Za-z]\.[A-Za-z]\.?\s?\d{1,5}[A-Za-z]?|[A-Za-z]{1,6}\s+[IVX]{1,4})$/i;

/** Special subject labels preserved even without a number */
export const SPECIAL_SUBJECTS = new Set([
  'NSTP',
  'ASSEMBLY',
  'FYDP',
  'OJT',
]);

/**
 * Completion requirements that are only valid WITH a number suffix.
 * "THESIS 1", "PRACTICUM 600" = real courses.
 * Standalone "THESIS", "DISSERTATION" = milestones, dropped in postProcessor.
 */
export const COMPLETION_SUBJECTS = new Set([
  'THESIS',
  'PRACTICUM',
  'INTERNSHIP',
  'DISSERTATION',
]);

/**
 * Extract course code from a merged string.
 *
 * Supports mixed-case prefixes (e.g. "SocWk 1130", "ROBO 1101", "BIO 100A").
 * Returns both the matched code and any remaining description text.
 */
export function extractCourseCode(
  text: string | null | undefined,
): [string | null, string] {
  if (!text) return [null, ''];

  // Normalize whitespace
  const normalized = text.split(/\s+/).join(' ').trim();
  if (!normalized) return [null, ''];

  // Check if text starts with any ignored word
  const firstWord = normalized.split(' ')[0].toUpperCase();
  if (IGNORE_CODES.has(firstWord)) return [null, text];

  // Normalize en-dash/em-dash to ASCII dash for codes like "NSTP – CWTS 1"
  const dashNormalized = normalized.replace(/[\u2013\u2014]/g, '-');

  // Hyphenated elective prefix codes: "FIN-ELEC 2247", "PM-ELEC 4252"
  const hyphenElec = dashNormalized.match(/^([A-Za-z]+-ELEC(?:TIVE)?\s?\d{1,4})/i);
  if (hyphenElec) {
    const remaining = dashNormalized.slice(hyphenElec[1].length).trim();
    return [hyphenElec[1], remaining];
  }

  // Spaced elective prefix codes: "SOCIO ELEC 1331", "FREE ELEC 2138", "PHILO ELECTIVE 1"
  const elecWithNum = dashNormalized.match(/^([A-Za-z]+\s+ELEC(?:TIVE)?\s?\d{1,4})/i);
  if (elecWithNum) {
    const remaining = dashNormalized.slice(elecWithNum[1].length).trim();
    return [elecWithNum[1], remaining];
  }

  // Elective prefix without number: "SOCIO ELEC", "FREE ELEC", "FIN-ELEC" (number may be on next row)
  if (/^[A-Za-z]+[-\s]+ELEC(?:TIVE)?\s*$/i.test(dashNormalized)) {
    return [dashNormalized.trim(), ''];
  }

  // Special subjects: match patterns like "NSTP - CWTS 1", "NSTP-1", "NSTP 1"
  if (SPECIAL_SUBJECTS.has(firstWord)) {
    // Try to extract the full code (e.g. "NSTP - CWTS 1", "NSTP-1")
    const specialMatch = dashNormalized.match(/^([A-Za-z]+[\s-]+(?:[A-Za-z]+[\s-]+)?\d+)/);
    if (specialMatch) {
      const remaining = dashNormalized.replace(specialMatch[1], '').trim();
      return [specialMatch[1], remaining];
    }
    // Just the keyword alone (e.g. "NSTP", "OJT", "ASSEMBLY")
    const remaining = dashNormalized.slice(firstWord.length).trim();
    return [firstWord, remaining];
  }

  // Completion subjects: THESIS, DISSERTATION, PRACTICUM, INTERNSHIP
  // Only extract when they have a number (e.g. "THESIS 1", "PRACTICUM 600").
  // Standalone forms are extracted but dropped later by postProcessor.
  if (COMPLETION_SUBJECTS.has(firstWord)) {
    const compMatch = dashNormalized.match(/^([A-Za-z]+[\s-]+(?:[A-Za-z]+[\s-]+)?\d+)/);
    if (compMatch) {
      const remaining = dashNormalized.replace(compMatch[1], '').trim();
      return [compMatch[1], remaining];
    }
    // Standalone — still extract so postProcessor can drop it with context
    const remaining = dashNormalized.slice(firstWord.length).trim();
    return [firstWord, remaining];
  }

  // Roman numeral course codes: "FYCF I", "Hum II", "PE III"
  const romanMatch = dashNormalized.match(/^([A-Za-z]{1,6}\s+[IVX]{1,4})(?:\s|$)/);
  if (romanMatch) {
    const remaining = dashNormalized.slice(romanMatch[1].length).trim();
    return [romanMatch[1], remaining];
  }

  // Regex: 1-8 letters (mixed case, optionally with dot/space),
  // optional whitespace/dash, 1-4 digits, optional trailing letter
  // Handles: "CSCI 111", "SocWk 1130", "Engl. 600", "C 201", "NSTP-1", "Eng 11", "PE 1"
  // Match at START of string to avoid matching numbers embedded in titles
  const pattern = /^([A-Za-z]{1,8}\.?\s?-?\d{1,4}[A-Za-z]?)/;
  let match = dashNormalized.match(pattern);

  // Try dotted abbreviation prefix: "B.A. 907", "R.E. 224", "M.A. 300"
  if (!match) {
    const dottedPattern = /^([A-Za-z]\.[A-Za-z]\.?\s?\d{1,4}[A-Za-z]?)/;
    match = dashNormalized.match(dottedPattern);
  }

  // Try spaced prefix pattern: "Nat Sci 1", "Ph P 500", "Ed Ad 700"
  // Must come before loose fallback to avoid partial matches like "Sci 1"
  if (!match) {
    const spacedPattern = /^([A-Za-z]{1,4}\s[A-Za-z]{1,4}\.?\s?\d{1,4}[A-Za-z]?)/;
    match = dashNormalized.match(spacedPattern);
  }

  // Fallback: try anywhere in string (for cells with leading text)
  // Keep \d{3,4} here — unanchored search with 1-2 digits creates false
  // positives on section headers like "Electives (... and 6 units ...)"
  if (!match) {
    const loosePattern = /([A-Za-z]{2,8}\.?\s?-?\d{3,4}[A-Za-z]?)/;
    match = dashNormalized.match(loosePattern);
  }

  if (match) {
    let code = match[1];

    // Extract prefix and check against ignored codes
    const prefixMatch = code.match(/^([A-Za-z]+)/);
    if (prefixMatch) {
      const prefix = prefixMatch[1].toUpperCase();
      if (IGNORE_CODES.has(prefix)) return [null, text];
    }

    // Normalize: ensure space between letters and numbers
    // e.g. "ENGL1101" -> "ENGL 1101", but preserve "CSc-1100"
    if (!code.includes('-') && !code.includes(' ')) {
      for (let i = 0; i < code.length; i++) {
        if (code[i] >= '0' && code[i] <= '9') {
          code = code.slice(0, i) + ' ' + code.slice(i);
          break;
        }
      }
    }

    const remaining = dashNormalized.replace(match[1], '').trim();
    return [code, remaining];
  }

  return [null, text];
}

/**
 * Parse unit string into a number.
 *
 * Handles:
 * - Standard: "3.0" -> 3.0
 * - Engineering "Lec-Lab-Credit": "1-3-2" -> 2.0 (takes last digit)
 */
export function parseUnits(unitStr: string | null | undefined): number {
  if (!unitStr) return 0.0;
  const text = String(unitStr).trim();
  if (!text) return 0.0;

  // Engineering "Lec-Lab-Credit" format
  if (text.includes('-')) {
    const parts = text.split('-');
    const last = parts[parts.length - 1];
    const val = parseFloat(last);
    if (!isNaN(val)) return val;
  }

  // Standard numbers
  const clean = text.replace(/[^\d.]/g, '');
  if (clean) {
    const val = parseFloat(clean);
    if (!isNaN(val)) return val;
  }

  return 0.0;
}

/**
 * Remove newlines and extra spaces from text.
 */
export function cleanText(text: string | null | undefined): string {
  if (!text) return '';
  return String(text).split(/\s+/).join(' ').trim();
}
