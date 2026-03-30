/**
 * LLM-assisted PDF parser using Google Gemini
 *
 * Alternative to the regex-based parser for handling edge cases.
 * Supports dual backend: Vertex AI (service account) or Google AI Studio (API key).
 *
 * Enable via LLM_PARSER_ENABLED=true in .env
 */

import { GoogleGenAI } from '@google/genai';
import type { ParsedCourse } from '../types.js';
import { extractPdfPages } from './pdfExtractor.js';
import { postProcessRows } from './postProcessor.js';
import { logger } from '../utils/logger.js';

// ────────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────────

const LLM_MODEL = process.env.LLM_MODEL ?? 'gemini-3-flash-preview';
const VERTEX_PROJECT = process.env.VERTEX_PROJECT ?? 'bygelo-3';
const VERTEX_LOCATION = process.env.VERTEX_LOCATION ?? 'global';

// ────────────────────────────────────────────────────────────────────────────
// Client initialization (lazy singleton)
// ────────────────────────────────────────────────────────────────────────────

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (_client) return _client;

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const apiKey = process.env.GEMINI_API_KEY;

  if (credPath) {
    // Vertex AI backend — uses service account credentials
    logger.info('LLM', `Initializing Vertex AI client (project=${VERTEX_PROJECT}, location=${VERTEX_LOCATION})`);
    _client = new GoogleGenAI({
      vertexai: true,
      project: VERTEX_PROJECT,
      location: VERTEX_LOCATION,
    });
  } else if (apiKey) {
    // Google AI Studio backend — uses API key
    logger.info('LLM', 'Initializing Google AI Studio client (API key)');
    _client = new GoogleGenAI({ apiKey });
  } else {
    throw new Error(
      'LLM parser requires either GOOGLE_APPLICATION_CREDENTIALS (Vertex AI) or GEMINI_API_KEY (AI Studio). ' +
        'Set one in your .env file.',
    );
  }

  return _client;
}

// ────────────────────────────────────────────────────────────────────────────
// Text extraction helper
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract plain text from each PDF page using pdfjs-dist.
 * Groups text items by approximate line (y-coordinate) and joins them,
 * producing a readable text representation suitable for LLM input.
 */
async function extractTextFromPdf(buffer: Uint8Array): Promise<string[]> {
  const pages = await extractPdfPages(buffer);
  const pageTexts: string[] = [];

  for (const page of pages) {
    if (page.item.length === 0) {
      pageTexts.push('');
      continue;
    }

    // Group items by approximate y-coordinate (within 3px tolerance)
    const lineMap = new Map<number, { x: number; text: string }[]>();
    for (const item of page.item) {
      const yKey = Math.round(item.y / 3) * 3;
      if (!lineMap.has(yKey)) lineMap.set(yKey, []);
      lineMap.get(yKey)!.push({ x: item.x, text: item.text });
    }

    // Sort lines top-to-bottom, items left-to-right
    const sortedYs = [...lineMap.keys()].sort((a, b) => a - b);
    const lines: string[] = [];
    for (const y of sortedYs) {
      const items = lineMap.get(y)!.sort((a, b) => a.x - b.x);
      lines.push(items.map((i) => i.text).join('  '));
    }

    pageTexts.push(lines.join('\n'));
  }

  return pageTexts;
}

// ────────────────────────────────────────────────────────────────────────────
// Prompt
// ────────────────────────────────────────────────────────────────────────────

