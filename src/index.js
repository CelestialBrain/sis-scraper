/**
 * SIS Scraper Main Orchestrator
 * 
 * Main entrypoint that coordinates scraping, data sync, and reporting.
 * Mirrors the architecture of aisis-scraper's src/index.js.
 */

import { promises as fs } from 'fs';
import { SISScraper, compareTermCodes } from './scraper.js';
import { SupabaseManager, ALL_DEPARTMENTS_LABEL } from './supabase.js';
import { GoogleSheetsManager } from './sheets.js';
import { BaselineManager } from './baseline.js';

/**
 * Save local artifacts
 */
async function saveArtifacts(allTermsData, isSingleTerm) {
  // Ensure data directory exists
  await fs.mkdir('data', { recursive: true });

  if (isSingleTerm && allTermsData.length === 1) {
    const termData = allTermsData[0];

    // Save courses.json (single term clean schedule)
    await fs.writeFile(
      'data/courses.json',
      JSON.stringify(termData.cleanSchedule, null, 2),
      'utf-8'
    );
    console.log(`[Artifacts] Saved data/courses.json (${termData.cleanSchedule.length} courses)`);

    // Save schedules-per-department.json (single term)
    const deptData = {
      term: termData.term,
      departments: termData.deptResults.map(dept => ({
        department: dept.department,
        course_count: dept.course_count,
        courses: dept.courses
      }))
    };
    await fs.writeFile(
      'data/schedules-per-department.json',
      JSON.stringify(deptData, null, 2),
      'utf-8'
    );
    console.log('[Artifacts] Saved data/schedules-per-department.json');

  } else {
    // Multi-term mode
    const allCourses = allTermsData.flatMap(t => t.cleanSchedule);

    await fs.writeFile(
      'data/courses.json',
      JSON.stringify(allCourses, null, 2),
      'utf-8'
    );
    console.log(`[Artifacts] Saved data/courses.json (${allCourses.length} courses across ${allTermsData.length} terms)`);

    // Multi-term schedules-per-department
    const multiTermData = {
      terms: allTermsData.map(termData => ({
        term: termData.term,
        course_count: termData.cleanSchedule.length,
        departments: termData.deptResults.map(dept => ({
          department: dept.department,
          course_count: dept.course_count,
          courses: dept.courses
        }))
      }))
    };
    await fs.writeFile(
      'data/schedules-per-department.json',
      JSON.stringify(multiTermData, null, 2),
      'utf-8'
    );
    console.log('[Artifacts] Saved data/schedules-per-department.json (multi-term)');
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('🎓 SIS Curriculum Scraper');
  console.log('═══════════════════════════════════════════════════════\n');

  let exitCode = 0;
  let regressionFailed = false;

  try {
    // Environment configuration
    const scrapeMode = process.env.SIS_SCRAPE_MODE || 'current';
    const termOverride = process.env.SIS_TERM;
    const spreadsheetId = process.env.SPREADSHEET_ID;

    console.log('Configuration:');
    console.log(`  Scrape Mode: ${scrapeMode}`);
    console.log(`  Term Override: ${termOverride || 'none'}`);
    console.log(`  Spreadsheet ID: ${spreadsheetId ? '✓ configured' : '✗ not configured'}`);

    // Initialize components
    const initStart = Date.now();
    console.log('\n🚀 Initializing scraper...');
    const scraper = new SISScraper();
    const supabaseManager = new SupabaseManager();
    const sheetsManager = new GoogleSheetsManager();
    const baselineManager = new BaselineManager();

    await scraper.init();
    if (sheetsManager.isEnabled()) {
      await sheetsManager.init();
    }

    console.log(`\n[Init] Supabase sync: ${supabaseManager.isEnabled() ? 'enabled' : 'disabled'}`);
    console.log(`[Init] Google Sheets: ${sheetsManager.isEnabled() ? 'enabled' : 'disabled'}`);
    console.log(`[Init] Baseline config: ${JSON.stringify(baselineManager.getConfigSummary())}`);
    const initTime = Date.now() - initStart;
    console.log(`   ⏱  Duration: ${(initTime / 1000).toFixed(1)}s`);

    // Login (placeholder for future auth requirements)
    const loginStart = Date.now();
    console.log('\n🔓 Logging in...');
    await scraper.login();
    const loginTime = Date.now() - loginStart;
    console.log(`   ⏱  Duration: ${(loginTime / 1000).toFixed(1)}s`);

    // Determine terms to scrape
    const termDiscoveryStart = Date.now();
    console.log('\n🔍 Discovering terms...');
    let termsToScrape = [];

    if (termOverride) {
      termsToScrape = [termOverride];
    } else if (scrapeMode === 'all') {
      termsToScrape = await scraper.getAvailableTerms();
    } else {
      // Default: current term
      termsToScrape = ['AY2024-Current'];
    }

    console.log(`[Terms] Will scrape ${termsToScrape.length} term(s): ${termsToScrape.join(', ')}`);
    const termDiscoveryTime = Date.now() - termDiscoveryStart;
    console.log(`   ⏱  Duration: ${(termDiscoveryTime / 1000).toFixed(1)}s`);

    // Scrape terms
    const scrapeStart = Date.now();
    console.log('\n📥 Scraping curriculum data...');
    const allTermsData = [];

    for (const term of termsToScrape) {
      console.log(`\n[Scraping] Processing term: ${term}`);
      const result = await scraper.scrapeCurriculum(term);

      // Add term_code to each record
      result.courses.forEach(course => {
        course.term_code = term;
      });

      // Transform data
      const cleanSchedule = supabaseManager.transformScheduleData(result.courses);

      allTermsData.push({
        term,
        scheduleData: result.courses,
        deptResults: result.departments,
        cleanSchedule
      });

      console.log(`[Scraping] Term ${term}: ${result.courses.length} courses, ${result.departments.length} departments`);
    }

    // Sort by term code
    allTermsData.sort((a, b) => compareTermCodes(a.term, b.term));
    const scrapeTime = Date.now() - scrapeStart;
    console.log(`   ⏱  Duration: ${(scrapeTime / 1000).toFixed(1)}s`);

    // Baseline comparison
    console.log('\n' + '='.repeat(60));
    console.log('BASELINE COMPARISON');
    console.log('='.repeat(60));

    for (const termData of allTermsData) {
      const deptCounts = {};
      termData.deptResults.forEach(dept => {
        deptCounts[dept.department] = dept.course_count;
      });

      const comparison = await baselineManager.compareWithBaseline(
        termData.term,
        termData.cleanSchedule.length,
        deptCounts
      );

      // Record new baseline
      await baselineManager.recordBaseline(
        termData.term,
        termData.cleanSchedule.length,
        deptCounts,
        { scrapeMode, timestamp: new Date().toISOString() }
      );

      // Check if should fail
      if (baselineManager.shouldFailJob(comparison)) {
        console.error(`\n⚠️  REGRESSION DETECTED for term ${termData.term} - will fail job`);
        regressionFailed = true;
      }
    }

    // Supabase sync
    if (supabaseManager.isEnabled()) {
      const supabaseStart = Date.now();
      console.log('\n🚀 Starting Supabase sync...');

      for (const termData of allTermsData) {
        await supabaseManager.syncToSupabase(
          'curriculum',
          termData.cleanSchedule,
          termData.term,
          ALL_DEPARTMENTS_LABEL
        );
      }

      const supabaseTime = Date.now() - supabaseStart;
      console.log(`   ⏱  Duration: ${(supabaseTime / 1000).toFixed(1)}s`);
    } else {
      console.log('\n[Supabase] Skipped (not configured)');
    }

    // Google Sheets sync
    if (sheetsManager.isEnabled() && spreadsheetId) {
      const sheetsStart = Date.now();
      console.log('\n📊 Syncing to Google Sheets...');

      const isSingleTerm = allTermsData.length === 1;

      if (isSingleTerm) {
        // Single term: write to "Schedules" tab
        await sheetsManager.syncData(
          spreadsheetId,
          'Schedules',
          allTermsData[0].cleanSchedule
        );
      } else {
        // Multi-term: one tab per term
        for (const termData of allTermsData) {
          await sheetsManager.syncData(
            spreadsheetId,
            termData.term,
            termData.cleanSchedule
          );
        }
      }

      const sheetsTime = Date.now() - sheetsStart;
      console.log(`   ⏱  Duration: ${(sheetsTime / 1000).toFixed(1)}s`);
    } else {
      console.log('\n[Sheets] Skipped (not configured)');
    }

    // Save local artifacts
    const artifactsStart = Date.now();
    console.log('\n💾 Saving local artifacts...');
    await saveArtifacts(allTermsData, allTermsData.length === 1);
    const artifactsTime = Date.now() - artifactsStart;
    console.log(`   ⏱  Duration: ${(artifactsTime / 1000).toFixed(1)}s`);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('FINAL SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total terms processed: ${allTermsData.length}`);
    console.log(`Total courses scraped: ${allTermsData.reduce((sum, t) => sum + t.cleanSchedule.length, 0)}`);
    console.log(`Supabase sync: ${supabaseManager.isEnabled() ? 'completed' : 'skipped'}`);
    console.log(`Google Sheets sync: ${sheetsManager.isEnabled() && spreadsheetId ? 'completed' : 'skipped'}`);
    console.log('Local artifacts: saved to data/');

    if (regressionFailed) {
      console.error('\n❌ FAILED: Baseline regression detected');
      exitCode = 1;
    } else {
      console.log('\n✅ SUCCESS: Scraping completed successfully');
    }

  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('FATAL ERROR');
    console.error('='.repeat(60));
    console.error(error);
    console.error('Stack trace:');
    console.error(error.stack);
    exitCode = 1;
  }

  process.exit(exitCode);
}

// Error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('\n❌ UNHANDLED REJECTION');
  console.error('Promise:', promise);
  console.error('Reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('\n❌ UNCAUGHT EXCEPTION');
  console.error(error);
  console.error('Stack trace:');
  console.error(error.stack);
  process.exit(1);
});

// Run main
main();
