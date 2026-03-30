# Quick Start

## Prerequisites

- **Node.js** 20+ (uses native fetch)
- **npm** 9+

## Basic Setup

```bash
# Clone and install
git clone https://github.com/CelestialBrain/sis-scraper.git
cd sis-scraper
npm install

# Run the scraper
npx tsx src/index.ts

# Run tests
npx vitest run
```

Output files:
- `addu_curriculum_database.csv` — All courses (program, year, semester, code, title, units)
- `addu_curriculum_aisis.csv` — AISIS-compatible format
- `data/curriculum.db` — SQLite database

## Parse a Single PDF

```bash
npx tsx src/index.ts parse path/to/curriculum.pdf
```

## Use the QPI Grade Calculator

```typescript
import { calculateQpi, getHonorsStanding, checkDeansListEligibility } from './src/utils/qpi.js';

// Calculate QPI
const result = calculateQpi([
  { course_code: 'CS 101', course_title: 'Intro', unit: 3, grade: 'A' },
  { course_code: 'MATH 101', course_title: 'Calc', unit: 3, grade: 'B' },
]);
console.log(result.qpi);  // 3.5

// Latin honors
getHonorsStanding(3.87);  // "Summa Cum Laude"
getHonorsStanding(3.70);  // "Magna Cum Laude"
getHonorsStanding(3.35);  // "Cum Laude"

// Dean's List check (3.5 QPI, 12 units min, no grade below C)
checkDeansListEligibility(courses);  // { eligible: true, qpi: 3.75, units: 15 }

// Required QPI projection
calculateRequiredQpi(3.5, 3.2, 60, 40);  // 3.95 needed across remaining 40 units
```

## Enable LLM Parser (Vertex AI)

1. Place your Google service account JSON as `google-sa-key.json`
2. Create `.env`:
   ```bash
   cp .env.example .env
   ```
3. Set credentials:
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=./google-sa-key.json
   VERTEX_PROJECT=bygelo-3
   VERTEX_LOCATION=global
   ```
4. Use in code:
   ```typescript
   import { parseCurriculumPdfWithLlm } from './src/parsers/llmParser.js';
   const courses = await parseCurriculumPdfWithLlm(pdfBuffer, 'Program Name');
   ```

## Sync to Supabase / Google Sheets

Add to `.env`:
```bash
# Supabase
SUPABASE_INGEST_ENDPOINT=https://your-project.supabase.co/functions/v1/ingest
DATA_INGEST_TOKEN=your_token

# Google Sheets
GOOGLE_SERVICE_ACCOUNT='{"type":"service_account",...}'
SPREADSHEET_ID=your_sheet_id
```

## Format Detection Alerts

The scraper automatically warns about unknown PDF formats:

```
⚠ UNKNOWN FORMAT: "New Program" yielded 0 courses — may be a new PDF template
⚠ LOW YIELD: "Some Program" yielded only 3 courses — check PDF format
⚠ MISSING SEMESTERS: "BS Example" has 45 courses but only 1st Semester
```

If you see these warnings, the PDF may use a new layout that needs a parser update, or the PDF may be corrupted/inaccessible.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| pdfjs-dist errors | `rm -rf node_modules && npm install` |
| Vertex AI 404 | Ensure `aiplatform.googleapis.com` API is enabled + SA has `Vertex AI User` role |
| Vertex AI model not found | Use `gemini-3-flash-preview` with `VERTEX_LOCATION=global` |
| Baseline failure | Check `data/baseline.json`, adjust `BASELINE_DROP_THRESHOLD` |
| 0 courses from PDF | Check for `⚠ UNKNOWN FORMAT` warning — may need parser update |
| En-dash in course codes | Fixed automatically — `–` normalized to `-` in postProcessor |
