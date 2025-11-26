/**
 * Tests for SISScraper
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { SISScraper, compareTermCodes } from '../src/scraper.js';

describe('SISScraper', () => {
  let consoleLogSpy;
  
  beforeEach(() => {
    // Spy on console.log to capture logging output
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  
  afterEach(() => {
    // Restore console.log after each test
    consoleLogSpy.mockRestore();
  });
  
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
  
  test('login should emit debug log when debugMode is true', async () => {
    const scraper = new SISScraper({ debug: true });
    await scraper.login();
    
    // Check that the debug log was emitted with emoji prefix
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('🔓')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SISScraper]')
    );
  });
  
  test('login should not emit debug log when debugMode is false', async () => {
    const scraper = new SISScraper({ debug: false });
    await scraper.login();
    
    // Check that no debug logs were emitted
    expect(consoleLogSpy).not.toHaveBeenCalled();
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
  
  test('init should emit debug logs when debugMode is true', async () => {
    const scraper = new SISScraper({ debug: true });
    
    try {
      await scraper.init();
    } catch (error) {
      // May fail if Python files don't exist, but we're checking logs
    }
    
    // Check that initialization log was emitted with emoji
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('🧩')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SISScraper]')
    );
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
