/**
 * Tests for postProcessor — ported from test_scraper.py TestPostProcessRows
 */

import { describe, it, expect } from 'vitest';
import { postProcessRows } from '../../src/parsers/postProcessor.js';
import type { ParsedCourse } from '../../src/types.js';

function makeRow(
  overrides: Partial<ParsedCourse> & { course_code: string } = { course_code: 'MATH 101' },
): ParsedCourse {
  return {
    program_name: 'Test Program',
    year_level: 1,
    semester: '1st Semester',
    course_code: overrides.course_code,
    course_title: overrides.course_title ?? 'Test Course',
    unit: overrides.unit ?? 3.0,
    ...overrides,
  };
}

describe('postProcessRows', () => {
  it('returns empty for empty input', () => {
    expect(postProcessRows([])).toEqual([]);
  });

  it('preserves valid rows', () => {
    const rows = [
      makeRow({ course_code: 'MATH 101', course_title: 'Introduction to Math', unit: 3.0 }),
      makeRow({ course_code: 'ECE 313', course_title: 'Digital Electronics', unit: 6.0 }),
      makeRow({ course_code: 'BIO 1130', course_title: 'General Biology', unit: 4.0 }),
    ];
    const result = postProcessRows(rows);
    expect(result).toHaveLength(3);
    expect(result[0].course_code).toBe('MATH 101');
    expect(result[1].course_code).toBe('ECE 313');
    expect(result[2].course_code).toBe('BIO 1130');
  });

  it('drops header bleed codes', () => {
    const rows = [
      makeRow({ course_code: 'Effective 2019', course_title: '' }),
      makeRow({ course_code: 'Revised 2008', course_title: 'Curriculum' }),
      makeRow({ course_code: 'MATH 101', course_title: 'Valid course', unit: 3.0 }),
    ];
    const result = postProcessRows(rows);
    expect(result).toHaveLength(1);
    expect(result[0].course_code).toBe('MATH 101');
  });

  it('drops header bleed titles', () => {
    const rows = [
      makeRow({ course_code: 'BS 1234', course_title: 'Curriculum Effective 2019-2020' }),
      makeRow({ course_code: 'XY 100', course_title: 'Semester SY 2019-2020' }),
      makeRow({ course_code: 'ENGL 1101', course_title: 'Valid English Course', unit: 3.0 }),
    ];
    const result = postProcessRows(rows);
    expect(result).toHaveLength(1);
    expect(result[0].course_code).toBe('ENGL 1101');
  });

  it('drops rows with absurd units (>30)', () => {
    const rows = [
      makeRow({ course_code: 'MATH 101', unit: 3.0 }),
      makeRow({ course_code: 'ECE 200', unit: 573.0 }),
      makeRow({ course_code: 'BIO 300', unit: 910911.0 }),
      makeRow({ course_code: 'PHYS 101', unit: 6.0 }),
    ];
    const result = postProcessRows(rows);
    expect(result).toHaveLength(2);
    expect(result[0].course_code).toBe('MATH 101');
    expect(result[1].course_code).toBe('PHYS 101');
  });

  it('preserves normal units up to 30', () => {
    const rows = [
      makeRow({ course_code: 'MATH 101', unit: 3.0 }),
      makeRow({ course_code: 'ECE 200', unit: 6.0 }),
      makeRow({ course_code: 'THESIS 500', unit: 12.0 }),
      makeRow({ course_code: 'THESIS 600', unit: 30.0 }),
    ];
    expect(postProcessRows(rows)).toHaveLength(4);
  });

  it('drops codes with 4-digit years', () => {
    const rows = [
      makeRow({ course_code: '2024', unit: 3.0 }),
      makeRow({ course_code: 'MATH 101', unit: 3.0 }),
    ];
    const result = postProcessRows(rows);
    expect(result).toHaveLength(1);
    expect(result[0].course_code).toBe('MATH 101');
  });

  it('drops very short invalid codes', () => {
    const rows = [
      makeRow({ course_code: 'une' }),
      makeRow({ course_code: 'XY' }),
      makeRow({ course_code: 'MATH 101' }),
    ];
    const result = postProcessRows(rows);
    expect(result).toHaveLength(1);
    expect(result[0].course_code).toBe('MATH 101');
  });

  it('preserves special subjects', () => {
    const rows = [
      makeRow({ course_code: 'NSTP', unit: 3.0 }),
      makeRow({ course_code: 'NSTP-1', unit: 3.0 }),
      makeRow({ course_code: 'THESIS', unit: 6.0 }),
      makeRow({ course_code: 'ASSEMBLY', unit: 0.0 }),
      makeRow({ course_code: 'FYDP', unit: 6.0 }),
      makeRow({ course_code: 'OJT', unit: 3.0 }),
      makeRow({ course_code: 'PRACTICUM', unit: 6.0 }),
      makeRow({ course_code: 'INTERNSHIP', unit: 6.0 }),
    ];
    expect(postProcessRows(rows)).toHaveLength(8);
  });

  it('preserves mixed-case codes', () => {
    const rows = [
      makeRow({ course_code: 'SocWk 1130', unit: 3.0 }),
      makeRow({ course_code: 'Anthro 1201', unit: 3.0 }),
    ];
    const result = postProcessRows(rows);
    expect(result).toHaveLength(2);
  });
});
