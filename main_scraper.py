"""
AdDU Curriculum Scraper
Scrapes curriculum PDFs from AdDU website and consolidates them into a single database.

Features:
- Concurrent PDF downloading and parsing using ThreadPoolExecutor
- AISIS-style schema transformation
- Google Sheets and Supabase integration
- Environment-based configuration compatible with aisis-scraper
"""

import requests
from bs4 import BeautifulSoup
import pandas as pd
import os
import time
import tempfile
import logging
from urllib.parse import urlparse, urljoin
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

from curriculum_parser import parse_curriculum_pdf
from schema_transformer import transform_to_aisis_schema, UNIVERSITY_CODE
from sheets_uploader import upload_to_sheets
from supabase_sender import send_to_supabase

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
BASE_URL = "https://www.addu.edu.ph/undergraduate-programs/"
OUTPUT_CSV = "addu_curriculum_database.csv"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

# Environment configuration (AISIS-style)
def _get_env_int(name, default):
    """Get an integer from environment variable with safe fallback."""
    try:
        return int(os.environ.get(name, default))
    except (ValueError, TypeError):
        logger.warning(f"Invalid value for {name}, using default: {default}")
        return int(default)

CURRICULUM_CONCURRENCY = _get_env_int("CURRICULUM_CONCURRENCY", "2")
CURRICULUM_DELAY_MS = _get_env_int("CURRICULUM_DELAY_MS", "100")
CURRICULUM_LIMIT = os.environ.get("CURRICULUM_LIMIT")  # Optional: limit number of programs
CURRICULUM_SAMPLE = os.environ.get("CURRICULUM_SAMPLE")  # Optional: filter to specific programs

# Thread-local storage for temp files
_thread_local = threading.local()

def is_pdf_url(url):
    """
    Check if a URL points directly to a PDF file.
    
    Args:
        url: The URL to check
        
    Returns:
        True if the URL path ends with .pdf (case-insensitive), False otherwise
    """
    parsed = urlparse(url)
    path = parsed.path.lower()
    return path.endswith('.pdf')

def extract_program_name_from_url(url):
    """
    Extract a human-readable program name from a PDF URL.
    
    Args:
        url: The URL containing the program name
        
    Returns:
        Program name with spaces instead of hyphens
    """
    # Parse URL to get just the path (strip query params and fragments)
    parsed = urlparse(url)
    path = parsed.path
    
    # Get the filename from the path
    filename = path.split('/')[-1]
    
    # Remove .pdf extension and replace hyphens with spaces
    return filename.replace('.pdf', '').replace('-', ' ')


def get_thread_temp_file():
    """
    Get a thread-local temporary file path for PDF downloads.
    
    Returns:
        str: Path to a unique temporary file for this thread
    """
    if not hasattr(_thread_local, 'temp_file'):
        # Create a unique temp file for this thread
        fd, path = tempfile.mkstemp(suffix='.pdf', prefix='curriculum_')
        os.close(fd)
        _thread_local.temp_file = path
    return _thread_local.temp_file


def cleanup_thread_temp_file():
    """Remove the thread-local temporary file if it exists."""
    if hasattr(_thread_local, 'temp_file'):
        try:
            if os.path.exists(_thread_local.temp_file):
                os.remove(_thread_local.temp_file)
        except OSError as e:
            logger.debug(f"[Cleanup] Could not remove temp file: {e}")


def download_and_parse_pdf(pdf_url):
    """
    Download a PDF from URL and parse it for curriculum data.
    
    This function is designed to be called from a thread pool.
    
    Args:
        pdf_url: URL of the PDF to download and parse
        
    Returns:
        tuple: (pdf_url, rows, error) where rows is a list of parsed course dicts
               or empty list if error occurred, and error is the exception or None
    """
    try:
        # Extract program name from URL
        program_name = extract_program_name_from_url(pdf_url)
        
        # Get thread-local temp file
        temp_file = get_thread_temp_file()
        
        # Download PDF
        logger.info(f"[PDF] Downloading: {program_name}")
        pdf_resp = requests.get(pdf_url, headers=HEADERS, timeout=60)
        pdf_resp.raise_for_status()
        
        with open(temp_file, 'wb') as f:
            f.write(pdf_resp.content)
        
        # Parse using the curriculum parser
        rows = parse_curriculum_pdf(temp_file, program_name)
        logger.info(f"[PDF] Parsed {len(rows)} rows from {program_name}")
        
        return (pdf_url, rows, None)
        
    except Exception as e:
        logger.error(f"[PDF] Error processing {pdf_url}: {e}")
        return (pdf_url, [], e)
    finally:
        cleanup_thread_temp_file()


