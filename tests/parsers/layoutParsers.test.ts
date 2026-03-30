/**
 * Tests for standard and split layout parsers
 */

import { describe, it, expect } from 'vitest';
import { parseStandardLayout } from '../../src/parsers/standardLayout.js';
import { parseSplitLayout } from '../../src/parsers/splitLayout.js';
import type { Table } from '../../src/types.js';

describe('parseStandardLayout', () => {
  it('parses a basic course table', () => {
    const table: Table = [
      ['Course Code', 'Description', 'Units'],
      ['ENGL 1101', 'Introduction to English', '3.0'],
      ['MATH 101', 'College Algebra', '3.0'],
    ];

    const result = parseStandardLayout(table, 'Test Program', 1, '1st Semester');
    expect(result.course).toHaveLength(2);
    expect(result.course[0].course_code).toBe('ENGL 1101');
    expect(result.course[0].course_title).toBe('Introduction to English');
    expect(result.course[0].unit).toBe(3.0);
    expect(result.course[1].course_code).toBe('MATH 101');
  });

  it('detects year context changes', () => {
    const table: Table = [
      ['', '1st Year', ''],
      ['ENGL 1101', 'English', '3.0'],
      ['', '2nd Year', ''],
      ['ENGL 2201', 'Advanced English', '3.0'],
    ];

    const result = parseStandardLayout(table, 'Test', 1, '1st Semester');
    expect(result.course).toHaveLength(2);
    expect(result.course[0].year_level).toBe(1);
    expect(result.course[1].year_level).toBe(2);
  });

  it('detects semester context changes', () => {
    const table: Table = [
      ['', '1st Semester', ''],
      ['ENGL 1101', 'English', '3.0'],
      ['', '2nd Semester', ''],
      ['ENGL 1102', 'English II', '3.0'],
    ];

    const result = parseStandardLayout(table, 'Test', 1, '1st Semester');
    expect(result.course[0].semester).toBe('1st Semester');
    expect(result.course[1].semester).toBe('2nd Semester');
  });

  it('handles split course codes across cells', () => {
    const table: Table = [
      ['Course', 'Code', 'Title', 'Units'],
      ['SocWk', '1130', 'Social Work I', '3.0'],
    ];

    const result = parseStandardLayout(table, 'Test', 1, '1st Semester');
    expect(result.course.length).toBeGreaterThanOrEqual(1);
    if (result.course.length > 0) {
      expect(result.course[0].course_code).toContain('SocWk');
    }
  });

  it('skips total rows', () => {
    const table: Table = [
      ['MATH 101', 'Algebra', '3.0'],
      ['Total Number of Units', '', '18.0'],
    ];

    const result = parseStandardLayout(table, 'Test', 1, '1st Semester');
    expect(result.course).toHaveLength(1);
  });
});

describe('parseSplitLayout', () => {
  it('parses left and right sides as different semesters', () => {
    const table: Table = [
      // Headers: 5 left cols + 5 right cols = 10 total
      ['Course No', 'Description', 'Lec', 'Lab', 'Units', 'Course No', 'Description', 'Lec', 'Lab', 'Units'],
      ['MATH 101', 'Algebra', '3', '0', '3.0', 'MATH 102', 'Calculus', '3', '0', '3.0'],
    ];

    const result = parseSplitLayout(table, 'Engineering', 1);
    expect(result.course).toHaveLength(2);
    expect(result.course[0].semester).toBe('1st Semester');
    expect(result.course[0].course_code).toBe('MATH 101');
    expect(result.course[1].semester).toBe('2nd Semester');
    expect(result.course[1].course_code).toBe('MATH 102');
  });

  it('detects year from row text', () => {
    const table: Table = [
      ['', '', '', '', '', '', '', '', '', ''],
      ['', 'Second Year', '', '', '', '', '', '', '', ''],
      ['ECE 201', 'Circuits', '2', '1', '3.0', 'ECE 202', 'Electronics', '2', '1', '3.0'],
    ];

    const result = parseSplitLayout(table, 'Engineering', 1);
    for (const course of result.course) {
      expect(course.year_level).toBe(2);
    }
  });

  it('skips total and header rows', () => {
    const table: Table = [
      ['Course No', 'Description', 'Lec', 'Lab', 'Units', 'Course No', 'Description', 'Lec', 'Lab', 'Units'],
      ['MATH 101', 'Algebra', '3', '0', '3.0', 'MATH 102', 'Calculus', '3', '0', '3.0'],
      ['', 'Total', '', '', '15.0', '', 'Total', '', '', '15.0'],
    ];

    const result = parseSplitLayout(table, 'Eng', 1);
    expect(result.course).toHaveLength(2);
  });
});