function buildPrompt(pageTexts: string[], programName: string): string {
  const pagesBlock = pageTexts
    .map((text, i) => `--- PAGE ${i + 1} ---\n${text}`)
    .join('\n\n');

  return `You are parsing an Ateneo de Davao University (AdDU) curriculum PDF that has been converted to text.
The text was extracted from a PDF and may have formatting artifacts.

The program name from the filename/URL is: "${programName}"
However, the PDF header may contain a more accurate program title — use that if you find one.

Extract ALL courses from this curriculum document and return them as a JSON array.

RULES:
1. Each course must have these fields:
   - "program_name": string — the full degree program name (e.g. "Bachelor of Science in Computer Science")
   - "year_level": number — 1, 2, 3, 4, or 5
   - "semester": string — exactly one of: "1st Semester", "2nd Semester", or "Summer"
   - "course_code": string — the course code (e.g. "CS 101", "ENGL 1", "PE 4")
   - "course_title": string — the course title/description
   - "unit": number — credit units (e.g. 3, 1, 0, 6)

2. Handle these layouts:
   - Standard stacked: Year/semester headers followed by course rows
   - Side-by-side (split): Two semesters shown in parallel columns
   - Graduate programs: May have fewer year levels, different headers

3. Important extraction rules:
   - Year levels are usually labeled "First Year", "Second Year", etc. or "Year 1", "Year 2", etc.
   - Semesters are labeled "First Semester"/"1st Semester", "Second Semester"/"2nd Semester", "Summer"/"Summer Term"
   - Skip rows that are just headers, totals ("Total", "TOTAL UNITS"), or footnotes
   - Skip non-course rows like "Comprehensive Exam", "Thesis Defense"
   - Course codes typically follow patterns like "XX 123" or "XXXX 1234" (letters followed by numbers)
   - If a course has sub-columns for Lec/Lab, use the total credit/unit value
   - Unit value of 0 is valid (e.g. for NSTP, PE, some lab courses)
   - Preserve the EXACT course code spacing (e.g. "CS 101" not "CS101")

4. If you cannot determine a field with confidence, use these defaults:
   - year_level: 1
   - semester: "1st Semester"
   - unit: 0

Return ONLY a JSON array of objects. No markdown, no explanation, just the JSON array.

CURRICULUM TEXT:
${pagesBlock}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Response parsing
// ────────────────────────────────────────────────────────────────────────────

interface LlmCourseRow {
  program_name?: string;
  year_level?: number;
  semester?: string;
  course_code?: string;
  course_title?: string;
  unit?: number;
}

const VALID_SEMESTERS = new Set(['1st Semester', '2nd Semester', 'Summer']);

/**
 * Normalize semester strings from LLM output to match expected format.
 */
function normalizeSemester(raw: string | undefined): string {
  if (!raw) return '1st Semester';
  const s = raw.trim();

  if (/^1st\s+semester$/i.test(s) || /^first\s+semester$/i.test(s)) return '1st Semester';
  if (/^2nd\s+semester$/i.test(s) || /^second\s+semester$/i.test(s)) return '2nd Semester';
  if (/^summer/i.test(s)) return 'Summer';

  // Fallback: return as-is if it matches exactly
  if (VALID_SEMESTERS.has(s)) return s;

  logger.warn('LLM', `Unrecognized semester "${s}", defaulting to "1st Semester"`);
  return '1st Semester';
}

/**
 * Parse and validate the JSON response from the LLM.
 */
function parseResponse(text: string, fallbackProgramName: string): ParsedCourse[] {
  // Strip markdown code fences if present (shouldn't be with JSON mode, but be safe)
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  let rawRows: LlmCourseRow[];
  try {
    const parsed = JSON.parse(cleaned);
    // Handle both { "courses": [...] } and direct array
    rawRows = Array.isArray(parsed) ? parsed : (parsed.courses ?? parsed.data ?? []);
  } catch (err) {
    logger.error('LLM', `Failed to parse LLM JSON response: ${err}`);
    logger.debug('LLM', `Raw response (first 500 chars): ${text.slice(0, 500)}`);
    return [];
  }

  if (!Array.isArray(rawRows)) {
    logger.error('LLM', 'LLM response did not contain an array of courses');
    return [];
  }

  const courses: ParsedCourse[] = [];

  for (const row of rawRows) {
    const code = (row.course_code ?? '').trim();
    const title = (row.course_title ?? '').trim();

    // Skip rows with no course code
    if (!code) {
      logger.debug('LLM', `Skipping row with empty course_code: ${JSON.stringify(row)}`);
      continue;
    }

    const yearLevel = typeof row.year_level === 'number' ? row.year_level : parseInt(String(row.year_level ?? '1'), 10);
    const unit = typeof row.unit === 'number' ? row.unit : parseFloat(String(row.unit ?? '0'));

    courses.push({
      program_name: (row.program_name ?? fallbackProgramName).trim(),
      year_level: isNaN(yearLevel) || yearLevel < 1 || yearLevel > 6 ? 1 : yearLevel,
      semester: normalizeSemester(row.semester),
      course_code: code,
      course_title: title || code,
      unit: isNaN(unit) ? 0 : unit,
    });
  }

  return courses;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse a curriculum PDF using Google Gemini LLM.
 *
 * @param buffer  - PDF file content as Uint8Array
 * @param programName - Program name from the filename/URL (used as fallback)
 * @returns Parsed and post-processed course list
 */
export async function parseCurriculumPdfWithLlm(
  buffer: Uint8Array,
  programName: string,
): Promise<ParsedCourse[]> {
  logger.info('LLM', `Parsing with LLM: ${programName} (model=${LLM_MODEL})`);

  // Step 1: Extract text from PDF pages
  const pageTexts = await extractTextFromPdf(buffer);
  const nonEmptyPages = pageTexts.filter((t) => t.trim().length > 0);

  if (nonEmptyPages.length === 0) {
    logger.warn('LLM', 'No text extracted from PDF — skipping LLM parse');
    return [];
  }

  logger.info('LLM', `Extracted text from ${nonEmptyPages.length} page(s)`);

  // Step 2: Build prompt and call Gemini
  const prompt = buildPrompt(pageTexts, programName);
  const client = getClient();

  let responseText: string;
  try {
    const response = await client.models.generateContent({
      model: LLM_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    responseText = response.text ?? '';

    if (!responseText) {
      logger.error('LLM', 'Empty response from Gemini');
      return [];
    }

    logger.debug('LLM', `Response length: ${responseText.length} chars`);
  } catch (err) {
    logger.error('LLM', `Gemini API error: ${err}`);
    return [];
  }

  // Step 3: Parse the JSON response
  const courses = parseResponse(responseText, programName);
  logger.info('LLM', `Raw courses from LLM: ${courses.length}`);

  // Step 4: Post-process (dedup, filter artifacts, validate codes)
  const cleaned = postProcessRows(courses);
  logger.info('LLM', `After post-processing: ${cleaned.length} courses`);

  return cleaned;
}