# Advanced discovery configuration
BASE_URLS = [
    "https://www.addu.edu.ph/undergraduate-programs/",
    "https://www.addu.edu.ph/graduate-programs/",
    "https://www.addu.edu.ph/academics/school-of-engineering-and-architecture/",
    "https://www.addu.edu.ph/academics/school-of-nursing/",
    "https://www.addu.edu.ph/academics/school-of-arts-and-sciences/",
]
HEAD_CHECK_LIMIT = 50
ENABLE_HEAD_PROBE = os.environ.get("ENABLE_HEAD_PROBE", "true").lower() == "true"

# Keywords that suggest a URL might be a download link (for HEAD probing)
DOWNLOAD_KEYWORDS = ["curriculum", "prospectus", "download", "course", "checklist", "plan"]

# Substrings to filter out non-curriculum garbage URLs
GARBAGE_SUBSTRINGS = ["manual", "handbook", "memo", "calendar", "policy", "policies"]


def is_addu_domain(url):
    """
    Check if a URL belongs to the AdDU domain.
    
    Args:
        url: The URL to check
        
    Returns:
        True if the URL's hostname ends with 'addu.edu.ph', False otherwise
    """
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname or ""
        return hostname.endswith("addu.edu.ph")
    except Exception:
        return False


def is_garbage_url(url):
    """
    Check if a URL is likely non-curriculum content (garbage).
    
    Args:
        url: The URL to check
        
    Returns:
        True if the URL contains garbage substrings, False otherwise
    """
    url_lower = url.lower()
    return any(garbage in url_lower for garbage in GARBAGE_SUBSTRINGS)


def has_download_keyword(url):
    """
    Check if a URL contains likely download-related keywords.
    
    Args:
        url: The URL to check
        
    Returns:
        True if URL contains download keywords, False otherwise
    """
    url_lower = url.lower()
    return any(keyword in url_lower for keyword in DOWNLOAD_KEYWORDS)


def is_department_page(url):
    """
    Check if a URL is a department/school/college/academics page worth crawling.
    
    Args:
        url: The URL to check
        
    Returns:
        True if the URL looks like a department or academics page, False otherwise
    """
    url_lower = url.lower()
    return any(keyword in url_lower for keyword in [
        "/school-", "/college-", "/academics/", "/department", 
        "graduate", "undergraduate", "programs", "bachelor"
    ])


def is_pdf_content(url, head_check_counter):
    """
    Check if a URL points to PDF content.
    
    Uses a fast-path check for .pdf extension, and optionally uses HEAD
    request for URLs with download keywords.
    
    Args:
        url: The URL to check
        head_check_counter: Dict with 'count' key tracking HEAD requests made
        
    Returns:
        True if the URL is detected as PDF content, False otherwise
    """
    # Fast-path: URL ends with .pdf
    parsed = urlparse(url)
    path = parsed.path.lower()
    if path.endswith('.pdf'):
        return True
    
    # Optional HEAD probe for URLs with download keywords
    if not ENABLE_HEAD_PROBE:
        return False
    
    if head_check_counter['count'] >= HEAD_CHECK_LIMIT:
        return False
    
    if not has_download_keyword(url):
        return False
    
    try:
        head_check_counter['count'] += 1
        resp = requests.head(url, headers=HEADERS, timeout=10, allow_redirects=True)
        content_type = resp.headers.get('Content-Type', '').lower()
        return 'application/pdf' in content_type
    except Exception:
        return False


