/**
 * SIS Scraper Module
 * 
 * Implements the SISScraper class that encapsulates curriculum scraping logic.
 * Mirrors the architecture of AISISScraper from aisis-scraper.
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Compare term codes for sorting.
 * Adapts to AdDU term code format.
 * 
 * @param {string} a - First term code
 * @param {string} b - Second term code
 * @returns {number} Comparison result
 */
export function compareTermCodes(a, b) {
  // Extract year and semester from term codes
  // Example formats: "2024-1", "2024-2", "AY2024-1"
  const extractParts = (term) => {
    const match = term.match(/(\d{4})[^\d]*(\d+)/);
    if (match) {
      return {
        year: parseInt(match[1]),
        semester: parseInt(match[2])
      };
    }
    return { year: 0, semester: 0 };
  };

  const aParts = extractParts(a);
  const bParts = extractParts(b);

  if (aParts.year !== bParts.year) {
    return aParts.year - bParts.year;
  }
  return aParts.semester - bParts.semester;
}

/**
 * SISScraper class
 * 
 * Encapsulates the curriculum scraping logic for AdDU SIS.
 * Since SIS uses Python-based PDF parsing, this class acts as a bridge
 * to the existing Python scraper while providing a JavaScript interface.
 */
export class SISScraper {
  constructor(options = {}) {
    this.username = options.username || process.env.SIS_USERNAME;
    this.password = options.password || process.env.SIS_PASSWORD;
    this.debugMode = options.debug || process.env.DEBUG_SCRAPER === 'true';
    this.pythonScraperPath = options.pythonScraperPath || 'main_scraper.py';
    this.parserPath = options.parserPath || 'curriculum_parser.py';
  }

  /**
   * Initialize the scraper
   */
  async init() {
    if (this.debugMode) {
      console.log('[SISScraper] Initializing scraper...');
    }

    // Verify Python scraper exists
    try {
      await fs.access(this.pythonScraperPath);
      await fs.access(this.parserPath);
    } catch (error) {
      throw new Error(`Python scraper files not found: ${error.message}`);
    }

    return true;
  }

  /**
   * Login to SIS (placeholder for future implementation)
   * Currently SIS scraping doesn't require authentication
   * 
   * @returns {Promise<boolean>} Success status
   */
  async login() {
    if (this.debugMode) {
      console.log('[SISScraper] Login not required for PDF-based scraping');
    }
    return true;
  }

  /**
   * Execute Python scraper and capture output
   * 
   * @returns {Promise<object>} Scraper results
   */
  async _runPythonScraper() {
    return new Promise((resolve, reject) => {
      const python = spawn('python3', [this.pythonScraperPath]);
      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        if (this.debugMode) {
          process.stdout.write(output);
        }
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      python.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python scraper failed with code ${code}: ${stderr}`));
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  /**
   * Load curriculum data from CSV
   * 
   * @returns {Promise<Array>} Curriculum records
   */
  async _loadCurriculumData() {
    const csvPath = 'addu_curriculum_database.csv';
    
    try {
      const content = await fs.readFile(csvPath, 'utf-8');
      const lines = content.trim().split('\n');
      
      if (lines.length < 2) {
        return [];
      }

      // Parse CSV header
      const headers = lines[0].split(',').map(h => h.trim());
      
      // Parse data rows
      const records = [];
      for (let i = 1; i < lines.length; i++) {
        const values = this._parseCSVLine(lines[i]);
        if (values.length === headers.length) {
          const record = {};
          headers.forEach((header, idx) => {
            record[header] = values[idx];
          });
          records.push(record);
        }
      }

      return records;
    } catch (error) {
      throw new Error(`Failed to load curriculum data: ${error.message}`);
    }
  }

  /**
   * Parse a CSV line handling quoted values
   * 
   * @param {string} line - CSV line
   * @returns {Array<string>} Parsed values
   */
  _parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    values.push(current.trim());
    return values;
  }

  /**
   * Scrape curriculum for a single term/configuration
   * 
   * @param {string} termOverride - Optional term override
   * @returns {Promise<object>} Scraped data
   */
  async scrapeCurriculum(termOverride = null) {
    const term = termOverride || process.env.SIS_TERM || 'AY2024-Current';
    
    if (this.debugMode) {
      console.log(`[SISScraper] Scraping curriculum for term: ${term}`);
    }

    // Run Python scraper
    await this._runPythonScraper();

    // Load and parse the generated CSV
    const records = await this._loadCurriculumData();

    // Transform to scheduleData format (compatible with aisis-scraper)
    const scheduleData = records.map(record => ({
      program: record.program,
      year: parseInt(record.year) || 1,
      semester: record.semester,
      code: record.code,
      title: record.title,
      units: parseFloat(record.units) || 0,
      term_code: term
    }));

    // Group by department/program for departmental statistics
    const departmentMap = new Map();
    
    scheduleData.forEach(course => {
      const dept = course.program || 'Unknown';
      if (!departmentMap.has(dept)) {
        departmentMap.set(dept, []);
      }
      departmentMap.get(dept).push(course);
    });

    const deptResults = Array.from(departmentMap.entries()).map(([dept, courses]) => ({
      department: dept,
      course_count: courses.length,
      courses: courses
    }));

    return {
      term,
      courses: scheduleData,
      departments: deptResults
    };
  }

  /**
   * Get available terms (placeholder for future multi-term support)
   * 
   * @returns {Promise<Array<string>>} Available term codes
   */
  async getAvailableTerms() {
    // Currently only supports current curriculum
    // Future enhancement: parse multiple curriculum versions
    return ['AY2024-Current'];
  }

  /**
   * Scrape multiple terms
   * 
   * @param {Array<string>} terms - Term codes to scrape
   * @returns {Promise<Array<object>>} Results for each term
   */
  async scrapeMultipleTerms(terms) {
    const results = [];
    
    for (const term of terms) {
      const result = await this.scrapeCurriculum(term);
      results.push(result);
    }

    return results;
  }
}
