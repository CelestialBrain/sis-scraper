/**
 * Tests for SISScraper
 */

import { describe, test, expect } from '@jest/globals';
import { SISScraper, compareTermCodes } from '../src/scraper.js';

describe('SISScraper', () => {
  test('should initialize with default options', () => {
    const scraper = new SISScraper();
    expect(scraper).toBeDefined();
    expect(scraper.pythonScraperPath).toBe('main_scraper.py');
    expect(scraper.parserPath).toBe('curriculum_parser.py');
  });

  test('should initialize with custom options', () => {
    const scraper = new SISScraper({
      username: 'testuser',
      password: 'testpass',
      debug: true
    });

    expect(scraper.username).toBe('testuser');
    expect(scraper.password).toBe('testpass');
    expect(scraper.debugMode).toBe(true);
  });

  test('login should return true', async () => {
    const scraper = new SISScraper();
    const result = await scraper.login();
    expect(result).toBe(true);
  });

  test('getAvailableTerms should return default term', async () => {
    const scraper = new SISScraper();
    const terms = await scraper.getAvailableTerms();
    expect(terms).toEqual(['AY2024-Current']);
  });

  test('should parse CSV line correctly', () => {
    const scraper = new SISScraper();
    
    // Simple CSV line
    const line1 = 'value1,value2,value3';
    expect(scraper._parseCSVLine(line1)).toEqual(['value1', 'value2', 'value3']);

    // CSV line with quoted values
    const line2 = 'value1,"value2, with comma",value3';
    expect(scraper._parseCSVLine(line2)).toEqual(['value1', 'value2, with comma', 'value3']);

    // CSV line with empty values
    const line3 = 'value1,,value3';
    expect(scraper._parseCSVLine(line3)).toEqual(['value1', '', 'value3']);
  });
});

describe('compareTermCodes advanced scenarios', () => {
  test('should handle malformed term codes gracefully', () => {
    // Should not throw errors
    expect(compareTermCodes('invalid', 'AY2024-1')).toBeDefined();
    expect(compareTermCodes('2024-1', 'invalid')).toBeDefined();
    expect(compareTermCodes('', '2024-1')).toBeDefined();
  });

  test('should be consistent with sorting', () => {
    const terms = ['2024-2', '2024-1', '2023-2', '2023-1', '2025-1'];
    const sorted1 = [...terms].sort(compareTermCodes);
    const sorted2 = [...terms].sort(compareTermCodes);
    
    expect(sorted1).toEqual(sorted2);
  });

  test('should maintain transitivity', () => {
    const a = '2023-1';
    const b = '2024-1';
    const c = '2025-1';

    expect(compareTermCodes(a, b)).toBeLessThan(0);
    expect(compareTermCodes(b, c)).toBeLessThan(0);
    expect(compareTermCodes(a, c)).toBeLessThan(0);
  });
});
