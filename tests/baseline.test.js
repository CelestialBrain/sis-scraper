/**
 * Tests for BaselineManager
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import { BaselineManager } from '../src/baseline.js';

const TEST_BASELINE_FILE = '/tmp/test-baseline.json';

describe('BaselineManager', () => {
  let manager;

  beforeEach(() => {
    manager = new BaselineManager({
      baselineFile: TEST_BASELINE_FILE,
      dropThreshold: 10,
      warnOnly: false
    });
  });

  afterEach(async () => {
    // Clean up test file
    try {
      await fs.unlink(TEST_BASELINE_FILE);
    } catch (error) {
      // Ignore if file doesn't exist
    }
  });

  test('should return config summary', () => {
    const config = manager.getConfigSummary();
    expect(config).toEqual({
      dropThresholdPercent: 10,
      warnOnly: false
    });
  });

  test('should detect first run when no baseline exists', async () => {
    const result = await manager.compareWithBaseline('2024-1', 100, { CS: 50, MATH: 50 });
    
    expect(result.isFirstRun).toBe(true);
    expect(result.hasRegression).toBe(false);
  });

  test('should record and retrieve baseline', async () => {
    // Record baseline
    await manager.recordBaseline('2024-1', 100, { CS: 50, MATH: 50 });

    // Compare with same values
    const result = await manager.compareWithBaseline('2024-1', 100, { CS: 50, MATH: 50 });

    expect(result.isFirstRun).toBe(false);
    expect(result.hasRegression).toBe(false);
    expect(result.totalCount).toBe(100);
    expect(result.previousTotal).toBe(100);
    expect(result.delta).toBe(0);
  });

  test('should detect regression when count drops significantly', async () => {
    // Record baseline
    await manager.recordBaseline('2024-1', 100, { CS: 50, MATH: 50 });

    // Compare with 80% of baseline (20% drop, exceeds 10% threshold)
    const result = await manager.compareWithBaseline('2024-1', 80, { CS: 40, MATH: 40 });

    expect(result.hasRegression).toBe(true);
    expect(result.delta).toBe(-20);
    expect(parseFloat(result.percentChange)).toBe(-20.0);
  });

  test('should not detect regression for small drops', async () => {
    // Record baseline
    await manager.recordBaseline('2024-1', 100, { CS: 50, MATH: 50 });

    // Compare with 95% of baseline (5% drop, below 10% threshold)
    const result = await manager.compareWithBaseline('2024-1', 95, { CS: 48, MATH: 47 });

    expect(result.hasRegression).toBe(false);
    expect(result.delta).toBe(-5);
  });

  test('should detect department-level regressions', async () => {
    // Record baseline
    await manager.recordBaseline('2024-1', 100, { CS: 50, MATH: 50 });

    // One department drops significantly
    const result = await manager.compareWithBaseline('2024-1', 95, { CS: 40, MATH: 55 });

    expect(result.deptRegressions).toBeDefined();
    expect(result.deptRegressions.length).toBeGreaterThan(0);
    
    const csRegression = result.deptRegressions.find(d => d.department === 'CS');
    expect(csRegression).toBeDefined();
    expect(csRegression.previous).toBe(50);
    expect(csRegression.current).toBe(40);
  });

  test('should not fail job in warn-only mode', async () => {
    manager = new BaselineManager({
      baselineFile: TEST_BASELINE_FILE,
      warnOnly: true
    });

    await manager.recordBaseline('2024-1', 100, { CS: 50 });
    const result = await manager.compareWithBaseline('2024-1', 50, { CS: 25 });

    expect(result.hasRegression).toBe(true);
    expect(manager.shouldFailJob(result)).toBe(false);
  });

  test('should fail job when regression detected and not warn-only', async () => {
    await manager.recordBaseline('2024-1', 100, { CS: 50 });
    const result = await manager.compareWithBaseline('2024-1', 50, { CS: 25 });

    expect(result.hasRegression).toBe(true);
    expect(manager.shouldFailJob(result)).toBe(true);
  });

  test('should not fail job on first run', async () => {
    const result = await manager.compareWithBaseline('2024-1', 100, { CS: 50 });
    expect(manager.shouldFailJob(result)).toBe(false);
  });

  test('should handle increases as non-regression', async () => {
    await manager.recordBaseline('2024-1', 100, { CS: 50 });
    const result = await manager.compareWithBaseline('2024-1', 120, { CS: 60 });

    expect(result.hasRegression).toBe(false);
    expect(result.delta).toBe(20);
    expect(parseFloat(result.percentChange)).toBe(20.0);
  });
});
