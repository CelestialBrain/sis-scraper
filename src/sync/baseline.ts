/**
 * Baseline manager — regression detection
 *
 * Ported from src/baseline.js → TypeScript.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { BaselineData, ComparisonResult, DeptRegression } from '../types.js';
import { logger } from '../utils/logger.js';

const BASELINE_FILE = 'data/baseline.json';

export class BaselineManager {
  private baselineFile: string;
  private dropThresholdPercent: number;
  private warnOnly: boolean;
  private debugMode: boolean;

  constructor(options: {
    baselineFile?: string;
    dropThreshold?: number;
    warnOnly?: boolean;
    debug?: boolean;
  } = {}) {
    this.baselineFile = options.baselineFile ?? BASELINE_FILE;
    this.dropThresholdPercent = options.dropThreshold ?? parseFloat(process.env.BASELINE_DROP_THRESHOLD ?? '10');
    this.warnOnly = options.warnOnly ?? process.env.BASELINE_WARN_ONLY === 'true';
    this.debugMode = options.debug ?? process.env.DEBUG_SCRAPER === 'true';
  }

  getConfigSummary(): { dropThresholdPercent: number; warnOnly: boolean } {
    return {
      dropThresholdPercent: this.dropThresholdPercent,
      warnOnly: this.warnOnly,
    };
  }

  private async loadBaseline(): Promise<BaselineData> {
    try {
      const content = await fs.readFile(this.baselineFile, 'utf-8');
      return JSON.parse(content) as BaselineData;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { terms: {} };
      }
      throw err;
    }
  }

  private async saveBaseline(baseline: BaselineData): Promise<void> {
    const dir = path.dirname(this.baselineFile);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.baselineFile, JSON.stringify(baseline, null, 2), 'utf-8');
  }

  async compareWithBaseline(
    term: string,
    totalCount: number,
    deptCounts: Record<string, number>,
  ): Promise<ComparisonResult> {
    const baseline = await this.loadBaseline();
    const termBaseline = baseline.terms[term];

    if (!termBaseline) {
      logger.info('Baseline', `No baseline found for term ${term}`);
      return {
        is_first_run: true,
        has_regression: false,
        total_count: totalCount,
        dept_regression: [],
      };
    }

    const previousTotal = termBaseline.total_count ?? 0;
    const delta = totalCount - previousTotal;
    const percentChange = previousTotal > 0 ? (delta / previousTotal) * 100 : 0;
    const hasRegression = delta < 0 && Math.abs(percentChange) > this.dropThresholdPercent;

    // Department regressions
    const deptRegressions: DeptRegression[] = [];
    for (const [dept, count] of Object.entries(deptCounts)) {
      const prevCount = termBaseline.dept_count?.[dept] ?? 0;
      const deptDelta = count - prevCount;
      const deptPct = prevCount > 0 ? (deptDelta / prevCount) * 100 : 0;

      if (deptDelta < 0 && Math.abs(deptPct) > this.dropThresholdPercent) {
        deptRegressions.push({
          department: dept,
          previous: prevCount,
          current: count,
          delta: deptDelta,
          percent_change: parseFloat(deptPct.toFixed(2)),
        });
      }
    }

    const result: ComparisonResult = {
      is_first_run: false,
      has_regression: hasRegression,
      total_count: totalCount,
      previous_total: previousTotal,
      delta,
      percent_change: parseFloat(percentChange.toFixed(2)),
      dept_regression: deptRegressions,
    };

    this.logComparison(term, result);
    return result;
  }

  private logComparison(term: string, result: ComparisonResult): void {
    logger.info('Baseline', `Comparison for term ${term}:`);
    logger.info('Baseline', `  Previous: ${result.previous_total} courses`);
    logger.info('Baseline', `  Current:  ${result.total_count} courses`);
    logger.info('Baseline', `  Delta:    ${(result.delta ?? 0) > 0 ? '+' : ''}${result.delta} (${result.percent_change}%)`);

    if (result.has_regression) {
      logger.warn('Baseline', `  REGRESSION: ${Math.abs(result.percent_change!)}% drop > threshold ${this.dropThresholdPercent}%`);
    } else {
      logger.success('Baseline', `  No regression (threshold: ${this.dropThresholdPercent}%)`);
    }

    if (result.dept_regression.length > 0) {
      logger.warn('Baseline', '  Department regressions:');
      for (const dept of result.dept_regression) {
        logger.warn('Baseline', `    ${dept.department}: ${dept.previous} -> ${dept.current} (${dept.percent_change}%)`);
      }
    }
  }

  async recordBaseline(
    term: string,
    totalCount: number,
    deptCounts: Record<string, number>,
    meta: Record<string, unknown> = {},
  ): Promise<void> {
    const baseline = await this.loadBaseline();

    baseline.terms[term] = {
      total_count: totalCount,
      dept_count: deptCounts,
      timestamp: new Date().toISOString(),
      ...meta,
    } as BaselineData['terms'][string];

    await this.saveBaseline(baseline);

    if (this.debugMode) {
      logger.debug('Baseline', `Recorded baseline for term ${term}: ${totalCount} courses`);
    }
  }

  shouldFailJob(result: ComparisonResult): boolean {
    if (this.warnOnly) return false;
    if (result.is_first_run) return false;
    return result.has_regression || result.dept_regression.length > 0;
  }
}
