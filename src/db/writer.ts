/**
 * Database writer — writes parsed curriculum data to SQLite
 *
 * Normalizes flat ParsedCourse[] into the relational schema:
 *   department → course → degree_program → curriculum_course
 */

import type Database from 'better-sqlite3';
import type { ParsedCourse } from '../types.js';
import { getDb } from './index.js';
import { logger } from '../utils/logger.js';

// ────────────────────────────────────────────────────────────────────────────
// Degree code extraction
// ────────────────────────────────────────────────────────────────────────────

const FIELD_ABBREVS: Record<string, string> = {
  'COMPUTER SCIENCE': 'CS',
  'INFORMATION TECHNOLOGY': 'IT',
  'INFORMATION SYSTEMS': 'IS',
  'SOCIAL WORK': 'SW',
  'PSYCHOLOGY': 'P',
  'NURSING': 'N',
  'ACCOUNTANCY': 'A',
  'ACCOUNTING': 'A',
  'MANAGEMENT': 'M',
  'BUSINESS ADMINISTRATION': 'BA',
  'ENGINEERING': 'E',
  'MATHEMATICS': 'MATH',
  'BIOLOGY': 'BIO',
  'CHEMISTRY': 'CHEM',
  'PHYSICS': 'PHYS',
  'EDUCATION': 'ED',
  'ENGLISH': 'ENG',
  'COMMUNICATION': 'COM',
  'POLITICAL SCIENCE': 'PS',
  'ECONOMICS': 'ECON',
  'ANTHROPOLOGY': 'ANTH',
  'SOCIOLOGY': 'SOC',
  'PHILOSOPHY': 'PHIL',
  'ROBOTICS': 'ROB',
  'CIVIL ENGINEERING': 'CE',
  'ELECTRONICS ENGINEERING': 'ECE',
  'ARCHITECTURE': 'ARCH',
};

export function extractDegreeCode(programName: string): string {
  if (!programName) return '';
  const name = programName.toUpperCase();

  let prefix = '';
  if (name.includes('BACHELOR OF SCIENCE') || name.startsWith('BS ') || name.includes('B.S.')) {
    prefix = 'BS';
  } else if (name.includes('BACHELOR OF ARTS') || name.startsWith('BA ') || name.includes('B.A.')) {
    prefix = 'BA';
  } else if (name.includes('BACHELOR')) {
    prefix = 'B';
  } else if (name.includes('MASTER OF SCIENCE') || name.includes('M.S.')) {
    prefix = 'MS';
  } else if (name.includes('MASTER OF ARTS') || name.includes('M.A.')) {
    prefix = 'MA';
  } else if (name.includes('MASTER IN') || name.includes('MASTER OF')) {
    prefix = 'M';
  } else if (name.includes('DOCTOR OF PHILOSOPHY')) {
    prefix = 'DPHIL';
  } else if (name.includes('DOCTOR')) {
    prefix = 'D';
  }

  // For specific known programs, return directly
  if (name.includes('MBA') || name.includes('MASTER IN BUSINESS ADMINISTRATION')) {
    return 'MBA';
  }
  if (name.includes('MPA') || name.includes('MASTER IN PUBLIC ADMINISTRATION')) {
    return 'MPA';
  }
  if (name.includes('DBA') || name.includes('DOCTOR OF BUSINESS ADMINISTRATION')) {
    return 'DBA';
  }
  if (name.includes('DPA') || name.includes('DOCTOR OF PUBLIC ADMINISTRATION')) {
    return 'DPA';
  }

  let fieldCode = '';
  // For "Doctor of Philosophy in X", look for X, not PHILOSOPHY itself
  const fieldSearch = prefix === 'DPHIL'
    ? name.replace(/DOCTOR\s+OF\s+PHILOSOPHY/i, '').trim()
    : name;
  for (const [field, abbrev] of Object.entries(FIELD_ABBREVS)) {
    if (fieldSearch.includes(field)) {
      fieldCode = abbrev;
      break;
    }
  }

  // Fallback: first letters of significant words
  if (!fieldCode) {
    const skip = new Set([
      'BACHELOR', 'MASTER', 'DOCTOR', 'OF', 'IN', 'THE', 'AND', 'A', 'AN',
      'SCIENCE', 'ARTS', 'B.S.', 'B.A.', 'BS', 'BA', 'PHILOSOPHY', 'MAJOR',
    ]);
    const words = name.split(/\s+/).filter((w) => !skip.has(w) && w.length > 1);
    if (words.length > 0) {
      fieldCode = words.slice(0, 3).map((w) => w[0]).join('');
    }
  }

  // If prefix already contains the field info (like DPHIL), just return it with field
  if (prefix === 'DPHIL') {
    return fieldCode ? `DPHIL-${fieldCode}` : 'DPHIL';
  }

  return prefix + fieldCode;
}

