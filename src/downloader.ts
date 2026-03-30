/**
 * Concurrent PDF downloader
 *
 * Downloads PDFs and passes them to the parser.
 * Ported from main_scraper.py download_and_parse_pdf() with ThreadPoolExecutor.
 */

import type { ParsedCourse, PdfDownloadResult, DiscoveredPdf } from './types.js';
import { parseCurriculumPdf } from './parsers/index.js';
import { deriveProgramName, extractProgramNameFromUrl } from './crawler.js';
import { logger } from './utils/logger.js';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

/**
 * Download a single PDF and parse it.
 */
async function downloadAndParsePdf(pdf: DiscoveredPdf): Promise<PdfDownloadResult> {
  try {
    const programName = deriveProgramName(pdf);
    logger.info('PDF', `Downloading: ${programName} (${pdf.link_text || 'no link text'})`);

    const resp = await fetch(pdf.url, {
      headers: HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    const buffer = await resp.arrayBuffer();
    const courses = await parseCurriculumPdf(buffer, programName);

    logger.info('PDF', `Parsed ${courses.length} rows from ${programName}`);
    return { url: pdf.url, parsed_course: courses, error: null };
  } catch (err) {
    logger.error('PDF', `Error processing ${pdf.url}: ${err}`);
    return { url: pdf.url, parsed_course: [], error: err as Error };
  }
}

/**
 * Process items with controlled concurrency.
 */
async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: Promise<R>[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const promise = worker(item);
    results.push(promise);

    if (concurrency <= items.length) {
      const executingPromise = promise.then(() => {
        executing.splice(executing.indexOf(executingPromise), 1);
      }) as Promise<void>;
      executing.push(executingPromise);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
  }

  return Promise.all(results);
}

/**
 * Download and parse multiple PDFs with controlled concurrency.
 * Accepts DiscoveredPdf objects (with link text) or plain URL strings.
 */
export async function downloadAndParseAll(
  pdfs: DiscoveredPdf[],
  concurrency = 2,
): Promise<{
  all_course: ParsedCourse[];
  result: PdfDownloadResult[];
  error_count: number;
}> {
  logger.info('Download', `Processing ${pdfs.length} PDFs (concurrency=${concurrency})`);

  const startTime = Date.now();

  const results = await processWithConcurrency(
    pdfs,
    concurrency,
    downloadAndParsePdf,
  );

  let errorCount = 0;
  const allCourses: ParsedCourse[] = [];

  for (const result of results) {
    if (result.error) {
      errorCount++;
    } else {
      allCourses.push(...result.parsed_course);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info('Download', `Completed in ${elapsed}s (${errorCount} errors)`);

  return { all_course: allCourses, result: results, error_count: errorCount };
}

/**
 * Apply optional filtering based on CURRICULUM_LIMIT and CURRICULUM_SAMPLE.
 */
export function applyFilters(pdfs: DiscoveredPdf[]): DiscoveredPdf[] {
  let filtered = pdfs;
  const sample = process.env.CURRICULUM_SAMPLE;
  const limit = process.env.CURRICULUM_LIMIT;

  if (sample) {
    const samples = sample.split(',').map((s) => s.trim().toLowerCase());
    filtered = filtered.filter((pdf) =>
      samples.some((s) => pdf.url.toLowerCase().includes(s)),
    );
    logger.info('Filter', `CURRICULUM_SAMPLE applied: ${filtered.length} PDFs match`);
  }

  if (limit) {
    const n = parseInt(limit, 10);
    if (!isNaN(n) && filtered.length > n) {
      filtered = filtered.slice(0, n);
      logger.info('Filter', `CURRICULUM_LIMIT applied: limited to ${n} PDFs`);
    }
  }

  return filtered;
}
