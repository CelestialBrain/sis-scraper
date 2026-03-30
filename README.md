# SIS Scraper

A curriculum scraper for Ateneo de Davao University (AdDU) that extracts course data from PDF documents and provides grade computation utilities. Built in **TypeScript** with dual parsing engines (regex + LLM).

## Features

- **Dual PDF parsing engines**:
  - **Regex parser**: Fast, deterministic extraction using pattern matching and table reconstruction
  - **LLM parser**: Gemini-powered extraction via Vertex AI for edge cases and validation
- **Multi-format PDF support**: Handles every known AdDU curriculum PDF format (2007–2024)
- **Unknown format detection**: Automatically warns when a PDF yields 0 courses or unexpected structure
- **QPI grade calculator**: Full Ateneo grading system with Dean's List, Latin honors, and GWA conversion
- **SQLite database**: Normalized relational schema (department, course, degree_program, curriculum_course)
- **CSV export**: AISIS-compatible schema for integration with existing systems
- **Baseline regression detection**: Catches parsing regressions before they ship
- **Supabase + Google Sheets sync**: Optional cloud data sync
- **Automated scraping**: GitHub Actions workflow for scheduled updates

## Quick Start

```bash
# Install
npm install

# Run the scraper
npx tsx src/index.ts

# Run tests
npx vitest run
```

Output:
- `data/curriculum.db` — SQLite database
- `addu_curriculum_database.csv` — Raw CSV (program, year, semester, code, title, units)
- `addu_curriculum_aisis.csv` — AISIS-format CSV

## Architecture

```
src/
├── index.ts              # Main orchestrator (discover → download → parse → DB → CSV → sync)
├── crawler.ts            # PDF URL discovery from AdDU website
├── downloader.ts         # Concurrent PDF download + parse pipeline
├── types.ts              # Core TypeScript interfaces
├── parsers/
│   ├── index.ts          # Layout detection router + unknown format alerts
│   ├── pdfExtractor.ts   # pdfjs-dist text extraction with positions
│   ├── tableDetector.ts  # Reconstruct tables from positioned text items
│   ├── standardLayout.ts # Standard stacked layout parser
│   ├── splitLayout.ts    # Split/parallel layout parser
│   ├── courseCodeExtractor.ts  # 7-layer regex course code extraction
│   ├── postProcessor.ts  # Dedup, validation, artifact filtering
│   └── llmParser.ts      # Gemini LLM-based parser (Vertex AI / AI Studio)
├── db/
│   ├── index.ts          # SQLite connection management
│   ├── schema.ts         # DDL for all tables
│   └── writer.ts         # Normalize + write ParsedCourse[] to DB
├── sync/
│   ├── baseline.ts       # Regression detection against previous runs
│   ├── csvExporter.ts    # Raw + AISIS CSV export
│   ├── supabase.ts       # Supabase ingest sync
│   └── sheets.ts         # Google Sheets sync
└── utils/
    ├── logger.ts         # Structured logging
    └── qpi.ts            # QPI grade calculator (Ateneo grading system)
```

## PDF Format Coverage

The parser handles every known AdDU curriculum PDF format:

| Format | Era | Description | Example |
|--------|-----|-------------|---------|
| **Standard stacked** | 2020+ | Clean year → semester → course rows | BS Computer Science |
| **Engineering lec/lab** | 2015 | Sub-columns for Lec/Lab/Credit units | BS Electronics Engineering |
| **Split/parallel** | 2015 | Two semesters side-by-side in one table | BS Biology |
| **Split-row titles** | 2015 | Course titles spanning adjacent rows | BA Psychology |
| **Elective number-bleed** | 2020 | Course numbers split across rows | BA Sociology (SOCIO ELEC) |
| **Hyphenated electives** | 2020 | Discipline-prefixed codes | BS Finance (FIN-ELEC), Public Management (PM-ELEC) |
| **Roman numeral codes** | 2015 | Non-numeric course identifiers | FYCF I, Hum I, PE III |
| **Graduate prospectus** | 2007–2020 | Catalog format with repeated sections | MA Anthropology, PhD Dev Studies |
| **Graduate number-bleed** | 2007–2015 | Course numbers split in old formats | PIDS 507, DPA 302 |

**Unknown format detection**: If AdDU changes their PDF template, the scraper warns:
- `⚠ UNKNOWN FORMAT` — PDF yielded 0 courses
- `⚠ LOW YIELD` — fewer than 5 courses from an undergrad program
- `⚠ MISSING SEMESTERS` — large program with only 1 semester detected

## Parsing Pipeline

```
PDF → pdfjs-dist → text items with (x,y) → table reconstruction → layout detection → parse
```

1. **Discover**: Crawl AdDU program pages for curriculum PDF links
2. **Download**: Fetch PDFs concurrently with rate limiting
3. **Extract**: pdfjs-dist extracts text items with (x, y) positions from each page
4. **Table Build**: Reconstruct tabular structure by clustering text items into rows/columns
5. **Layout Detect**: Classify as standard or split based on header patterns and table width
6. **Parse**: Extract courses using layout-specific parser with 7-layer code extraction:
   - Hyphenated elective (`FIN-ELEC 2247`) → Spaced elective (`SOCIO ELEC 1331`) → Special subjects (`NSTP-CWTS 1`) → Completion subjects (`THESIS 1`) → Roman numerals (`FYCF I`) → Primary (`CS 101`) → Dotted (`S.Th. 101`) → Loose fallback
