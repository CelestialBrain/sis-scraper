/**
 * Tests for QPI (Quality Point Index) grade calculator
 */

import { describe, it, expect } from 'vitest';
import {
  getGradePoint,
  calculateQpi,
  calculateCumulativeQpi,
  calculateRequiredQpi,
  checkDeansListEligibility,
  getHonorsStanding,
  qpiToGwa,
  gwaToQpi,
  GRADE_POINT,
  EXCLUDED_GRADES,
  ALL_GRADES,
  QPI_GRADES,
  HONORS_THRESHOLDS,
  DEANS_LIST_QPI,
  DEANS_LIST_MIN_UNITS,
} from '../src/utils/qpi.js';
import type { CourseGrade } from '../src/utils/qpi.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCourse(
  overrides: Partial<CourseGrade> & { grade: string | null } = { grade: 'A' },
): CourseGrade {
  return {
    course_code: overrides.course_code ?? 'TEST 101',
    course_title: overrides.course_title ?? 'Test Course',
    unit: overrides.unit ?? 3,
    grade: overrides.grade,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Constants sanity checks
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('GRADE_POINT contains all 8 QPI grades', () => {
    expect(Object.keys(GRADE_POINT)).toHaveLength(8);
    expect(GRADE_POINT).toHaveProperty('A', 4.0);
    expect(GRADE_POINT).toHaveProperty('B+', 3.5);
    expect(GRADE_POINT).toHaveProperty('B', 3.0);
    expect(GRADE_POINT).toHaveProperty('C+', 2.5);
    expect(GRADE_POINT).toHaveProperty('C', 2.0);
    expect(GRADE_POINT).toHaveProperty('D', 1.0);
    expect(GRADE_POINT).toHaveProperty('F', 0.0);
    expect(GRADE_POINT).toHaveProperty('W', 0.0);
  });

  it('EXCLUDED_GRADES has WP, INC, NE, AUD, S, U', () => {
    expect(EXCLUDED_GRADES.size).toBe(6);
    for (const g of ['WP', 'INC', 'NE', 'AUD', 'S', 'U']) {
      expect(EXCLUDED_GRADES.has(g)).toBe(true);
    }
  });

  it('ALL_GRADES = QPI_GRADES + EXCLUDED_GRADES', () => {
    expect(ALL_GRADES).toHaveLength(QPI_GRADES.length + EXCLUDED_GRADES.size);
  });

  it('QPI_GRADES matches GRADE_POINT keys', () => {
    expect(QPI_GRADES).toEqual(Object.keys(GRADE_POINT));
  });

  it('honors thresholds are in descending order', () => {
    expect(HONORS_THRESHOLDS.SUMMA_CUM_LAUDE).toBeGreaterThan(
      HONORS_THRESHOLDS.MAGNA_CUM_LAUDE,
    );
    expect(HONORS_THRESHOLDS.MAGNA_CUM_LAUDE).toBeGreaterThan(
      HONORS_THRESHOLDS.CUM_LAUDE,
    );
  });

  it('DEANS_LIST constants', () => {
    expect(DEANS_LIST_QPI).toBe(3.5);
    expect(DEANS_LIST_MIN_UNITS).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// getGradePoint
// ---------------------------------------------------------------------------

describe('getGradePoint', () => {
  it.each([
    ['A', 4.0],
    ['B+', 3.5],
    ['B', 3.0],
    ['C+', 2.5],
    ['C', 2.0],
    ['D', 1.0],
    ['F', 0.0],
    ['W', 0.0],
  ])('returns %f for grade "%s"', (grade, expected) => {
    expect(getGradePoint(grade)).toBe(expected);
  });

  it.each(['WP', 'INC', 'NE', 'AUD', 'S', 'U'])(
    'returns null for excluded grade "%s"',
    (grade) => {
      expect(getGradePoint(grade)).toBeNull();
    },
  );

  it('returns null for unknown grade', () => {
    expect(getGradePoint('Z')).toBeNull();
    expect(getGradePoint('X')).toBeNull();
    expect(getGradePoint('')).toBeNull();
  });

  it('handles case insensitivity', () => {
    expect(getGradePoint('a')).toBe(4.0);
    expect(getGradePoint('b+')).toBe(3.5);
    expect(getGradePoint('inc')).toBeNull();
    expect(getGradePoint('wp')).toBeNull();
  });

  it('trims whitespace', () => {
    expect(getGradePoint('  A  ')).toBe(4.0);
    expect(getGradePoint(' B+ ')).toBe(3.5);
  });
});

// ---------------------------------------------------------------------------
// calculateQpi
// ---------------------------------------------------------------------------

describe('calculateQpi', () => {
  it('returns zero for empty list', () => {
    const result = calculateQpi([]);
    expect(result.qpi).toBe(0);
    expect(result.total_units).toBe(0);
    expect(result.quality_points).toBe(0);
  });

  it('straight-A semester (all 3-unit courses)', () => {
    const courses = [
      makeCourse({ course_code: 'CS 101', unit: 3, grade: 'A' }),
      makeCourse({ course_code: 'CS 102', unit: 3, grade: 'A' }),
      makeCourse({ course_code: 'CS 103', unit: 3, grade: 'A' }),
    ];
    const result = calculateQpi(courses);
    expect(result.qpi).toBe(4.0);
    expect(result.total_units).toBe(9);
    expect(result.quality_points).toBe(36);
  });

  it('mixed grades with different units', () => {
    // 3 units x A(4.0) = 12, 3 units x B(3.0) = 9, 3 units x C(2.0) = 6
    // Total: 27 quality points / 9 units = 3.0
    const courses = [
      makeCourse({ course_code: 'ENG 101', unit: 3, grade: 'A' }),
      makeCourse({ course_code: 'MATH 201', unit: 3, grade: 'B' }),
      makeCourse({ course_code: 'HIST 101', unit: 3, grade: 'C' }),
    ];
    const result = calculateQpi(courses);
    expect(result.qpi).toBe(3.0);
    expect(result.total_units).toBe(9);
    expect(result.quality_points).toBe(27);
  });

  it('handles weighted units correctly', () => {
    // 5 units x A(4.0) = 20, 1 unit x F(0.0) = 0
    // Total: 20 quality points / 6 units = 3.333...
    const courses = [
      makeCourse({ course_code: 'CS 401', unit: 5, grade: 'A' }),
      makeCourse({ course_code: 'PE 1', unit: 1, grade: 'F' }),
    ];
    const result = calculateQpi(courses);
    expect(result.qpi).toBeCloseTo(20 / 6, 10);
    expect(result.total_units).toBe(6);
    expect(result.quality_points).toBe(20);
  });

  it('excludes courses with null grades', () => {
    const courses = [
      makeCourse({ course_code: 'CS 101', unit: 3, grade: 'A' }),
      makeCourse({ course_code: 'CS 102', unit: 3, grade: null }),
    ];
    const result = calculateQpi(courses);
    expect(result.qpi).toBe(4.0);
    expect(result.total_units).toBe(3);
  });

  it('excludes courses with excluded grades (WP, INC, etc.)', () => {
    const courses = [
      makeCourse({ course_code: 'CS 101', unit: 3, grade: 'A' }),
      makeCourse({ course_code: 'CS 102', unit: 3, grade: 'WP' }),
      makeCourse({ course_code: 'CS 103', unit: 3, grade: 'INC' }),
      makeCourse({ course_code: 'CS 104', unit: 3, grade: 'NE' }),
      makeCourse({ course_code: 'CS 105', unit: 2, grade: 'AUD' }),
      makeCourse({ course_code: 'CS 106', unit: 3, grade: 'S' }),
      makeCourse({ course_code: 'CS 107', unit: 3, grade: 'U' }),
    ];
    const result = calculateQpi(courses);
    // Only the first course should count
    expect(result.qpi).toBe(4.0);
    expect(result.total_units).toBe(3);
    expect(result.quality_points).toBe(12);
  });

  it('W grade IS counted (0 quality points, but units count)', () => {
    const courses = [
      makeCourse({ course_code: 'CS 101', unit: 3, grade: 'A' }),
      makeCourse({ course_code: 'CS 102', unit: 3, grade: 'W' }),
    ];
    const result = calculateQpi(courses);
    // 12 + 0 = 12 quality points / 6 units = 2.0
    expect(result.qpi).toBe(2.0);
    expect(result.total_units).toBe(6);
    expect(result.quality_points).toBe(12);
  });

  it('all-F semester yields QPI 0', () => {
    const courses = [
      makeCourse({ course_code: 'CS 101', unit: 3, grade: 'F' }),
      makeCourse({ course_code: 'CS 102', unit: 3, grade: 'F' }),
    ];
    const result = calculateQpi(courses);
    expect(result.qpi).toBe(0);
    expect(result.total_units).toBe(6);
    expect(result.quality_points).toBe(0);
  });

  it('only excluded/null grades returns zero QPI with zero units', () => {
    const courses = [
      makeCourse({ course_code: 'CS 101', unit: 3, grade: 'WP' }),
      makeCourse({ course_code: 'CS 102', unit: 3, grade: null }),
    ];
    const result = calculateQpi(courses);
    expect(result.qpi).toBe(0);
    expect(result.total_units).toBe(0);
    expect(result.quality_points).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateCumulativeQpi
// ---------------------------------------------------------------------------

describe('calculateCumulativeQpi', () => {
  it('returns zero for no semesters', () => {
    const result = calculateCumulativeQpi([]);
    expect(result.qpi).toBe(0);
    expect(result.total_units).toBe(0);
  });

  it('single semester equals calculateQpi', () => {
    const courses = [
      makeCourse({ unit: 3, grade: 'A' }),
      makeCourse({ unit: 3, grade: 'B' }),
    ];
    const single = calculateQpi(courses);
    const cumulative = calculateCumulativeQpi([{ courses }]);
    expect(cumulative.qpi).toBe(single.qpi);
    expect(cumulative.total_units).toBe(single.total_units);
    expect(cumulative.quality_points).toBe(single.quality_points);
  });

  it('aggregates across multiple semesters', () => {
    const sem1 = [
      makeCourse({ unit: 3, grade: 'A' }), // 12
      makeCourse({ unit: 3, grade: 'B' }), // 9
    ]; // 21 points, 6 units
    const sem2 = [
      makeCourse({ unit: 3, grade: 'C' }), // 6
      makeCourse({ unit: 3, grade: 'C+' }), // 7.5
    ]; // 13.5 points, 6 units
    const result = calculateCumulativeQpi([
      { courses: sem1 },
      { courses: sem2 },
    ]);
    // Total: 34.5 / 12 = 2.875
    expect(result.qpi).toBeCloseTo(2.875, 10);
    expect(result.total_units).toBe(12);
    expect(result.quality_points).toBe(34.5);
  });

  it('skips empty semesters', () => {
    const sem1 = [makeCourse({ unit: 3, grade: 'A' })];
    const result = calculateCumulativeQpi([
      { courses: sem1 },
      { courses: [] },
    ]);
    expect(result.qpi).toBe(4.0);
    expect(result.total_units).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// calculateRequiredQpi
// ---------------------------------------------------------------------------

describe('calculateRequiredQpi', () => {
  it('returns required QPI to reach target', () => {
    // Current: 3.0 QPI, 30 units. Want 3.5 across 60 total units.
    // Need: (3.5 * 60 - 3.0 * 30) / 30 = (210 - 90) / 30 = 4.0
    const required = calculateRequiredQpi(3.5, 3.0, 30, 30);
    expect(required).toBeCloseTo(4.0, 10);
  });

  it('returns value above 4.0 when target is unreachable', () => {
    // Current: 2.0 QPI, 90 units. Want 3.5 across 100 total units.
    // Need: (3.5 * 100 - 2.0 * 90) / 10 = (350 - 180) / 10 = 17.0
    const required = calculateRequiredQpi(3.5, 2.0, 90, 10);
    expect(required).toBeGreaterThan(4.0);
  });

  it('returns negative when target already exceeded', () => {
    // Current: 3.8 QPI, 90 units. Want 3.5 across 120 total units.
    // Need: (3.5 * 120 - 3.8 * 90) / 30 = (420 - 342) / 30 = 2.6
    const required = calculateRequiredQpi(3.5, 3.8, 90, 30);
    expect(required).toBeCloseTo(2.6, 10);
  });

  it('returns Infinity when remaining units is 0', () => {
    const required = calculateRequiredQpi(3.5, 3.0, 120, 0);
    expect(required).toBe(Infinity);
  });

  it('returns Infinity for negative remaining units', () => {
    const required = calculateRequiredQpi(3.5, 3.0, 120, -5);
    expect(required).toBe(Infinity);
  });

  it('freshman starting from zero', () => {
    // No current units, want 3.5 over 18 units
    // Need: (3.5 * 18 - 0) / 18 = 3.5
    const required = calculateRequiredQpi(3.5, 0, 0, 18);
    expect(required).toBeCloseTo(3.5, 10);
  });
});

// ---------------------------------------------------------------------------
// checkDeansListEligibility
// ---------------------------------------------------------------------------

describe('checkDeansListEligibility', () => {
  it('eligible — good QPI, enough units, no low grades', () => {
    const courses = [
      makeCourse({ unit: 3, grade: 'A' }),
      makeCourse({ unit: 3, grade: 'A' }),
      makeCourse({ unit: 3, grade: 'B+' }),
      makeCourse({ unit: 3, grade: 'B+' }),
    ]; // QPI = (12+12+10.5+10.5)/12 = 3.75, 12 units
    const result = checkDeansListEligibility(courses);
    expect(result.eligible).toBe(true);
    expect(result.qpi).toBe(3.75);
    expect(result.units).toBe(12);
    expect(result.reason).toBeUndefined();
  });

  it('ineligible — below minimum units', () => {
    const courses = [
      makeCourse({ unit: 3, grade: 'A' }),
      makeCourse({ unit: 3, grade: 'A' }),
      makeCourse({ unit: 3, grade: 'A' }),
    ]; // 9 units
    const result = checkDeansListEligibility(courses);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('minimum unit load');
    expect(result.units).toBe(9);
  });

  it('ineligible — grade below C', () => {
    const courses = [
      makeCourse({ course_code: 'CS 101', unit: 3, grade: 'A' }),
      makeCourse({ course_code: 'CS 102', unit: 3, grade: 'A' }),
      makeCourse({ course_code: 'CS 103', unit: 3, grade: 'A' }),
      makeCourse({ course_code: 'CS 104', unit: 3, grade: 'D' }),
    ];
    const result = checkDeansListEligibility(courses);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('Grade below C');
    expect(result.reason).toContain('CS 104');
  });

  it('ineligible — F grade', () => {
    const courses = [
      makeCourse({ course_code: 'CS 101', unit: 3, grade: 'A' }),
      makeCourse({ course_code: 'CS 102', unit: 3, grade: 'A' }),
      makeCourse({ course_code: 'CS 103', unit: 3, grade: 'A' }),
      makeCourse({ course_code: 'BAD 101', unit: 3, grade: 'F' }),
    ];
    const result = checkDeansListEligibility(courses);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('Grade below C');
    expect(result.reason).toContain('BAD 101');
  });

  it('ineligible — W grade counts as below C', () => {
    const courses = [
      makeCourse({ course_code: 'CS 101', unit: 3, grade: 'A' }),
      makeCourse({ course_code: 'CS 102', unit: 3, grade: 'A' }),
      makeCourse({ course_code: 'CS 103', unit: 3, grade: 'A' }),
      makeCourse({ course_code: 'CS 104', unit: 3, grade: 'W' }),
    ];
    const result = checkDeansListEligibility(courses);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('Grade below C');
    expect(result.reason).toContain('CS 104');
  });

  it('ineligible — QPI below 3.5 but no bad grades', () => {
    const courses = [
      makeCourse({ unit: 3, grade: 'B' }),
      makeCourse({ unit: 3, grade: 'B' }),
      makeCourse({ unit: 3, grade: 'B' }),
      makeCourse({ unit: 3, grade: 'B' }),
    ]; // QPI = 3.0, all grades >= C
    const result = checkDeansListEligibility(courses);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('below');
    expect(result.reason).toContain('3.5');
  });

  it('excluded grades do not affect Dean\'s List check', () => {
    const courses = [
      makeCourse({ unit: 3, grade: 'A' }),
      makeCourse({ unit: 3, grade: 'A' }),
      makeCourse({ unit: 3, grade: 'A' }),
      makeCourse({ unit: 3, grade: 'A' }),
      makeCourse({ unit: 3, grade: 'INC' }), // excluded
      makeCourse({ unit: 3, grade: 'WP' }), // excluded
    ]; // Only 12 QPI-bearing units; QPI = 4.0
    const result = checkDeansListEligibility(courses);
    expect(result.eligible).toBe(true);
    expect(result.qpi).toBe(4.0);
    expect(result.units).toBe(12);
  });

  it('exactly at boundary — 3.5 QPI and 12 units', () => {
    // Need exactly 3.5 QPI with 12 units
    // 4 courses, all B+ (3.5 each) = 3.5 QPI
    const courses = [
      makeCourse({ unit: 3, grade: 'B+' }),
      makeCourse({ unit: 3, grade: 'B+' }),
      makeCourse({ unit: 3, grade: 'B+' }),
      makeCourse({ unit: 3, grade: 'B+' }),
    ];
    const result = checkDeansListEligibility(courses);
    expect(result.eligible).toBe(true);
    expect(result.qpi).toBe(3.5);
    expect(result.units).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// getHonorsStanding
// ---------------------------------------------------------------------------

describe('getHonorsStanding', () => {
  it('returns Summa Cum Laude at 3.87', () => {
    expect(getHonorsStanding(3.87)).toBe('Summa Cum Laude');
  });

  it('returns Summa Cum Laude at 4.0', () => {
    expect(getHonorsStanding(4.0)).toBe('Summa Cum Laude');
  });

  it('returns Magna Cum Laude at 3.70', () => {
    expect(getHonorsStanding(3.7)).toBe('Magna Cum Laude');
  });

  it('returns Magna Cum Laude at 3.86', () => {
    expect(getHonorsStanding(3.86)).toBe('Magna Cum Laude');
  });

  it('returns Cum Laude at 3.35', () => {
    expect(getHonorsStanding(3.35)).toBe('Cum Laude');
  });

  it('returns Cum Laude at 3.69', () => {
    expect(getHonorsStanding(3.69)).toBe('Cum Laude');
  });

  it('returns null just below Cum Laude threshold', () => {
    expect(getHonorsStanding(3.34)).toBeNull();
  });

  it('returns null for low QPI', () => {
    expect(getHonorsStanding(2.0)).toBeNull();
    expect(getHonorsStanding(0)).toBeNull();
  });

  it('boundary: 3.349 is not Cum Laude', () => {
    expect(getHonorsStanding(3.349)).toBeNull();
  });

  it('boundary: 3.699 is Cum Laude, not Magna', () => {
    expect(getHonorsStanding(3.699)).toBe('Cum Laude');
  });

  it('boundary: 3.869 is Magna, not Summa', () => {
    expect(getHonorsStanding(3.869)).toBe('Magna Cum Laude');
  });
});

// ---------------------------------------------------------------------------
// QPI <-> GWA conversion
// ---------------------------------------------------------------------------

describe('qpiToGwa / gwaToQpi', () => {
  it('A (4.0 QPI) converts to 1.0 GWA', () => {
    expect(qpiToGwa(4.0)).toBe(1.0);
  });

  it('F (0.0 QPI) converts to 5.0 GWA', () => {
    expect(qpiToGwa(0.0)).toBe(5.0);
  });

  it('3.0 QPI converts to 2.0 GWA', () => {
    expect(qpiToGwa(3.0)).toBe(2.0);
  });

  it('1.0 GWA converts to 4.0 QPI', () => {
    expect(gwaToQpi(1.0)).toBe(4.0);
  });

  it('5.0 GWA converts to 0.0 QPI', () => {
    expect(gwaToQpi(5.0)).toBe(0.0);
  });

  it('3.0 GWA converts to 2.0 QPI', () => {
    expect(gwaToQpi(3.0)).toBe(2.0);
  });

  it('round-trip: qpiToGwa(gwaToQpi(x)) === x', () => {
    for (const gwa of [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0]) {
      expect(qpiToGwa(gwaToQpi(gwa))).toBeCloseTo(gwa, 10);
    }
  });

  it('round-trip: gwaToQpi(qpiToGwa(x)) === x', () => {
    for (const qpi of [0.0, 1.0, 2.0, 2.5, 3.0, 3.5, 4.0]) {
      expect(gwaToQpi(qpiToGwa(qpi))).toBeCloseTo(qpi, 10);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration / realistic scenario
// ---------------------------------------------------------------------------

describe('realistic scenario', () => {
  it('full semester with mixed grades, excluded grades, and null', () => {
    const courses: CourseGrade[] = [
      { course_code: 'CS 111', course_title: 'Intro to Computing', unit: 3, grade: 'A' },
      { course_code: 'MATH 101', course_title: 'College Algebra', unit: 3, grade: 'B+' },
      { course_code: 'ENG 101', course_title: 'English Composition', unit: 3, grade: 'B' },
      { course_code: 'FIL 101', course_title: 'Filipino', unit: 3, grade: 'C+' },
      { course_code: 'NSTP 1', course_title: 'NSTP', unit: 3, grade: 'S' }, // excluded
      { course_code: 'PE 1', course_title: 'Physical Education', unit: 2, grade: 'A' },
      { course_code: 'THEO 101', course_title: 'Theology', unit: 3, grade: null }, // no grade yet
    ];

    const result = calculateQpi(courses);
    // QPI-bearing: CS(3*4=12), MATH(3*3.5=10.5), ENG(3*3=9), FIL(3*2.5=7.5), PE(2*4=8)
    // Total points: 47, Total units: 14
    expect(result.quality_points).toBe(47);
    expect(result.total_units).toBe(14);
    expect(result.qpi).toBeCloseTo(47 / 14, 10);

    // Honors check
    const honors = getHonorsStanding(result.qpi); // ~3.357
    expect(honors).toBe('Cum Laude');

    // Dean's List check
    const deansList = checkDeansListEligibility(courses);
    expect(deansList.eligible).toBe(false); // QPI ~3.357 < 3.5
    expect(deansList.reason).toContain('below');
  });

  it('cumulative QPI over 4 semesters', () => {
    const semesters = [
      {
        courses: [
          makeCourse({ unit: 3, grade: 'A' }),
          makeCourse({ unit: 3, grade: 'A' }),
          makeCourse({ unit: 3, grade: 'B+' }),
          makeCourse({ unit: 3, grade: 'B+' }),
          makeCourse({ unit: 3, grade: 'B' }),
        ],
      },
      {
        courses: [
          makeCourse({ unit: 3, grade: 'A' }),
          makeCourse({ unit: 3, grade: 'B+' }),
          makeCourse({ unit: 3, grade: 'B+' }),
          makeCourse({ unit: 3, grade: 'B' }),
          makeCourse({ unit: 3, grade: 'B' }),
        ],
      },
      {
        courses: [
          makeCourse({ unit: 3, grade: 'A' }),
          makeCourse({ unit: 3, grade: 'A' }),
          makeCourse({ unit: 3, grade: 'A' }),
          makeCourse({ unit: 3, grade: 'B+' }),
          makeCourse({ unit: 3, grade: 'B+' }),
        ],
      },
      {
        courses: [
          makeCourse({ unit: 3, grade: 'A' }),
          makeCourse({ unit: 3, grade: 'A' }),
          makeCourse({ unit: 3, grade: 'A' }),
          makeCourse({ unit: 3, grade: 'A' }),
          makeCourse({ unit: 3, grade: 'B+' }),
        ],
      },
    ];

    const result = calculateCumulativeQpi(semesters);
    expect(result.total_units).toBe(60);

    // Sem1: 12+12+10.5+10.5+9 = 54
    // Sem2: 12+10.5+10.5+9+9 = 51
    // Sem3: 12+12+12+10.5+10.5 = 57
    // Sem4: 12+12+12+12+10.5 = 58.5
    // Total: 220.5 / 60 = 3.675
    expect(result.quality_points).toBe(220.5);
    expect(result.qpi).toBeCloseTo(3.675, 10);

    // Should be Magna Cum Laude (>= 3.70 is Magna, 3.675 is Cum Laude)
    expect(getHonorsStanding(result.qpi)).toBe('Cum Laude');
  });
});
