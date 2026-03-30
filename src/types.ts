/**
 * Core TypeScript interfaces for sis-scraper
 *
 * Follows sisia-app naming conventions:
 * - snake_case for all column/field names
 * - {entity}_code pattern for code fields
 * - singular nouns (unit, not units)
 * - {table}_id for primary keys
 */

// ---------------------------------------------------------------------------
// Parsed intermediate format (output of PDF parsers, before DB normalization)
// ---------------------------------------------------------------------------

export interface ParsedCourse {
  program_name: string;
  year_level: number;
  semester: string; // "1st Semester" | "2nd Semester" | "Summer"
  course_code: string;
  course_title: string;
  unit: number;
}

// ---------------------------------------------------------------------------
// DB row types — match sisia-app schema
// ---------------------------------------------------------------------------

export interface DepartmentRow {
  department_id?: number;
  department_code: string;
  name: string;
  created_at?: string;
}

export interface CourseRow {
  course_id?: number;
  course_code: string;
  title: string;
  units: number;
  department_id: number | null;
  created_at?: string;
}

export interface DegreeProgramRow {
  degree_program_id?: number;
  code: string; // e.g. "BSCS_2024_1"
  name: string;
  is_honor: number; // 0 | 1
  track: string | null;
  specialization: string | null;
  version_year: number | null;
  version_semester: number | null;
  created_at?: string;
}

export interface CurriculumCourseRow {
  curriculum_course_id?: number;
  degree_program_id: number;
  course_id: number;
  year: number; // 1-5
  semester: number; // 1, 2, 3 (summer)
  prerequisites_raw: string | null;
  category: string | null;
  created_at?: string;
}

// ---------------------------------------------------------------------------
// PDF extraction types
// ---------------------------------------------------------------------------

export interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font_name: string;
}

export interface PageTextItems {
  page_number: number;
  width: number;
  height: number;
  item: TextItem[];
}

export type Table = string[][];

export type LayoutType = 'standard' | 'split';

export interface DetectionResult {
  layout: LayoutType;
  reason: string;
}

export interface ParserContext {
  current_year: number;
  current_semester: string;
  program_name: string;
}

// ---------------------------------------------------------------------------
// Download / crawl types
// ---------------------------------------------------------------------------

export interface DiscoveredPdf {
  url: string;
  link_text: string; // Text from the <a> tag that linked to this PDF
  source_page: string; // URL of the page where the link was found
}

export interface PdfDownloadResult {
  url: string;
  parsed_course: ParsedCourse[];
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Sync types
// ---------------------------------------------------------------------------

export interface SyncResult {
  success: boolean;
  reason?: string;
  row_synced?: number;
}

export interface BaselineData {
  terms: Record<string, TermBaseline>;
}

export interface TermBaseline {
  total_count: number;
  dept_count: Record<string, number>;
  timestamp: string;
}

export interface ComparisonResult {
  is_first_run: boolean;
  has_regression: boolean;
  total_count: number;
  previous_total?: number;
  delta?: number;
  percent_change?: number;
  dept_regression: DeptRegression[];
}

export interface DeptRegression {
  department: string;
  previous: number;
  current: number;
  delta: number;
  percent_change: number;
}

// ---------------------------------------------------------------------------
// AISIS export schema (backward-compatible CSV)
// ---------------------------------------------------------------------------

export interface AisisRow {
  deg_code: string;
  program_label: string;
  program_title: string;
  year_level: number;
  semester: string;
  course_code: string;
  course_title: string;
  unit: number;
  prerequisite: string;
  category: string;
  university_code: string;
}
