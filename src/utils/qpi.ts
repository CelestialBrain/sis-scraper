/**
 * QPI (Quality Point Index) grade calculator for AdDU
 *
 * Implements the Ateneo grading system used by Ateneo de Davao University.
 * QPI is the Ateneo equivalent of GPA — it uses a 4.0 scale but with its
 * own letter-grade mapping and honor thresholds.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CourseGrade {
  course_code: string;
  course_title: string;
  unit: number;
  grade: string | null; // 'A', 'B+', 'B', 'C+', 'C', 'D', 'F', 'W', 'WP', 'INC', etc.
}

export interface QpiResult {
  qpi: number;
  total_units: number;
  quality_points: number;
}

export interface DeansListResult {
  eligible: boolean;
  reason?: string;
  qpi: number;
  units: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Grade-point values for grades included in QPI computation. */
export const GRADE_POINT: Record<string, number> = {
  A: 4.0,
  'B+': 3.5,
  B: 3.0,
  'C+': 2.5,
  C: 2.0,
  D: 1.0,
  F: 0.0,
  W: 0.0, // withdrawal without permission — counted in QPI
} as const;

/** Grades that are excluded from QPI computation entirely. */
export const EXCLUDED_GRADES: ReadonlySet<string> = new Set([
  'WP',
  'INC',
  'NE',
  'AUD',
  'S',
  'U',
]);

/** All recognized grade strings (QPI-bearing + excluded). */
export const ALL_GRADES: readonly string[] = [
  ...Object.keys(GRADE_POINT),
  ...EXCLUDED_GRADES,
];

/** Grades that contribute to QPI computation. */
export const QPI_GRADES: readonly string[] = Object.keys(GRADE_POINT);

/** Latin honors thresholds (inclusive lower bounds). */
export const HONORS_THRESHOLDS = {
  SUMMA_CUM_LAUDE: 3.87,
  MAGNA_CUM_LAUDE: 3.7,
  CUM_LAUDE: 3.35,
} as const;

/** Minimum QPI to qualify for the Dean's List. */
export const DEANS_LIST_QPI = 3.5;

/** Minimum enrolled units to qualify for the Dean's List. */
export const DEANS_LIST_MIN_UNITS = 12;

/** Minimum grade required — no grade below C for Dean's List. */
export const DEANS_LIST_MIN_GRADE = 'C';

// ---------------------------------------------------------------------------
// Grade-point lookup
// ---------------------------------------------------------------------------

/**
 * Returns the quality-point value for a given grade string, or `null` if the
 * grade is excluded from QPI computation (WP, INC, NE, AUD, S, U) or
 * unrecognized.
 */
export function getGradePoint(grade: string): number | null {
  const normalized = grade.trim().toUpperCase();
  if (EXCLUDED_GRADES.has(normalized)) return null;
  return GRADE_POINT[normalized] ?? null;
}

// ---------------------------------------------------------------------------
// QPI calculation
// ---------------------------------------------------------------------------

/**
 * Calculates QPI for a single list of course grades.
 *
 * Courses with null grades or excluded grades (WP, INC, etc.) are skipped.
 * Returns QPI of 0 when no qualifying courses exist.
 */
export function calculateQpi(courses: CourseGrade[]): QpiResult {
  let totalUnits = 0;
  let qualityPoints = 0;

  for (const course of courses) {
    if (course.grade === null) continue;

    const point = getGradePoint(course.grade);
    if (point === null) continue; // excluded grade

    totalUnits += course.unit;
    qualityPoints += course.unit * point;
  }

  return {
    qpi: totalUnits > 0 ? qualityPoints / totalUnits : 0,
    total_units: totalUnits,
    quality_points: qualityPoints,
  };
}

// ---------------------------------------------------------------------------
// Cumulative QPI
// ---------------------------------------------------------------------------

/**
 * Calculates QPI across multiple semesters by flattening all courses into
 * a single pool.
 */
export function calculateCumulativeQpi(
  semesters: { courses: CourseGrade[] }[],
): QpiResult {
  const allCourses = semesters.flatMap((s) => s.courses);
  return calculateQpi(allCourses);
}

