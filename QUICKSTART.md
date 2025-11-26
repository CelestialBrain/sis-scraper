# Quick Start Guide

This guide will help you get started with the SIS Scraper JavaScript implementation.

## Prerequisites

- **Node.js** 18.0.0 or higher
- **Python** 3.11 or higher (for PDF parsing)
- Git

## Basic Setup (No Integrations)

1. **Clone the repository**
   ```bash
   git clone https://github.com/CelestialBrain/sis-scraper.git
   cd sis-scraper
   ```

2. **Install dependencies**
   ```bash
   # Python dependencies
   pip install -r requirements.txt
   
   # Node.js dependencies
   npm install
   ```

3. **Run the scraper**
   ```bash
   npm run scrape:sis
   ```

4. **Check the output**
   - CSV: `addu_curriculum_database.csv`
   - JSON: `data/courses.json` and `data/schedules-per-department.json`

## Setup with Google Sheets Integration

1. **Create a Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project
   - Enable the Google Sheets API

2. **Create a Service Account**
   - Navigate to "IAM & Admin" → "Service Accounts"
   - Create a new service account
   - Generate a JSON key file
   - Download the key file

3. **Create a Google Sheet**
   - Create a new Google Sheet
   - Share it with the service account email (found in the JSON key)
   - Give it "Editor" permissions
   - Copy the spreadsheet ID from the URL

4. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add:
   ```bash
   GOOGLE_SERVICE_ACCOUNT='{"type":"service_account",...}'  # Paste entire JSON on one line
   SPREADSHEET_ID=your_spreadsheet_id_here
   ```

5. **Run the scraper**
   ```bash
   npm run scrape:sis
   ```
   
   The data will be synced to a "Schedules" tab in your Google Sheet.

## Setup with Supabase Integration

1. **Create a Supabase Project**
   - Go to [Supabase](https://supabase.com/)
   - Create a new project
   - Note your project URL

2. **Create an Ingest Endpoint**
   - Create a Supabase Edge Function or API endpoint
   - Implement logic to accept batched curriculum data
   - Generate an authentication token

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add:
   ```bash
   DATA_INGEST_TOKEN=your_token_here
   SUPABASE_INGEST_ENDPOINT=https://your-project.supabase.co/functions/v1/ingest
   ```

4. **Run the scraper**
   ```bash
   npm run scrape:sis
   ```

## Enable Baseline Regression Detection

1. **Run the scraper once** to establish a baseline
   ```bash
   npm run scrape:sis
   ```

2. **Check baseline file**
   ```bash
   cat data/baseline.json
   ```

3. **Configure thresholds** (optional)
   Edit `.env`:
   ```bash
   BASELINE_DROP_THRESHOLD=10  # Fail if >10% drop
   BASELINE_WARN_ONLY=false    # Set true to only warn
   ```

4. **Subsequent runs** will compare against the baseline

## Running Tests

```bash
# JavaScript tests
npm test

# Python tests
pytest test_scraper.py -v -m "not network"

# Both
npm test && pytest test_scraper.py -v -m "not network"
```

## GitHub Actions Setup

The scraper runs automatically via GitHub Actions:

1. **Configure secrets** in your GitHub repository:
   - Go to Settings → Secrets → Actions
   - Add secrets for:
     - `GOOGLE_SERVICE_ACCOUNT`
     - `SPREADSHEET_ID`
     - `DATA_INGEST_TOKEN` (if using)
     - `SUPABASE_INGEST_ENDPOINT` (if using)

2. **Manual trigger**:
   - Go to Actions tab
   - Select "AdDU Curriculum Scraper"
   - Click "Run workflow"

## Troubleshooting

### Python scraper fails
- Check Python version: `python --version` (need 3.11+)
- Reinstall dependencies: `pip install -r requirements.txt`
- Check network connectivity

### Google Sheets sync fails
- Verify service account email has access to the sheet
- Check JSON format (must be valid JSON on a single line)
- Verify spreadsheet ID

### Tests fail
- Clear Node modules: `rm -rf node_modules && npm install`
- Check Node version: `node --version` (need 18+)

### Baseline warnings
- Review `data/baseline.json` for previous counts
- Adjust `BASELINE_DROP_THRESHOLD` if needed
- Set `BASELINE_WARN_ONLY=true` to disable job failures

## Next Steps

- Review the [README](README.md) for detailed documentation
- Check the [.env.example](.env.example) for all configuration options
- Explore the source code in `src/` directory
- Customize the scraper for your needs

## Support

For issues or questions:
- Open an issue on GitHub
- Check existing issues for solutions
- Review the code comments and documentation