/**
 * Extract the department code from a course code prefix.
 * e.g. "CSCI 111" → "CSCI", "SocWk 1130" → "SOCWK"
 */
export function extractDepartmentCode(courseCode: string): string {
  if (!courseCode) return 'UNKNOWN';
  const match = courseCode.match(/^([A-Za-z]+)/);
  return match ? match[1].toUpperCase() : 'UNKNOWN';
}

/**
 * Convert semester string to number.
 * "1st Semester" → 1, "2nd Semester" → 2, "Summer" → 3
 */
function semesterToNumber(sem: string): number {
  const lower = sem.toLowerCase();
  if (lower.includes('1st') || lower.includes('first')) return 1;
  if (lower.includes('2nd') || lower.includes('second')) return 2;
  if (lower.includes('summer')) return 3;
  return 1;
}

// ────────────────────────────────────────────────────────────────────────────
// Writer
// ────────────────────────────────────────────────────────────────────────────

/**
 * Write parsed courses to the SQLite database.
 *
 * Uses a transaction for atomicity and INSERT OR IGNORE for idempotency.
 */
export function writeParsedData(courses: ParsedCourse[]): {
  department_count: number;
  course_count: number;
  program_count: number;
  curriculum_count: number;
} {
  const db = getDb();

  // Prepare statements
  const insertDept = db.prepare(`
    INSERT OR IGNORE INTO department (department_code, name)
    VALUES (?, ?)
  `);

  const getDeptId = db.prepare(`
    SELECT department_id FROM department WHERE department_code = ?
  `);

  const insertCourse = db.prepare(`
    INSERT OR IGNORE INTO course (course_code, title, unit, department_id)
    VALUES (?, ?, ?, ?)
  `);

  const updateCourse = db.prepare(`
    UPDATE course SET title = ?, unit = ?, department_id = ?
    WHERE course_code = ? AND (title = '' OR title IS NULL OR length(?) > length(title))
  `);

  const getCourseId = db.prepare(`
    SELECT course_id FROM course WHERE course_code = ?
  `);

  const insertProgram = db.prepare(`
    INSERT OR IGNORE INTO degree_program (code, name, is_honor)
    VALUES (?, ?, ?)
  `);

  const getProgramId = db.prepare(`
    SELECT degree_program_id FROM degree_program WHERE code = ?
  `);

  const insertCurriculumCourse = db.prepare(`
    INSERT OR IGNORE INTO curriculum_course (degree_program_id, course_id, year, semester)
    VALUES (?, ?, ?, ?)
  `);

  // Track unique entities
  const departments = new Set<string>();
  const courseSet = new Set<string>();
  const programs = new Set<string>();
  let curriculumCount = 0;

  const writeAll = db.transaction(() => {
    for (const c of courses) {
      // 1. Upsert department
      const deptCode = extractDepartmentCode(c.course_code);
      if (!departments.has(deptCode)) {
        insertDept.run(deptCode, deptCode); // name = code for now
        departments.add(deptCode);
      }

      const deptRow = getDeptId.get(deptCode) as { department_id: number } | undefined;
      const deptId = deptRow?.department_id ?? null;

      // 2. Upsert course
      if (!courseSet.has(c.course_code)) {
        insertCourse.run(c.course_code, c.course_title, c.unit, deptId);
        courseSet.add(c.course_code);
      }
      // Update title if the new one is longer (better data)
      updateCourse.run(c.course_title, c.unit, deptId, c.course_code, c.course_title);

      const courseRow = getCourseId.get(c.course_code) as { course_id: number } | undefined;
      if (!courseRow) continue;

      // 3. Upsert degree program
      const degCode = extractDegreeCode(c.program_name);
      const programCode = degCode || c.program_name.slice(0, 20);
      if (!programs.has(programCode)) {
        const isHonor = c.program_name.toLowerCase().includes('honor') ? 1 : 0;
        insertProgram.run(programCode, c.program_name, isHonor);
        programs.add(programCode);
      }

      const progRow = getProgramId.get(programCode) as { degree_program_id: number } | undefined;
      if (!progRow) continue;

      // 4. Insert curriculum_course link
      const semNum = semesterToNumber(c.semester);
      insertCurriculumCourse.run(progRow.degree_program_id, courseRow.course_id, c.year_level, semNum);
      curriculumCount++;
    }
  });

  writeAll();

  const stats = {
    department_count: departments.size,
    course_count: courseSet.size,
    program_count: programs.size,
    curriculum_count: curriculumCount,
  };

  logger.info('DB', `Written: ${stats.department_count} departments, ${stats.course_count} courses, ${stats.program_count} programs, ${stats.curriculum_count} curriculum links`);
  return stats;
}