def discover_pdf_urls(delay_ms=100):
    """
    Discover all curriculum PDF URLs from the AdDU website.
    
    Crawls multiple base URLs with shallow recursion (depth 1) to discover
    curriculum PDFs from undergraduate, graduate, and department pages.
    
    Args:
        delay_ms: Delay in milliseconds between HTTP requests
        
    Returns:
        list: De-duplicated list of PDF URLs discovered
    """
    pdf_urls_set = set()
    visited = set()
    pages_to_crawl = []  # (url, depth) tuples
    delay_sec = delay_ms / 1000.0
    head_check_counter = {'count': 0}
    
    logger.info(f"[Discovery] Starting URL discovery from {len(BASE_URLS)} base URLs")
    
    # Initialize with base URLs at depth 0
    for base_url in BASE_URLS:
        pages_to_crawl.append((base_url, 0))
    
    while pages_to_crawl:
        current_url, depth = pages_to_crawl.pop(0)
        
        # Skip already visited pages
        if current_url in visited:
            continue
        
        # Skip non-AdDU domains
        if not is_addu_domain(current_url):
            continue
        
        visited.add(current_url)
        
        # Polite delay between requests
        if delay_sec > 0 and len(visited) > 1:
            time.sleep(delay_sec)
        
        logger.debug(f"[Discovery] Crawling (depth={depth}): {current_url}")
        
        try:
            response = requests.get(current_url, headers=HEADERS, timeout=30)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, "html.parser")
            
            # Find all links on the page
            for link in soup.find_all("a", href=True):
                href = link.get("href")
                if not href:
                    continue
                
                # Normalize to absolute URL using urljoin
                abs_url = urljoin(current_url, href)
                
                # Skip non-AdDU domains
                if not is_addu_domain(abs_url):
                    continue
                
                # Skip garbage URLs
                if is_garbage_url(abs_url):
                    logger.debug(f"[Discovery] Skipping garbage URL: {abs_url}")
                    continue
                
                # Check if this is a PDF
                if is_pdf_content(abs_url, head_check_counter):
                    if abs_url not in pdf_urls_set:
                        logger.debug(f"[Discovery] Found PDF: {abs_url}")
                        pdf_urls_set.add(abs_url)
                # If depth < 1 and it's a department/academics page, queue for crawling
                elif depth < 1 and is_department_page(abs_url) and abs_url not in visited:
                    pages_to_crawl.append((abs_url, depth + 1))
                    
        except Exception as e:
            logger.warning(f"[Discovery] Error crawling {current_url}: {e}")
    
    pdf_urls = list(pdf_urls_set)
    logger.info(f"[Discovery] Total PDFs found: {len(pdf_urls)}")
    return pdf_urls


def apply_filters(pdf_urls):
    """
    Apply optional filtering based on CURRICULUM_LIMIT and CURRICULUM_SAMPLE env vars.
    
    Args:
        pdf_urls: List of PDF URLs
        
    Returns:
        list: Filtered list of PDF URLs
    """
    filtered = pdf_urls
    
    # Apply sample filter if set
    if CURRICULUM_SAMPLE:
        samples = [s.strip().lower() for s in CURRICULUM_SAMPLE.split(",")]
        filtered = [
            url for url in filtered 
            if any(sample in url.lower() for sample in samples)
        ]
        logger.info(f"[Filter] CURRICULUM_SAMPLE applied: {len(filtered)} PDFs match filter")
    
    # Apply limit if set
    if CURRICULUM_LIMIT:
        try:
            limit = int(CURRICULUM_LIMIT)
            if len(filtered) > limit:
                filtered = filtered[:limit]
                logger.info(f"[Filter] CURRICULUM_LIMIT applied: limited to {limit} PDFs")
        except ValueError:
            logger.warning(f"[Filter] Invalid CURRICULUM_LIMIT value: {CURRICULUM_LIMIT}")
    
    return filtered

