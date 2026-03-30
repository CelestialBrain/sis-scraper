/**
 * Tests for courseCodeExtractor — ported from test_scraper.py
 */

import { describe, it, expect } from 'vitest';
import {
  extractCourseCode,
  parseUnits,
  cleanText,
  VALID_CODE_PATTERN,
  SPECIAL_SUBJECTS,
  COMPLETION_SUBJECTS,
} from '../../src/parsers/courseCodeExtractor.js';

// ────────────────────────────────────────────────────────────────────────────
// extractCourseCode
// ────────────────────────────────────────────────────────────────────────────

describe('extractCourseCode', () => {
  it('extracts valid course code with space', () => {
    const [code, remaining] = extractCourseCode('ENGL 1101');
    expect(code).toBe('ENGL 1101');
    expect(remaining).toBe('');
  });

  it('normalizes code without space', () => {
    const [code, remaining] = extractCourseCode('MATH1001');
    expect(code).toBe('MATH 1001');
    expect(remaining).toBe('');
  });

  it('extracts code with trailing letter', () => {
    const [code] = extractCourseCode('BIO 100A');
    expect(code).toBe('BIO 100A');
  });

  it('extracts code with dash', () => {
    const [code] = extractCourseCode('CSc-1100');
    expect(code).toBe('CSc-1100');
  });

  it('extracts mixed case code', () => {
    const [code] = extractCourseCode('SocWk 1130');
    expect(code).toBe('SocWk 1130');
  });

  it('extracts code with remaining text', () => {
    const [code, remaining] = extractCourseCode('ENGL 1101 Introduction to English');
    expect(code).toBe('ENGL 1101');
    expect(remaining).toBe('Introduction to English');
  });

  // Ignored codes
  it('ignores FORMATION', () => {
    const [code, remaining] = extractCourseCode('FORMATION 123');
    expect(code).toBeNull();
    expect(remaining).toBe('FORMATION 123');
  });

  it('ignores SEMESTER', () => {
    const [code, remaining] = extractCourseCode('SEMESTER 2024');
    expect(code).toBeNull();
    expect(remaining).toBe('SEMESTER 2024');
  });

  it('ignores YEAR', () => {
    const [code, remaining] = extractCourseCode('YEAR 2024');
    expect(code).toBeNull();
    expect(remaining).toBe('YEAR 2024');
  });

  it('ignores PAGE', () => {
    const [code, remaining] = extractCourseCode('PAGE 1234');
    expect(code).toBeNull();
    expect(remaining).toBe('PAGE 1234');
  });

  it('ignores TOTAL', () => {
    const [code, remaining] = extractCourseCode('TOTAL 100A');
    expect(code).toBeNull();
    expect(remaining).toBe('TOTAL 100A');
  });

  it('ignores UNITS', () => {
    const [code, remaining] = extractCourseCode('UNITS 300');
    expect(code).toBeNull();
    expect(remaining).toBe('UNITS 300');
  });

  it('ignores codes case-insensitively', () => {
    const [code1] = extractCourseCode('Formation 123 test');
    expect(code1).toBeNull();

    const [code2] = extractCourseCode('Units 123');
    expect(code2).toBeNull();
  });

  // Empty/null input
  it('handles empty input', () => {
    const [code1, r1] = extractCourseCode('');
    expect(code1).toBeNull();
    expect(r1).toBe('');

    const [code2, r2] = extractCourseCode(null);
    expect(code2).toBeNull();
    expect(r2).toBe('');
  });

  it('handles no match', () => {
    const [code, remaining] = extractCourseCode('Introduction to Programming');
    expect(code).toBeNull();
    expect(remaining).toBe('Introduction to Programming');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// parseUnits
// ────────────────────────────────────────────────────────────────────────────

describe('parseUnits', () => {
  it('parses standard units', () => {
    expect(parseUnits('3.0')).toBe(3.0);
    expect(parseUnits('6')).toBe(6);
    expect(parseUnits('4.5')).toBe(4.5);
  });

  it('parses engineering Lec-Lab-Credit format', () => {
    expect(parseUnits('1-3-2')).toBe(2.0);
    expect(parseUnits('3-0-3')).toBe(3.0);
    expect(parseUnits('2-1-3')).toBe(3.0);
  });

  it('handles empty/null input', () => {
    expect(parseUnits('')).toBe(0.0);
    expect(parseUnits(null)).toBe(0.0);
    expect(parseUnits(undefined)).toBe(0.0);
  });

  it('strips non-numeric chars', () => {
    expect(parseUnits('3.0 units')).toBe(3.0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// cleanText
// ────────────────────────────────────────────────────────────────────────────

describe('cleanText', () => {
  it('removes extra whitespace', () => {
    expect(cleanText('  hello   world  ')).toBe('hello world');
  });

  it('handles null/empty', () => {
    expect(cleanText('')).toBe('');
    expect(cleanText(null)).toBe('');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// VALID_CODE_PATTERN
// ────────────────────────────────────────────────────────────────────────────

describe('VALID_CODE_PATTERN', () => {
  it('matches valid course codes', () => {
    const valid = ['MATH 101', 'ECE 313', 'BIO 1130', 'ENGL 1101', 'CSc-1100', 'SocWk 1130', 'PE 1', 'NSTP1'];
    for (const code of valid) {
      expect(VALID_CODE_PATTERN.test(code), `Expected "${code}" to match`).toBe(true);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// SPECIAL_SUBJECTS
// ────────────────────────────────────────────────────────────────────────────

describe('SPECIAL_SUBJECTS', () => {
  it('contains all expected subjects', () => {
    const expected = ['NSTP', 'ASSEMBLY', 'FYDP', 'OJT'];
    for (const s of expected) {
      expect(SPECIAL_SUBJECTS.has(s)).toBe(true);
    }
  });

  it('completion subjects are separate', () => {
    const expected = ['THESIS', 'PRACTICUM', 'INTERNSHIP', 'DISSERTATION'];
    for (const s of expected) {
      expect(COMPLETION_SUBJECTS.has(s)).toBe(true);
    }
  });
});
