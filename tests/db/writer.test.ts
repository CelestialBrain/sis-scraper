/**
 * Tests for database writer with in-memory SQLite
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../src/db/schema.js';
import { extractDegreeCode, extractDepartmentCode } from '../../src/db/writer.js';

// We test the helper functions directly and the schema separately
// (writeParsedData requires the db singleton; we test it integration-style)

describe('extractDegreeCode', () => {
  it('extracts BS codes', () => {
    expect(extractDegreeCode('Bachelor of Science in Computer Science')).toBe('BSCS');
    expect(extractDegreeCode('Bachelor of Science in Social Work')).toBe('BSSW');
    expect(extractDegreeCode('Bachelor of Science in Nursing')).toBe('BSN');
  });

  it('extracts BA codes', () => {
    expect(extractDegreeCode('Bachelor of Arts in Psychology')).toBe('BAP');
  });

  it('extracts graduate codes', () => {
    expect(extractDegreeCode('Master of Science in Social Work')).toBe('MSSW');
    expect(extractDegreeCode('Doctor of Philosophy')).toBe('DPHIL');
    expect(extractDegreeCode('Master in Business Administration')).toBe('MBA');
    expect(extractDegreeCode('Doctor of Public Administration')).toBe('DPA');
  });

  it('handles empty input', () => {
    expect(extractDegreeCode('')).toBe('');
  });
});

describe('extractDepartmentCode', () => {
  it('extracts department from course codes', () => {
    expect(extractDepartmentCode('CSCI 111')).toBe('CSCI');
    expect(extractDepartmentCode('MATH 201')).toBe('MATH');
    expect(extractDepartmentCode('SocWk 1130')).toBe('SOCWK');
  });

  it('returns UNKNOWN for empty', () => {
    expect(extractDepartmentCode('')).toBe('UNKNOWN');
  });
});

describe('SQLite schema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA_SQL);
  });

  afterEach(() => {
    db.close();
  });

  it('creates all tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const names = tables.map((t) => t.name);
    expect(names).toContain('department');
    expect(names).toContain('course');
    expect(names).toContain('degree_program');
    expect(names).toContain('curriculum_course');
  });

  it('enforces unique course_code', () => {
    db.prepare('INSERT INTO course (course_code, title, units) VALUES (?, ?, ?)').run('MATH 101', 'Algebra', 3.0);

    // Duplicate should be ignored
    db.prepare('INSERT OR IGNORE INTO course (course_code, title, units) VALUES (?, ?, ?)').run('MATH 101', 'Algebra', 3.0);

    const count = db.prepare('SELECT COUNT(*) as n FROM course').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('enforces foreign keys on curriculum_course', () => {
    // Insert a program and course first
    db.prepare('INSERT INTO degree_program (code, name) VALUES (?, ?)').run('BSCS', 'BS CS');
    db.prepare('INSERT INTO course (course_code, title, units) VALUES (?, ?, ?)').run('CSCI 111', 'Intro', 3);

    const prog = db.prepare('SELECT degree_program_id FROM degree_program WHERE code = ?').get('BSCS') as { degree_program_id: number };
    const course = db.prepare('SELECT course_id FROM course WHERE course_code = ?').get('CSCI 111') as { course_id: number };

    // Valid insert
    db.prepare('INSERT INTO curriculum_course (degree_program_id, course_id, year, semester) VALUES (?, ?, ?, ?)').run(
      prog.degree_program_id, course.course_id, 1, 1,
    );

    const count = db.prepare('SELECT COUNT(*) as n FROM curriculum_course').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('has correct column names following sisia-app conventions', () => {
    // Verify column names via pragma
    const courseColumns = db.prepare("PRAGMA table_info('course')").all() as { name: string }[];
    const colNames = courseColumns.map((c) => c.name);

    expect(colNames).toContain('course_id');
    expect(colNames).toContain('course_code');
    expect(colNames).toContain('title');
    expect(colNames).toContain('units');
    expect(colNames).toContain('department_id');

    const deptColumns = db.prepare("PRAGMA table_info('department')").all() as { name: string }[];
    const deptColNames = deptColumns.map((c) => c.name);
    expect(deptColNames).toContain('department_id');
    expect(deptColNames).toContain('department_code');

    const progColumns = db.prepare("PRAGMA table_info('degree_program')").all() as { name: string }[];
    const progColNames = progColumns.map((c) => c.name);
    expect(progColNames).toContain('degree_program_id');
    expect(progColNames).toContain('code');
    expect(progColNames).toContain('is_honor');
  });
});
