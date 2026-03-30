/**
 * SIS Scraper — Main Orchestrator
 *
 * Coordinates: discovery → download → parse → DB write → CSV export → sync
 */

import 'dotenv/config';
import { promises as fs } from 'fs';
import { Command } from 'commander';
import { discoverPdfUrls } from './crawler.js';
import { downloadAndParseAll, applyFilters } from './downloader.js';
import { parseCurriculumPdf } from './parsers/index.js';
import { initDatabase, closeDatabase } from './db/index.js';
import { writeParsedData } from './db/writer.js';
import { exportRawCsv, exportAisisCsv } from './sync/csvExporter.js';
import { SupabaseManager, ALL_DEPARTMENTS_LABEL } from './sync/supabase.js';
import { GoogleSheetsManager } from './sync/sheets.js';
import { BaselineManager } from './sync/baseline.js';
import { logger } from './utils/logger.js';

// ────────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────────

function getEnvInt(name: string, fallback: number): number {
  const val = process.env[name];
  if (!val) return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

// ────────────────────────────────────────────────────────────────────────────
// Commands
// ────────────────────────────────────────────────────────────────────────────

async function scrapeCommand(): Promise<void> {
  logger.divider();
  logger.step('[Scraper]', 'AdDU Curriculum Scraper (TypeScript)');
  logger.divider();

  const concurrency = getEnvInt('CURRICULUM_CONCURRENCY', 2);
  const delayMs = getEnvInt('CURRICULUM_DELAY_MS', 100);
  const dbPath = process.env.SISIA_DB_PATH ?? './data/curriculum.db';
  const spreadsheetId = process.env.SPREADSHEET_ID;

  logger.info('Config', `Concurrency: ${concurrency}`);
  logger.info('Config', `Delay: ${delayMs}ms`);
  logger.info('Config', `DB path: ${dbPath}`);

  // ── Step 1: Discover PDFs ──
  logger.step('[1/6]', 'Discovering curriculum PDFs...');
  let discoveredPdfs = await discoverPdfUrls(delayMs);

  if (discoveredPdfs.length === 0) {
    logger.error('Discovery', 'No PDFs discovered.');
    process.exit(1);
  }

  discoveredPdfs = applyFilters(discoveredPdfs);
  logger.info('Discovery', `Processing ${discoveredPdfs.length} PDFs`);

  // ── Step 2: Download & parse PDFs ──
  logger.step('[2/6]', `Processing PDFs (concurrency=${concurrency})...`);
  const { all_course, error_count } = await downloadAndParseAll(discoveredPdfs, concurrency);

  if (all_course.length === 0) {
    logger.error('Parse', 'No data extracted from PDFs.');
    process.exit(1);
  }

  logger.info('Parse', `${all_course.length} courses extracted (${error_count} errors)`);

  // ── Step 3: Write to SQLite ──
  logger.step('[3/6]', 'Writing to SQLite...');
  await fs.mkdir('data', { recursive: true });
  initDatabase(dbPath);
  const dbStats = writeParsedData(all_course);
  closeDatabase();

  // ── Step 4: Export CSVs ──
  logger.step('[4/6]', 'Exporting CSVs...');
  await exportRawCsv(all_course);
  await exportAisisCsv(all_course);

  // ── Step 5: Baseline comparison ──
  logger.step('[5/6]', 'Baseline comparison...');
  const baselineManager = new BaselineManager();
  logger.info('Baseline', `Config: ${JSON.stringify(baselineManager.getConfigSummary())}`);

  // Build department counts from parsed data
  const deptCounts: Record<string, number> = {};
  for (const c of all_course) {
    const dept = c.program_name || 'Unknown';
    deptCounts[dept] = (deptCounts[dept] ?? 0) + 1;
  }

  const term = process.env.SIS_TERM ?? 'AY2024-Current';
  const comparison = await baselineManager.compareWithBaseline(term, all_course.length, deptCounts);
  await baselineManager.recordBaseline(term, all_course.length, deptCounts, {
    timestamp: new Date().toISOString(),
  });

  const regressionFailed = baselineManager.shouldFailJob(comparison);

  // ── Step 6: Sync (Supabase + Google Sheets) ──
  logger.step('[6/6]', 'Syncing...');
  const supabaseManager = new SupabaseManager();
  const sheetsManager = new GoogleSheetsManager();

  // Add term_code to courses for sync
  const coursesWithTerm = all_course.map((c) => ({ ...c, term_code: term }));

  // Supabase
  if (supabaseManager.isEnabled()) {
    try {
      const cleanSchedule = supabaseManager.transformScheduleData(coursesWithTerm);
      await supabaseManager.syncToSupabase('curriculum', cleanSchedule, term, ALL_DEPARTMENTS_LABEL);
    } catch (err) {
      logger.warn('Supabase', `Sync failed (non-fatal): ${err}`);
    }
  } else {
    logger.info('Supabase', 'Skipped (not configured)');
  }

  // Google Sheets
  if (sheetsManager.isEnabled() && spreadsheetId) {
    try {
      await sheetsManager.init();
      const cleanSchedule = supabaseManager.transformScheduleData(coursesWithTerm);
      await sheetsManager.syncData(spreadsheetId, 'Schedules', cleanSchedule as unknown as Record<string, unknown>[]);
    } catch (err) {
      logger.warn('Sheets', `Sync failed (non-fatal): ${err}`);
    }
  } else {
    logger.info('Sheets', 'Skipped (not configured)');
  }

  // ── Summary ──
  logger.divider();
  logger.step('[Summary]', '');
  logger.info('Summary', `PDFs processed: ${discoveredPdfs.length}`);
  logger.info('Summary', `Courses extracted: ${all_course.length}`);
  logger.info('Summary', `Departments: ${dbStats.department_count}`);
  logger.info('Summary', `Programs: ${dbStats.program_count}`);
  logger.info('Summary', `DB: ${dbPath}`);
  logger.info('Summary', `CSVs: addu_curriculum_database.csv, addu_curriculum_aisis.csv`);

  if (regressionFailed) {
    logger.error('Result', 'FAILED: Baseline regression detected');
    process.exit(1);
  } else {
    logger.success('Result', 'Scraping completed successfully');
  }
}

/**
 * Debug: parse a single PDF file.
 */
async function parseCommand(pdfPath: string): Promise<void> {
  logger.info('Parse', `Parsing: ${pdfPath}`);

  const buffer = await fs.readFile(pdfPath);
  const programName = pdfPath.split('/').pop()?.replace('.pdf', '') ?? 'unknown';
  const courses = await parseCurriculumPdf(buffer, programName);

  console.log(JSON.stringify(courses, null, 2));
  logger.info('Parse', `${courses.length} courses extracted`);
}

// ────────────────────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('sis-scraper')
  .description('AdDU Curriculum Scraper (TypeScript, sisia-app aligned)')
  .version('2.0.0');

program
  .command('scrape', { isDefault: true })
  .description('Full scrape pipeline: discover → download → parse → sync')
  .action(scrapeCommand);

program
  .command('parse <pdf-path>')
  .description('Parse a single PDF file for debugging')
  .action(parseCommand);

// Error handlers
process.on('unhandledRejection', (reason) => {
  logger.error('Fatal', `Unhandled rejection: ${reason}`);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('Fatal', `Uncaught exception: ${error}`);
  process.exit(1);
});

program.parse();
