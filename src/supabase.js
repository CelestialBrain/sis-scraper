/**
 * Supabase Manager Module
 * 
 * Handles data transformation and sync to Supabase/DB endpoint.
 * Mirrors the architecture of SupabaseManager from aisis-scraper.
 */

export const ALL_DEPARTMENTS_LABEL = 'All Departments';

/**
 * Chunk an array into smaller arrays of specified size
 * 
 * @param {Array} array - Array to chunk
 * @param {number} size - Chunk size
 * @returns {Array<Array>} Chunked arrays
 */
export function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Process items with controlled concurrency
 * 
 * @param {Array} items - Items to process
 * @param {number} concurrency - Maximum concurrent operations
 * @param {Function} worker - Async function to process each item
 * @returns {Promise<Array>} Results
 */
export async function processWithConcurrency(items, concurrency, worker) {
  const results = [];
  const executing = [];

  for (const item of items) {
    const promise = Promise.resolve().then(() => worker(item));
    results.push(promise);

    if (concurrency <= items.length) {
      const executing_promise = promise.then(() => {
        executing.splice(executing.indexOf(executing_promise), 1);
      });
      executing.push(executing_promise);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
  }

  return Promise.all(results);
}

/**
 * SupabaseManager class
 * 
 * Manages data transformation and sync to Supabase/DB endpoint.
 */
export class SupabaseManager {
  constructor(options = {}) {
    this.ingestToken = options.ingestToken || process.env.DATA_INGEST_TOKEN;
    this.ingestEndpoint = options.ingestEndpoint || process.env.SUPABASE_INGEST_ENDPOINT;
    this.batchSize = parseInt(options.batchSize || process.env.SUPABASE_CLIENT_BATCH_SIZE || '100');
    this.concurrency = parseInt(options.concurrency || process.env.SCHEDULE_SEND_CONCURRENCY || '5');
    this.debugMode = options.debug || process.env.DEBUG_SCRAPER === 'true';
  }

  /**
   * Check if sync is enabled
   * 
   * @returns {boolean}
   */
  isEnabled() {
    return !!(this.ingestToken && this.ingestEndpoint);
  }

  /**
   * Transform schedule data to normalized format
   * 
   * @param {Array<object>} records - Raw schedule records
   * @returns {Array<object>} Transformed records
   */
  transformScheduleData(records) {
    return records.map(record => ({
      term_code: record.term_code || '',
      program: record.program || '',
      year: record.year || 1,
      semester: record.semester || '',
      course_code: record.code || '',
      course_title: record.title || '',
      units: record.units || 0,
      // Additional fields for compatibility
      department: this._extractDepartment(record.code),
      level: record.year || 1
    }));
  }

  /**
   * Extract department code from course code
   * Extracts the alphabetic prefix from the course code and converts to uppercase.
   * Examples: "CS 101" → "CS", "MATH 201" → "MATH", "SocWk 1130" → "SOCWK"
   * 
   * @param {string} code - Course code
   * @returns {string} Department code
   */
  _extractDepartment(code) {
    if (!code) return 'UNKNOWN';
    
    // Extract prefix (letters at the start of the code)
    const match = code.match(/^([A-Za-z]+)/);
    return match ? match[1].toUpperCase() : 'UNKNOWN';
  }

  /**
   * Sync data to Supabase
   * 
   * @param {string} tableName - Target table name
   * @param {Array<object>} rows - Data rows to sync
   * @param {string} term - Term code
   * @param {string} departmentLabel - Department label
   * @returns {Promise<object>} Sync results
   */
  async syncToSupabase(tableName, rows, term, departmentLabel = ALL_DEPARTMENTS_LABEL) {
    if (!this.isEnabled()) {
      console.log('[Supabase] Sync disabled (no token or endpoint configured)');
      return { success: false, reason: 'disabled' };
    }

    if (!rows || rows.length === 0) {
      console.log('[Supabase] No rows to sync');
      return { success: true, rowsSynced: 0 };
    }

    console.log(`[Supabase] Starting sync: ${rows.length} rows to ${tableName}`);
    console.log(`[Supabase] Term: ${term}, Department: ${departmentLabel}`);

    try {
      // Chunk the data
      const chunks = chunkArray(rows, this.batchSize);
      console.log(`[Supabase] Split into ${chunks.length} batches of ${this.batchSize}`);

      // Process chunks with concurrency control
      let totalSynced = 0;
      const worker = async (chunk) => {
        const result = await this._sendBatch(tableName, chunk, term, departmentLabel);
        totalSynced += result.count;
        return result;
      };

      await processWithConcurrency(chunks, this.concurrency, worker);

      console.log(`[Supabase] Sync complete: ${totalSynced} rows synced`);
      return { success: true, rowsSynced: totalSynced };

    } catch (error) {
      console.error(`[Supabase] Sync failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send a batch of records to the ingest endpoint
   * 
   * @param {string} tableName - Target table
   * @param {Array<object>} batch - Batch of records
   * @param {string} term - Term code
   * @param {string} department - Department label
   * @returns {Promise<object>} Batch result
   */
  async _sendBatch(tableName, batch, term, department) {
    const payload = {
      table: tableName,
      term: term,
      department: department,
      records: batch,
      metadata: {
        timestamp: new Date().toISOString(),
        source: 'sis-scraper-js'
      }
    };

    if (this.debugMode) {
      console.log(`[Supabase] Sending batch of ${batch.length} records...`);
    }

    const response = await fetch(this.ingestEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.ingestToken}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    return { count: batch.length, result };
  }
}
