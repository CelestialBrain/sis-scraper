# SIS Scraper

A curriculum scraper for Ateneo de Davao University (AdDU) that parses multiple PDF formats and consolidates data into a single database schema. Available in both **Python** (original implementation) and **JavaScript** (with Google Sheets and Supabase integration).

## Overview

This scraper automatically collects curriculum data from the AdDU undergraduate programs website, parses PDF documents with different layouts, and consolidates them into a structured database. The JavaScript implementation mirrors the architecture of the [aisis-scraper](https://github.com/CelestialBrain/aisis-scraper) project.

### Features

- **Direct PDF URL handling**: Automatically detects and processes program URLs that point directly to PDF files
- **Multi-format PDF parsing**: Handles two distinct curriculum layouts:
  - **Stacked List Layout**: Used by Arts & Sciences programs (e.g., Anthropology, Development Studies)
  - **Split/Parallel Layout**: Used by Engineering and Science programs (e.g., Robotics, Biology)
- **Automatic layout detection**: Router logic identifies the PDF format and applies the appropriate parser
- **Data normalization**: Converts various unit formats (e.g., "3.0" and "1-3-2") into standardized values
- **Google Sheets integration**: (JS) Sync curriculum data to Google Sheets for easy access
- **Supabase/DB sync**: (JS) Batch upload to Supabase or custom database endpoints
- **Baseline regression detection**: (JS) Detect significant drops in course counts
- **Automated scraping**: GitHub Actions workflow runs weekly to keep data up-to-date
- **No AI required**: Pure Python parsing using regex and table extraction
- **Comprehensive test coverage**: Unit and integration tests with pytest (Python) and Jest (JavaScript)

## Database Schema

The output CSV file (`addu_curriculum_database.csv`) contains the following columns:

| Column | Type | Description |
|--------|------|-------------|
| `program` | String | Program name (e.g., "BS Robotics Engineering") |
| `year` | Integer | Year level (1, 2, 3, 4) |
| `semester` | String | Semester ("1st Semester", "2nd Semester", "Summer") |
| `code` | String | Course code (e.g., "ROBO 1101", "ANTHRO 1130") |
| `title` | String | Course title/description |
| `units` | Float | Credit units (normalized to total units) |

## Installation

### Python Setup (Original Scraper)

1. Clone the repository:
```bash
git clone https://github.com/CelestialBrain/sis-scraper.git
cd sis-scraper
```

2. Install Python dependencies:
```bash
pip install -r requirements.txt
```

3. Run the Python scraper:
```bash
python main_scraper.py
```

The script will generate `addu_curriculum_database.csv` in the current directory.

4. Run Python tests:
```bash
pytest test_scraper.py -v
```

To skip network-dependent tests:
```bash
pytest test_scraper.py -v -m "not network"
```

### JavaScript Setup (Extended Scraper with Integrations)

The JavaScript implementation provides a bridge to the Python scraper with additional features like Google Sheets sync, Supabase integration, and baseline regression detection.

1. Install Node.js dependencies:
```bash
npm install
```

2. Configure environment variables (create a `.env` file or set in your environment):

```bash
# Optional: SIS credentials (for future authentication requirements)
SIS_USERNAME=your_username
SIS_PASSWORD=your_password

# Optional: Database/Supabase sync
DATA_INGEST_TOKEN=your_ingest_token
SUPABASE_INGEST_ENDPOINT=https://your-endpoint.com/api/ingest

# Optional: Google Sheets integration
GOOGLE_SERVICE_ACCOUNT='{"type":"service_account","project_id":"...","private_key":"..."}' 
SPREADSHEET_ID=your_spreadsheet_id

# Optional: Scraper configuration
SIS_TERM=AY2024-Current
SIS_SCRAPE_MODE=current  # Options: current, future, all
SCHEDULE_SEND_CONCURRENCY=5
SUPABASE_CLIENT_BATCH_SIZE=100
BASELINE_DROP_THRESHOLD=10
BASELINE_WARN_ONLY=false
DEBUG_SCRAPER=false
```

3. Run the JavaScript scraper:
```bash
npm run scrape:sis
# or directly: node index.js
```

4. Run JavaScript tests:
```bash
npm test
```

The JavaScript scraper will:
- Execute the Python scraper to generate curriculum data
- Parse and normalize the CSV output
- Optionally sync to Supabase/database
- Optionally sync to Google Sheets
- Perform baseline regression detection
- Generate JSON artifacts in `data/` directory

## GitHub Actions Automation

The scraper runs automatically via GitHub Actions with both Python and JavaScript test suites:

- **Schedule**: Every Sunday at midnight UTC
- **Tests**: Both Python and JavaScript tests run before scraping
- **Manual trigger**: Available via the "Actions" tab in GitHub
- **Output**: CSV file uploaded as an artifact (retained for 90 days)
- **Auto-commit**: Results are automatically committed back to the repository

### Manual Trigger

1. Go to the **Actions** tab in your GitHub repository
2. Select **AdDU Curriculum Scraper** workflow
3. Click **Run workflow**

## Technical Details

### Direct PDF URL Detection

The scraper now handles two types of program URLs:

1. **HTML program pages**: Pages that contain links to curriculum PDFs
2. **Direct PDF URLs**: URLs that point directly to PDF files (e.g., `https://www.addu.edu.ph/.../Bachelor-of-Science-in-Social-Work.pdf`)

The `is_pdf_url()` helper function uses `urllib.parse.urlparse` to check if a URL's path ends with `.pdf` (case-insensitive). When a direct PDF is detected:
- The scraper downloads it immediately
- No HTML parsing is performed
- The PDF is passed directly to the curriculum parser
- Logging clearly indicates "Detected direct PDF link, downloading and parsing..."

This prevents false "No PDF found on this page" errors for programs whose URLs are themselves PDFs.

### PDF Parsing Strategy

The PDF parsing logic is encapsulated in the `curriculum_parser.py` module, which provides:

- `parse_curriculum_pdf(pdf_path, program_name)`: Main function that handles all PDF layouts
- Detailed logging to stdout for debugging when new PDF layouts appear
- Support for both split/parallel and standard stacked layouts

The scraper uses a **funnel strategy** to handle multiple PDF formats:

1. **Ingestion**: Uses `pdfplumber` to extract tables from PDFs
2. **Layout Detection**: Auto-router examines headers and table width to identify format:
   - Headers containing `lec`/`lab` → Split layout (Engineering)
   - Headers containing `first semester` and `second semester` → Split layout (Biology)
   - Wide tables with >8 columns → Split layout
   - Otherwise → Standard stacked layout
3. **Extraction**: Applies format-specific logic:
   - **Stacked List**: Reads rows sequentially with state machine for year/semester context
   - **Split/Parallel**: Splits wide tables at midpoint to separate left (Sem 1) and right (Sem 2) columns
4. **Normalization**: Standardizes course codes, units, and text formatting

### Unit Parsing Logic

- **Standard format** (e.g., "3.0"): Extracted directly
- **Engineering format** (e.g., "1-3-2" for Lec-Lab-Credit): Takes the last digit as total units

### Course Code Extraction

Uses regex pattern `[A-Za-z]{2,8}\s?-?\d{3,4}[A-Za-z]?` to match codes like:
- `ROBO 1101` (uppercase)
- `SocWk 1130` (mixed case)
- `ANTHRO1130` (no space)
- `BIO 100A` (trailing letter)

## Dependencies

- `requests`: HTTP requests for web scraping
- `beautifulsoup4`: HTML parsing
- `pdfplumber`: PDF table extraction
- `pandas`: Data manipulation and CSV export
## Dependencies

### Python
- `requests`: HTTP requests for web scraping
- `beautifulsoup4`: HTML parsing
- `pdfplumber`: PDF table extraction
- `pandas`: Data manipulation and CSV export
- `openpyxl`: Excel support (optional)
- `pytest`: Testing framework

### JavaScript
- `googleapis`: Google Sheets API integration
- `pdf-parse`: PDF parsing (for future enhancements)
- `jest`: Testing framework
- `eslint`: Code linting

## Project Structure

```
sis-scraper/
├── index.js                 # JS entrypoint (calls src/index.js)
├── package.json             # Node.js dependencies and scripts
├── jest.config.json         # Jest test configuration
├── main_scraper.py          # Python scraper script
├── curriculum_parser.py     # PDF parsing logic module
├── test_scraper.py          # Python test suite
├── pytest.ini              # Pytest configuration
├── requirements.txt         # Python dependencies
├── src/                    # JavaScript source code
│   ├── index.js            # Main orchestrator
│   ├── scraper.js          # SISScraper class
│   ├── supabase.js         # SupabaseManager class
│   ├── sheets.js           # GoogleSheetsManager class
│   └── baseline.js         # BaselineManager class
├── tests/                  # JavaScript tests
│   ├── utils.test.js       # Utility function tests
│   ├── scraper.test.js     # Scraper tests
│   ├── supabase.test.js    # Supabase manager tests
│   └── baseline.test.js    # Baseline manager tests
├── data/                   # Generated artifacts (gitignored)
│   ├── courses.json        # Normalized course data
│   ├── schedules-per-department.json  # Department-grouped data
│   └── baseline.json       # Baseline comparison data
├── .github/
│   └── workflows/
│       └── scrape.yml      # GitHub Actions workflow
├── README.md               # This file
└── addu_curriculum_database.csv  # CSV output (generated)
```

## Testing

The project includes comprehensive test coverage for both Python and JavaScript:

### Python Tests
- **Unit tests**: Test the `is_pdf_url()` helper with various URL formats
- **Integration tests**: Test PDF parsing with real curriculum documents (requires network access)

Run Python tests:
```bash
# Run all tests except network-dependent ones
pytest test_scraper.py -v -m "not network"

# Run all tests including network-dependent ones
pytest test_scraper.py -v
```

### JavaScript Tests
- **Unit tests**: Test utility functions (`chunkArray`, `processWithConcurrency`, `compareTermCodes`)
- **Component tests**: Test `BaselineManager`, `SupabaseManager`, and `SISScraper` classes
- **Integration tests**: Test data transformation and sync logic

Run JavaScript tests:
```bash
npm test

# Watch mode for development
npm run test:watch

# With coverage
npm run test:coverage
```

## JavaScript Architecture

## JavaScript Architecture

The JavaScript implementation mirrors the architecture of [aisis-scraper](https://github.com/CelestialBrain/aisis-scraper) with consistent terminology and patterns:

### Core Components

1. **SISScraper** (`src/scraper.js`)
   - Bridges to the Python scraper for PDF processing
   - Provides JavaScript interface for curriculum data
   - Methods: `init()`, `login()`, `scrapeCurriculum()`, `getAvailableTerms()`

2. **SupabaseManager** (`src/supabase.js`)
   - Handles data transformation and normalization
   - Manages batched HTTP requests to ingest endpoint
   - Utilities: `chunkArray()`, `processWithConcurrency()`

3. **GoogleSheetsManager** (`src/sheets.js`)
   - OAuth2 authentication with service account
   - Creates/updates sheet tabs dynamically
   - Formats headers and handles data sync

4. **BaselineManager** (`src/baseline.js`)
   - Stores baseline metrics (course counts, department counts)
   - Detects regressions based on configurable thresholds
   - Can fail CI jobs or just warn

5. **Main Orchestrator** (`src/index.js`)
   - Coordinates all phases: init, login, scraping, sync, baseline
   - Tracks phase timings
   - Generates local JSON artifacts
   - Comprehensive logging and error handling

### Data Flow

1. Python scraper generates CSV from PDFs
2. JavaScript loads and parses CSV
3. Data normalized/transformed for target schema
4. Synced to Supabase (if configured)
5. Synced to Google Sheets (if configured)
6. Baseline comparison performed
7. Local artifacts saved (`data/courses.json`, `data/schedules-per-department.json`)

## Limitations

- **Website structure dependency**: Changes to the AdDU website structure may break the scraper
- **PDF format changes**: New curriculum layouts may require parser updates
- **Rate limiting**: Includes 1-second delay between requests to be respectful
- **Error handling**: Individual program failures don't stop the entire scrape

## Future Enhancements

- [ ] Add support for additional PDF layouts
- [ ] Implement prerequisite parsing
- [ ] Add data validation and quality checks
- [ ] Create visualization dashboard
- [ ] Support for graduate programs
- [ ] Native JavaScript PDF parsing (eliminate Python dependency)
- [ ] Historical curriculum tracking and diff detection
- [ ] API endpoint for programmatic access

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

This project is open source and available under the MIT License.

## Disclaimer

This scraper is for educational purposes. Please respect the AdDU website's terms of service and use responsibly.
