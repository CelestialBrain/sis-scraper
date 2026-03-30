/**
 * SQLite schema — matches sisia-app conventions
 *
 * Singular table names, {table}_id PKs, snake_case columns,
 * {entity}_code for code fields, singular nouns.
 */

export const SCHEMA_SQL = `
-- Lookup tables
CREATE TABLE IF NOT EXISTS department (
    department_id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS course (
    course_id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_code TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    units REAL DEFAULT 0,
    department_id INTEGER REFERENCES department(department_id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS degree_program (
    degree_program_id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    is_honor INTEGER DEFAULT 0,
    track TEXT,
    specialization TEXT,
    version_year INTEGER,
    version_semester INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS curriculum_course (
    curriculum_course_id INTEGER PRIMARY KEY AUTOINCREMENT,
    degree_program_id INTEGER NOT NULL REFERENCES degree_program(degree_program_id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
    year INTEGER,
    semester INTEGER,
    prerequisites_raw TEXT,
    category TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(degree_program_id, course_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_course_code ON course(course_code);
CREATE INDEX IF NOT EXISTS idx_department_code ON department(department_code);
CREATE INDEX IF NOT EXISTS idx_degree_program_code ON degree_program(code);
CREATE INDEX IF NOT EXISTS idx_curriculum_degree ON curriculum_course(degree_program_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_course ON curriculum_course(course_id);
`;