def main():
    """Main scraper function with concurrent PDF processing."""
    print("\n" + "=" * 60)
    print("🎓 AdDU Curriculum Scraper (AISIS-aligned)")
    print("=" * 60)
    
    print(f"\nConfiguration:")
    print(f"  CURRICULUM_CONCURRENCY: {CURRICULUM_CONCURRENCY}")
    print(f"  CURRICULUM_DELAY_MS: {CURRICULUM_DELAY_MS}")
    print(f"  CURRICULUM_LIMIT: {CURRICULUM_LIMIT or 'None'}")
    print(f"  CURRICULUM_SAMPLE: {CURRICULUM_SAMPLE or 'None'}")
    print(f"  UNIVERSITY_CODE: {UNIVERSITY_CODE}")
    print(f"  Target URL: {BASE_URL}")
    
    all_data = []
    
    # Step 1: Discover all PDF URLs
    print("\n📡 [1/5] Discovering curriculum PDFs...")
    pdf_urls = discover_pdf_urls(delay_ms=CURRICULUM_DELAY_MS)
    
    if not pdf_urls:
        print("\n❌ FAILURE: No PDFs discovered.")
        return
    
    # Apply filters
    pdf_urls = apply_filters(pdf_urls)
    print(f"[Discovery] Processing {len(pdf_urls)} PDFs")
    
    # Step 2: Download and parse PDFs concurrently
    print(f"\n📄 [2/5] Processing PDFs (concurrency={CURRICULUM_CONCURRENCY})...")
    
    start_time = time.time()
    
    with ThreadPoolExecutor(max_workers=CURRICULUM_CONCURRENCY) as executor:
        # Submit all PDF URLs as jobs
        futures = {
            executor.submit(download_and_parse_pdf, url): url 
            for url in pdf_urls
        }
        
        # Collect results as they complete
        completed = 0
        errors = 0
        
        for future in as_completed(futures):
            url = futures[future]
            completed += 1
            
            try:
                pdf_url, rows, error = future.result()
                
                if error:
                    errors += 1
                    logger.warning(f"[{completed}/{len(pdf_urls)}] Failed: {extract_program_name_from_url(url)}")
                else:
                    all_data.extend(rows)
                    logger.info(f"[{completed}/{len(pdf_urls)}] Completed: {extract_program_name_from_url(url)} ({len(rows)} rows)")
                    
            except Exception as e:
                errors += 1
                logger.error(f"[{completed}/{len(pdf_urls)}] Exception: {e}")
    
    elapsed = time.time() - start_time
    print(f"\n   ⏱  PDF processing completed in {elapsed:.1f}s ({errors} errors)")
    
    # Step 3: Transform to AISIS schema
    print("\n🔄 [3/5] Transforming to AISIS schema...")
    
    if not all_data:
        print("\n❌ FAILURE: No data extracted from PDFs.")
        return
    
    # Save raw CSV (original format)
    raw_df = pd.DataFrame(all_data)
    raw_df.to_csv(OUTPUT_CSV, index=False)
    print(f"   Raw data saved to {OUTPUT_CSV} ({len(raw_df)} rows)")
    
    # Transform to AISIS schema
    aisis_df = transform_to_aisis_schema(all_data)
    aisis_csv = "addu_curriculum_aisis.csv"
    aisis_df.to_csv(aisis_csv, index=False)
    print(f"   AISIS schema saved to {aisis_csv} ({len(aisis_df)} rows)")
    print(f"   Columns: {list(aisis_df.columns)}")
    
    # Step 4: Upload to Google Sheets (if configured)
    print("\n📊 [4/5] Google Sheets integration...")
    sheets_result = upload_to_sheets(aisis_df)
    
    if sheets_result.get("success"):
        print(f"   ✅ Uploaded {sheets_result.get('rows_written', 0)} rows to Google Sheets")
    elif sheets_result.get("reason") in ("no_spreadsheet_id", "no_credentials"):
        print("   ⏭️  Skipped (not configured)")
    else:
        print(f"   ❌ Failed: {sheets_result.get('error', sheets_result.get('reason'))}")
    
    # Step 5: Send to Supabase (if configured)
    print("\n🚀 [5/5] Supabase integration...")
    supabase_result = send_to_supabase(aisis_df)
    
    if supabase_result.get("success"):
        print(f"   ✅ Sent {supabase_result.get('records_sent', 0)} records to Supabase")
    elif supabase_result.get("reason") in ("no_supabase_url", "no_ingest_token"):
        print("   ⏭️  Skipped (not configured)")
    else:
        print(f"   ❌ Failed: {supabase_result.get('error', supabase_result.get('reason'))}")
    
    # Final summary
    print("\n" + "=" * 60)
    print("FINAL SUMMARY")
    print("=" * 60)
    print(f"PDFs processed: {len(pdf_urls)}")
    print(f"Total courses extracted: {len(all_data)}")
    print(f"Processing time: {elapsed:.1f}s")
    print(f"Raw CSV: {OUTPUT_CSV}")
    print(f"AISIS CSV: {aisis_csv}")
    print(f"Google Sheets: {'completed' if sheets_result.get('success') else 'skipped'}")
    print(f"Supabase: {'completed' if supabase_result.get('success') else 'skipped'}")
    print("\n✅ SUCCESS: Scraping completed")

if __name__ == "__main__":
    main()
