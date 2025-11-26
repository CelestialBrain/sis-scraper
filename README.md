# SIS Scraper

A curriculum scraper for Ateneo de Davao University (AdDU) that parses multiple PDF formats and consolidates data into a single database schema.

## Overview

This scraper automatically collects curriculum data from the AdDU undergraduate programs website, parses PDF documents with different layouts, and consolidates them into a structured CSV database.

### Features

- **Multi-format PDF parsing**: Handles two distinct curriculum layouts:
  - **Stacked List Layout**: Used by Arts & Sciences programs (e.g., Anthropology, Development Studies)
  - **Split/Parallel Layout**: Used by Engineering and Science programs (e.g., Robotics, Biology)
- **Automatic layout detection**: Router logic identifies the PDF format and applies the appropriate parser
- **Data normalization**: Converts various unit formats (e.g., "3.0" and "1-3-2") into standardized values
- **Automated scraping**: GitHub Actions workflow runs weekly to keep data up-to-date
- **No AI required**: Pure Python parsing using regex and table extraction

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

### Local Setup

1. Clone the repository:
```bash
git clone https://github.com/CelestialBrain/sis-scraper.git
cd sis-scraper
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Run the scraper:
```bash
python main_scraper.py
```

The script will generate `addu_curriculum_database.csv` in the current directory.

## GitHub Actions Automation

The scraper runs automatically via GitHub Actions:

- **Schedule**: Every Sunday at midnight UTC
- **Manual trigger**: Available via the "Actions" tab in GitHub
- **Output**: CSV file uploaded as an artifact (retained for 90 days)
- **Auto-commit**: Results are automatically committed back to the repository

### Manual Trigger

1. Go to the **Actions** tab in your GitHub repository
2. Select **AdDU Curriculum Scraper** workflow
3. Click **Run workflow**

## Technical Details

### PDF Parsing Strategy

The scraper uses a **funnel strategy** to handle multiple PDF formats:

1. **Ingestion**: Uses `pdfplumber` to extract tables from PDFs
2. **Layout Detection**: Auto-router examines headers and table width to identify format
3. **Extraction**: Applies format-specific logic:
   - **Stacked List**: Reads rows sequentially with state machine for year/semester context
   - **Split/Parallel**: Splits wide tables at midpoint to separate left (Sem 1) and right (Sem 2) columns
4. **Normalization**: Standardizes course codes, units, and text formatting

### Unit Parsing Logic

- **Standard format** (e.g., "3.0"): Extracted directly
- **Engineering format** (e.g., "1-3-2" for Lec-Lab-Credit): Takes the last digit as total units

### Course Code Extraction

Uses regex pattern `[A-Z]{2,6}\s?-?\d{3,4}[A-Z]?` to match codes like:
- `ROBO 1101`
- `ANTHRO1130`
- `BIO 100A`

## Dependencies

- `requests`: HTTP requests for web scraping
- `beautifulsoup4`: HTML parsing
- `pdfplumber`: PDF table extraction
- `pandas`: Data manipulation and CSV export
- `openpyxl`: Excel support (optional)

## Project Structure

```
sis-scraper/
├── main_scraper.py          # Main scraper script
├── requirements.txt         # Python dependencies
├── .github/
│   └── workflows/
│       └── scrape.yml      # GitHub Actions workflow
├── README.md               # This file
└── addu_curriculum_database.csv  # Output (generated)
```

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
- [ ] Database integration (PostgreSQL/SQLite)

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

This project is open source and available under the MIT License.

## Disclaimer

This scraper is for educational purposes. Please respect the AdDU website's terms of service and use responsibly.
