/**
 * Tests for utility functions from multiple modules
 * Includes tests for supabase utilities and scraper helpers
 */

import { describe, test, expect } from '@jest/globals';
import { chunkArray, processWithConcurrency } from '../src/supabase.js';
import { compareTermCodes } from '../src/scraper.js';

describe('chunkArray', () => {
  test('should chunk array into specified size', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = chunkArray(input, 3);
    
    expect(result).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
      [10]
    ]);
  });

  test('should handle empty array', () => {
    const result = chunkArray([], 5);
    expect(result).toEqual([]);
  });

  test('should handle chunk size larger than array', () => {
    const input = [1, 2, 3];
    const result = chunkArray(input, 10);
    expect(result).toEqual([[1, 2, 3]]);
  });

  test('should handle chunk size of 1', () => {
    const input = [1, 2, 3];
    const result = chunkArray(input, 1);
    expect(result).toEqual([[1], [2], [3]]);
  });
});

describe('processWithConcurrency', () => {
  test('should process items with concurrency limit', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = [];
    let concurrent = 0;
    let maxConcurrent = 0;

    const worker = async (item) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      
      // Simulate async work
      await new Promise(resolve => setTimeout(resolve, 10));
      
      concurrent--;
      results.push(item * 2);
      return item * 2;
    };

    const output = await processWithConcurrency(items, 2, worker);

    expect(output).toHaveLength(5);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(results.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);
  });

  test('should handle empty array', async () => {
    const worker = async (item) => item;
    const result = await processWithConcurrency([], 5, worker);
    expect(result).toEqual([]);
  });

  test('should process all items even with errors', async () => {
    const items = [1, 2, 3];
    const worker = async (item) => {
      if (item === 2) throw new Error('Test error');
      return item;
    };

    await expect(processWithConcurrency(items, 2, worker)).rejects.toThrow('Test error');
  });
});

describe('compareTermCodes', () => {
  test('should sort term codes by year', () => {
    expect(compareTermCodes('2023-1', '2024-1')).toBeLessThan(0);
    expect(compareTermCodes('2024-1', '2023-1')).toBeGreaterThan(0);
    expect(compareTermCodes('2024-1', '2024-1')).toBe(0);
  });

  test('should sort term codes by semester within same year', () => {
    expect(compareTermCodes('2024-1', '2024-2')).toBeLessThan(0);
    expect(compareTermCodes('2024-2', '2024-1')).toBeGreaterThan(0);
  });

  test('should handle term codes with prefix', () => {
    expect(compareTermCodes('AY2023-1', 'AY2024-1')).toBeLessThan(0);
    expect(compareTermCodes('AY2024-2', 'AY2024-1')).toBeGreaterThan(0);
  });

  test('should handle various formats consistently', () => {
    const terms = ['2024-2', '2023-1', 'AY2024-1', '2023-2'];
    const sorted = terms.sort(compareTermCodes);
    
    // Should be sorted by year then semester
    expect(sorted[0]).toMatch(/2023-1/);
    expect(sorted[sorted.length - 1]).toMatch(/2024-2/);
  });
});
