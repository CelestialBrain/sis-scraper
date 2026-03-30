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

## Use the QPI Calculator

```typescript
import { calculateQpi, getHonorsStanding } from './src/utils/qpi.js';

const result = calculateQpi([
  { course_code: 'CS 101', course_title: 'Intro', unit: 3, grade: 'A' },
  { course_code: 'MATH 101', course_title: 'Calc', unit: 3, grade: 'B' },
]);
console.log(result.qpi);  // 3.5

console.log(getHonorsStanding(3.87));  // "Summa Cum Laude"
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

## Troubleshooting

| Issue | Fix |
|-------|-----|
| pdfjs-dist errors | `rm -rf node_modules && npm install` |
| Vertex AI 404 | Ensure `aiplatform.googleapis.com` API is enabled + SA has `Vertex AI User` role |
| Baseline failure | Check `data/baseline.json`, adjust `BASELINE_DROP_THRESHOLD` |
| 0 courses from PDF | PDF may be corrupt — check with `npx tsx src/index.ts parse <file.pdf>` |
