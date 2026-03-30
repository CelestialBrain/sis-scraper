/**
 * Shared parser types
 */

import type { ParsedCourse, Table, LayoutType, DetectionResult } from '../types.js';

export type { ParsedCourse, Table, LayoutType, DetectionResult };

export interface ParserContext {
  current_year: number;
  current_semester: string;
  program_name: string;
}

export interface LayoutParseResult {
  course: ParsedCourse[];
  updated_year: number;
  updated_semester: string;
}
