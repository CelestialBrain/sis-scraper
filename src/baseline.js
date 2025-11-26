/**
 * Baseline Manager Module
 * 
 * Handles baseline storage and regression detection.
 * Mirrors the architecture of BaselineManager from aisis-scraper.
 */

import { promises as fs } from 'fs';
import path from 'path';

const BASELINE_FILE = 'data/baseline.json';

/**
 * BaselineManager class
 * 
 * Manages baseline data and regression detection for curriculum scraping.
 */
export class BaselineManager {
  constructor(options = {}) {
    this.baselineFile = options.baselineFile || BASELINE_FILE;
    this.dropThresholdPercent = parseFloat(
      options.dropThreshold || process.env.BASELINE_DROP_THRESHOLD || '10'
    );
    this.warnOnly = options.warnOnly ?? (process.env.BASELINE_WARN_ONLY === 'true');
    this.debugMode = options.debug || process.env.DEBUG_SCRAPER === 'true';
  }

  /**
   * Get configuration summary
   * 
   * @returns {object} Configuration
   */
  getConfigSummary() {
    return {
      dropThresholdPercent: this.dropThresholdPercent,
      warnOnly: this.warnOnly
    };
  }

  /**
   * Load baseline data from file
   * 
   * @returns {Promise<object>} Baseline data
   */
  async _loadBaseline() {
    try {
      const content = await fs.readFile(this.baselineFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { terms: {} };
      }
      throw error;
    }
  }

  /**
   * Save baseline data to file
   * 
   * @param {object} baseline - Baseline data
   * @returns {Promise<void>}
   */
  async _saveBaseline(baseline) {
    // Ensure data directory exists
    const dir = path.dirname(this.baselineFile);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(
      this.baselineFile,
      JSON.stringify(baseline, null, 2),
      'utf-8'
    );
  }

  /**
   * Compare current data with baseline
   * 
   * @param {string} term - Term code
   * @param {number} totalCount - Total record count
   * @param {object} deptCounts - Department-wise counts
   * @returns {Promise<object>} Comparison result
   */
  async compareWithBaseline(term, totalCount, deptCounts) {
    const baseline = await this._loadBaseline();
    const termBaseline = baseline.terms[term];

    if (!termBaseline) {
      console.log(`[Baseline] No baseline found for term ${term}`);
      return {
        isFirstRun: true,
        hasRegression: false,
        totalCount,
        deptCounts
      };
    }

    const previousTotal = termBaseline.totalCount || 0;
    const delta = totalCount - previousTotal;
    const percentChange = previousTotal > 0 
      ? ((delta / previousTotal) * 100).toFixed(2)
      : 0;

    const hasRegression = delta < 0 && Math.abs(percentChange) > this.dropThresholdPercent;

    // Compare department counts
    const deptRegressions = [];
    for (const [dept, count] of Object.entries(deptCounts)) {
      const prevCount = termBaseline.deptCounts?.[dept] || 0;
      const deptDelta = count - prevCount;
      const deptPercentChange = prevCount > 0
        ? ((deptDelta / prevCount) * 100).toFixed(2)
        : 0;

      if (deptDelta < 0 && Math.abs(deptPercentChange) > this.dropThresholdPercent) {
        deptRegressions.push({
          department: dept,
          previous: prevCount,
          current: count,
          delta: deptDelta,
          percentChange: deptPercentChange
        });
      }
    }

    const result = {
      isFirstRun: false,
      hasRegression,
      totalCount,
      previousTotal,
      delta,
      percentChange,
      deptRegressions
    };

    // Log comparison
    this._logComparison(term, result);

    return result;
  }

  /**
   * Log comparison results
   * 
   * @param {string} term - Term code
   * @param {object} result - Comparison result
   */
  _logComparison(term, result) {
    console.log(`\n[Baseline] Comparison for term ${term}:`);
    console.log(`  Previous: ${result.previousTotal} courses`);
    console.log(`  Current:  ${result.totalCount} courses`);
    console.log(`  Delta:    ${result.delta > 0 ? '+' : ''}${result.delta} (${result.percentChange}%)`);

    if (result.hasRegression) {
      console.warn(`  ⚠️  REGRESSION DETECTED: ${Math.abs(result.percentChange)}% drop exceeds threshold of ${this.dropThresholdPercent}%`);
    } else {
      console.log(`  ✓ No regression (threshold: ${this.dropThresholdPercent}%)`);
    }

    if (result.deptRegressions?.length > 0) {
      console.warn('\n  Department regressions:');
      result.deptRegressions.forEach(dept => {
        console.warn(`    ${dept.department}: ${dept.previous} → ${dept.current} (${dept.percentChange}%)`);
      });
    }
  }

  /**
   * Record baseline for current run
   * 
   * @param {string} term - Term code
   * @param {number} totalCount - Total record count
   * @param {object} deptCounts - Department-wise counts
   * @param {object} meta - Additional metadata
   * @returns {Promise<void>}
   */
  async recordBaseline(term, totalCount, deptCounts, meta = {}) {
    const baseline = await this._loadBaseline();

    baseline.terms[term] = {
      totalCount,
      deptCounts,
      timestamp: new Date().toISOString(),
      ...meta
    };

    await this._saveBaseline(baseline);

    if (this.debugMode) {
      console.log(`[Baseline] Recorded baseline for term ${term}: ${totalCount} courses`);
    }
  }

  /**
   * Determine if job should fail based on comparison
   * 
   * @param {object} comparisonResult - Result from compareWithBaseline
   * @returns {boolean} True if job should fail
   */
  shouldFailJob(comparisonResult) {
    if (this.warnOnly) {
      if (this.debugMode) {
        console.log('[Baseline] Warn-only mode: will not fail job');
      }
      return false;
    }

    if (comparisonResult.isFirstRun) {
      return false;
    }

    const hasSignificantRegression = 
      comparisonResult.hasRegression || 
      (comparisonResult.deptRegressions?.length > 0);

    return hasSignificantRegression;
  }
}
