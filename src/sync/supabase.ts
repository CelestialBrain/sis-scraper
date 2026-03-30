/**
 * Supabase sync manager
 *
 * Ported from src/supabase.js → TypeScript with proper interfaces.
 */

import type { ParsedCourse, SyncResult } from '../types.js';
import { extractDepartmentCode } from '../db/writer.js';
import { logger } from '../utils/logger.js';

export const ALL_DEPARTMENTS_LABEL = 'All Departments';
const UNIVERSITY_CODE = 'ADDU';

// ────────────────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────────────────

export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export async function processWithConcurrency<T, R>(
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

// ────────────────────────────────────────────────────────────────────────────
// Supabase record shape
// ────────────────────────────────────────────────────────────────────────────

interface SupabaseRecord {
  term_code: string;
  program: string;
  year: number;
  semester: string;
  course_code: string;
  course_title: string;
  unit: number;
  department: string;
  level: number;
  university_code: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Manager
// ────────────────────────────────────────────────────────────────────────────

export class SupabaseManager {
  private ingestToken: string;
  private ingestEndpoint: string;
  private batchSize: number;
  private concurrency: number;
  private debugMode: boolean;

  constructor(options: {
    ingestToken?: string;
    ingestEndpoint?: string;
    batchSize?: number;
    concurrency?: number;
    debug?: boolean;
  } = {}) {
    this.ingestToken = options.ingestToken ?? process.env.DATA_INGEST_TOKEN ?? '';
    this.ingestEndpoint = options.ingestEndpoint ?? process.env.SUPABASE_INGEST_ENDPOINT ?? '';
    this.batchSize = options.batchSize ?? parseInt(process.env.SUPABASE_CLIENT_BATCH_SIZE ?? '2000');
    this.concurrency = options.concurrency ?? parseInt(process.env.SCHEDULE_SEND_CONCURRENCY ?? '5');
    this.debugMode = options.debug ?? process.env.DEBUG_SCRAPER === 'true';
  }

  isEnabled(): boolean {
    return !!(this.ingestToken && this.ingestEndpoint);
  }

  /**
   * Transform parsed courses to Supabase record format.
   */
  transformScheduleData(
    courses: (ParsedCourse & { term_code?: string })[],
  ): SupabaseRecord[] {
    return courses.map((c) => ({
      term_code: c.term_code ?? '',
      program: c.program_name,
      year: c.year_level,
      semester: c.semester,
      course_code: c.course_code,
      course_title: c.course_title,
      unit: c.unit,
      department: extractDepartmentCode(c.course_code),
      level: c.year_level,
      university_code: UNIVERSITY_CODE,
    }));
  }

  /**
   * Sync data to Supabase ingest endpoint.
   */
  async syncToSupabase(
    tableName: string,
    rows: SupabaseRecord[],
    term: string,
    departmentLabel = ALL_DEPARTMENTS_LABEL,
  ): Promise<SyncResult> {
    if (!this.isEnabled()) {
      logger.info('Supabase', 'Sync disabled (no token or endpoint configured)');
      return { success: false, reason: 'disabled' };
    }

    if (!rows || rows.length === 0) {
      return { success: true, row_synced: 0 };
    }

    logger.info('Supabase', `Syncing ${rows.length} rows to ${tableName}`);

    const chunks = chunkArray(rows, this.batchSize);
    logger.info('Supabase', `Split into ${chunks.length} batches of ${this.batchSize}`);

    let totalSynced = 0;

    await processWithConcurrency(chunks, this.concurrency, async (chunk) => {
      await this.sendBatch(tableName, chunk, term, departmentLabel);
      totalSynced += chunk.length;
    });

    logger.success('Supabase', `Sync complete: ${totalSynced} rows`);
    return { success: true, row_synced: totalSynced };
  }

  private async sendBatch(
    tableName: string,
    batch: SupabaseRecord[],
    term: string,
    department: string,
  ): Promise<void> {
    const payload = {
      table: tableName,
      term,
      department,
      records: batch,
      metadata: {
        timestamp: new Date().toISOString(),
        source: 'sis-scraper-ts',
        university_code: UNIVERSITY_CODE,
      },
    };

    if (this.debugMode) {
      logger.debug('Supabase', `Sending batch of ${batch.length} records...`);
    }

    const resp = await fetch(this.ingestEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.ingestToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
  }
}