7. **Pre-process**: Elective number-bleed repair, general number-bleed repair, adjacent-row title stitching
8. **Post-process**: En-dash normalization, junk code/title filtering, dedup (same year+semester), cross-semester catalog dedup
9. **Write**: Normalize into SQLite + export CSVs

## LLM Parser

The LLM parser uses Google Gemini to extract courses from PDF text. It serves as an alternative/validation engine alongside the regex parser — both produce near-identical results on 97/106 PDFs.

### Setup

```bash
# Option 1: Vertex AI (service account)
export GOOGLE_APPLICATION_CREDENTIALS=./google-sa-key.json
export VERTEX_PROJECT=bygelo-3
export VERTEX_LOCATION=global

# Option 2: Google AI Studio (API key)
export GEMINI_API_KEY=your_key_here
```

### Usage

```typescript
import { parseCurriculumPdfWithLlm } from './src/parsers/llmParser.js';

const courses = await parseCurriculumPdfWithLlm(pdfBuffer, 'CS 2020');
```

Model: `gemini-3-flash-preview` (configurable via `LLM_MODEL` env var)

## QPI Grade Calculator

Full implementation of the Ateneo QPI (Quality Point Index) grading system for building grade calculators.

```typescript
import {
  calculateQpi,
  calculateCumulativeQpi,
  checkDeansListEligibility,
  getHonorsStanding,
  calculateRequiredQpi,
  qpiToGwa,
} from './src/utils/qpi.js';

// Calculate QPI for a semester
const result = calculateQpi([
  { course_code: 'CS 101', course_title: 'Intro to CS', unit: 3, grade: 'A' },
  { course_code: 'MATH 101', course_title: 'Calculus', unit: 3, grade: 'B+' },
]);
// → { qpi: 3.75, total_units: 6, quality_points: 22.5 }

// Cumulative QPI across semesters
calculateCumulativeQpi([{ courses: sem1 }, { courses: sem2 }]);

// Check Dean's List eligibility (3.5 QPI, 12 units, no grade below C)
checkDeansListEligibility(courses);
// → { eligible: true, qpi: 3.75, units: 15 }

// Get Latin honors standing
getHonorsStanding(3.87); // → "Summa Cum Laude"
getHonorsStanding(3.70); // → "Magna Cum Laude"
getHonorsStanding(3.35); // → "Cum Laude"

// Project required QPI for remaining units to reach target
calculateRequiredQpi(3.5, 3.2, 60, 40); // → 3.95

// Convert between QPI and GWA
qpiToGwa(3.5);  // → 1.5
```

### Grade Scale

| Grade | Points | | Grade | Points |
|-------|--------|-|-------|--------|
| A     | 4.0    | | D     | 1.0    |
| B+    | 3.5    | | F     | 0.0    |
| B     | 3.0    | | W     | 0.0    |
| C+    | 2.5    | | WP/INC/NE | excluded |
| C     | 2.0    | | AUD/S/U   | excluded |

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Scraper
CURRICULUM_CONCURRENCY=2        # Parallel PDF downloads
CURRICULUM_DELAY_MS=100         # Rate limit between requests

# LLM Parser (optional)
GOOGLE_APPLICATION_CREDENTIALS=./google-sa-key.json
VERTEX_PROJECT=bygelo-3
VERTEX_LOCATION=global
LLM_MODEL=gemini-3-flash-preview

# Baseline
BASELINE_DROP_THRESHOLD=10      # Fail if >10% course count drop

# Sync (optional)
SUPABASE_INGEST_ENDPOINT=https://...
DATA_INGEST_TOKEN=...
SPREADSHEET_ID=...
```

## Testing

```bash
# Run all tests (143 tests)
npx vitest run

# Watch mode
npx vitest

# Specific test file
npx vitest run tests/qpi.test.ts
```

Test coverage:
- **71 QPI tests**: Grade points, calculation, Dean's List, honors, QPI-GWA conversion
- **24 course code extraction tests**: All 7 extraction layers + special/completion subjects
- **19 crawler tests**: URL detection, program name extraction
- **11 post-processor tests**: Dedup, validation, artifact filtering, completion requirements
- **10 DB writer tests**: Schema normalization, degree code extraction
- **8 layout parser tests**: Standard and split layout parsing

## Database Schema

```sql
department(department_id, department_code, name)
course(course_id, course_code, title, unit, department_id)
degree_program(degree_program_id, code, name, is_honor, track, specialization, version_year, version_semester)
curriculum_course(curriculum_course_id, degree_program_id, course_id, year, semester, prerequisite_raw, category)
```

Follows sisia-app's CONVENTIONS.md: singular table names, `{table}_id` PKs, singular nouns for scalars (`unit` not `units`), `{entity}_code` pattern.

## Current Stats

- **106 PDFs** processed, **0 errors**
- **4,848 courses** extracted (LLM-validated)
- **54 programs** across 124 departments
- **97/106 PDFs** match LLM parser exactly
- **143 tests** passing

## GitHub Actions

The scraper runs on schedule via GitHub Actions (`.github/workflows/scrape.yml`):
- Installs Node.js 20 + dependencies
- Runs test suite
- Executes full scrape pipeline
- Commits updated CSVs back to repo
- Uploads DB + CSVs as artifacts (90-day retention)

## License

MIT