// ---------------------------------------------------------------------------
// Target QPI projection
// ---------------------------------------------------------------------------

/**
 * Given a student's current standing and the number of remaining units,
 * returns the QPI they must average across those remaining units to reach
 * `targetQpi`.
 *
 * Returns `Infinity` if the target is unreachable (required > 4.0) and
 * negative values when the student has already exceeded the target (the
 * caller can treat negative as "already achieved").
 */
export function calculateRequiredQpi(
  targetQpi: number,
  currentQpi: number,
  currentUnits: number,
  remainingUnits: number,
): number {
  if (remainingUnits <= 0) return Infinity;

  const totalUnitsNeeded = currentUnits + remainingUnits;
  const totalPointsNeeded = targetQpi * totalUnitsNeeded;
  const currentPoints = currentQpi * currentUnits;
  const remainingPoints = totalPointsNeeded - currentPoints;

  return remainingPoints / remainingUnits;
}

// ---------------------------------------------------------------------------
// Dean's List eligibility
// ---------------------------------------------------------------------------

/**
 * Checks whether a set of semester grades qualifies for the Dean's List.
 *
 * Requirements:
 * 1. Minimum 3.5 QPI
 * 2. At least 12 enrolled units (QPI-bearing)
 * 3. No grade below C (i.e., no D, F, or W among QPI-bearing grades)
 */
export function checkDeansListEligibility(
  courses: CourseGrade[],
): DeansListResult {
  const { qpi, total_units: units } = calculateQpi(courses);

  // Check minimum units
  if (units < DEANS_LIST_MIN_UNITS) {
    return {
      eligible: false,
      reason: `Below minimum unit load (${units} < ${DEANS_LIST_MIN_UNITS})`,
      qpi,
      units,
    };
  }

  // Check for grades below C (D = 1.0, F = 0.0, W = 0.0)
  const minAllowed = GRADE_POINT[DEANS_LIST_MIN_GRADE]; // 2.0
  for (const course of courses) {
    if (course.grade === null) continue;
    const point = getGradePoint(course.grade);
    if (point === null) continue; // excluded grade — skip
    if (point < minAllowed) {
      return {
        eligible: false,
        reason: `Grade below C in ${course.course_code} (${course.grade})`,
        qpi,
        units,
      };
    }
  }

  // Check QPI threshold
  if (qpi < DEANS_LIST_QPI) {
    return {
      eligible: false,
      reason: `QPI ${qpi.toFixed(2)} below ${DEANS_LIST_QPI} threshold`,
      qpi,
      units,
    };
  }

  return { eligible: true, qpi, units };
}

// ---------------------------------------------------------------------------
// Latin honors
// ---------------------------------------------------------------------------

/**
 * Returns the Latin honors standing for a cumulative QPI, or `null` if the
 * QPI is below Cum Laude threshold.
 */
export function getHonorsStanding(qpi: number): string | null {
  if (qpi >= HONORS_THRESHOLDS.SUMMA_CUM_LAUDE) return 'Summa Cum Laude';
  if (qpi >= HONORS_THRESHOLDS.MAGNA_CUM_LAUDE) return 'Magna Cum Laude';
  if (qpi >= HONORS_THRESHOLDS.CUM_LAUDE) return 'Cum Laude';
  return null;
}

// ---------------------------------------------------------------------------
// QPI <-> GWA conversion
// ---------------------------------------------------------------------------

/**
 * Converts a QPI value to the equivalent GWA (General Weighted Average).
 *
 * GWA = 5.0 - QPI
 *
 * In the Philippine GWA system lower is better (1.0 = best), whereas in the
 * QPI system higher is better (4.0 = best).
 */
export function qpiToGwa(qpi: number): number {
  return 5.0 - qpi;
}

/**
 * Converts a GWA value to the equivalent QPI.
 *
 * QPI = 5.0 - GWA
 */
export function gwaToQpi(gwa: number): number {
  return 5.0 - gwa;
}
