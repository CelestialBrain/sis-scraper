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
from urllib.parse import urlparse
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
CURRICULUM_CONCURRENCY = int(os.environ.get("CURRICULUM_CONCURRENCY", "2"))
CURRICULUM_DELAY_MS = int(os.environ.get("CURRICULUM_DELAY_MS", "100"))
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
        except OSError:
            pass


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


def discover_pdf_urls(delay_ms=100):
    """
    Discover all curriculum PDF URLs from the AdDU website.
    
    Args:
        delay_ms: Delay in milliseconds between HTTP requests
        
    Returns:
        list: List of PDF URLs discovered
    """
    pdf_urls = []
    program_links = []
    delay_sec = delay_ms / 1000.0
    
    logger.info(f"[Discovery] Starting URL discovery from {BASE_URL}")
    
    try:
        response = requests.get(BASE_URL, headers=HEADERS, timeout=30)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, "html.parser")
        
        # Find all links on the page
        for link in soup.find_all("a", href=True):
            href = link.get("href")
            if not href:
                continue
            
            # Normalize to absolute URL
            if not href.startswith("http"):
                href = "https://www.addu.edu.ph" + href
            
            href_lower = href.lower()
            
            # Catch direct PDFs immediately
            if href_lower.endswith(".pdf"):
                if href not in pdf_urls:
                    logger.debug(f"[Discovery] Found direct PDF: {href}")
                    pdf_urls.append(href)
            
            # Allow "Graduate", "Programs", and "Bachelor" pages
            elif (
                "bachelor" in href_lower
                or "graduate" in href_lower
                or "programs" in href_lower
                or "/academics/" in href_lower
            ) and "addu.edu.ph" in href_lower:
                if href not in program_links:
                    logger.debug(f"[Discovery] Found program page: {href}")
                    program_links.append(href)
        
        logger.info(f"[Discovery] Found {len(pdf_urls)} direct PDFs and {len(program_links)} program pages")
        
    except Exception as e:
        logger.error(f"[Discovery] Error fetching main page: {e}")
        return []
    
    # Visit each program page to find more PDFs
    for i, link in enumerate(program_links):
        if is_pdf_url(link):
            # Already a PDF URL
            if link not in pdf_urls:
                pdf_urls.append(link)
            continue
        
        try:
            # Polite delay between requests
            if delay_sec > 0:
                time.sleep(delay_sec)
            
            logger.debug(f"[Discovery] Checking page [{i+1}/{len(program_links)}]: {link}")
            
            sub_response = requests.get(link, headers=HEADERS, timeout=30)
            sub_response.raise_for_status()
            sub_soup = BeautifulSoup(sub_response.content, "html.parser")
            
            # Find ALL PDF links on this page
            pdf_tags = sub_soup.find_all("a", href=lambda h: h and h.lower().endswith('.pdf'))
            
            for pdf_tag in pdf_tags:
                pdf_url = pdf_tag['href']
                
                # Make sure it's an absolute URL
                if not pdf_url.startswith("http"):
                    pdf_url = "https://www.addu.edu.ph" + pdf_url
                
                if pdf_url not in pdf_urls:
                    logger.debug(f"[Discovery] Found PDF on page: {pdf_url}")
                    pdf_urls.append(pdf_url)
                    
        except Exception as e:
            logger.warning(f"[Discovery] Error processing page {link}: {e}")
    
    logger.info(f"[Discovery] Total PDFs discovered: {len(pdf_urls)}")
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
        limit = int(CURRICULUM_LIMIT)
        if len(filtered) > limit:
            filtered = filtered[:limit]
            logger.info(f"[Filter] CURRICULUM_LIMIT applied: limited to {limit} PDFs")
    
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
