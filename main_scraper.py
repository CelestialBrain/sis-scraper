"""
AdDU Curriculum Scraper
Scrapes curriculum PDFs from AdDU website and consolidates them into a single database.
"""

import requests
from bs4 import BeautifulSoup
import pandas as pd
import os
import time
from urllib.parse import urlparse

from curriculum_parser import parse_curriculum_pdf

# Configuration
BASE_URL = "https://www.addu.edu.ph/undergraduate-programs/"
OUTPUT_CSV = "addu_curriculum_database.csv"
TEMP_PDF_FILENAME = "temp_curriculum.pdf"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

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

def main():
    """Main scraper function."""
    print("Starting AdDU Curriculum Scraper...")
    print(f"Target URL: {BASE_URL}")
    
    all_data = []
    program_links = []
    
    # Step 1: Get all program links from the main page
    print("\n📡 [1/3] Fetching program links...")
    try:
        response = requests.get(BASE_URL, headers=HEADERS)
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
                if href not in program_links:
                    print(f"   Found direct PDF: {href}")
                    program_links.append(href)
            
            # Allow "Graduate", "Programs", and "Bachelor" pages
            elif (
                "bachelor" in href_lower
                or "graduate" in href_lower
                or "programs" in href_lower
                or "/academics/" in href_lower
            ) and "addu.edu.ph" in href_lower:
                if href not in program_links:
                    print(f"   Found program page: {href}")
                    program_links.append(href)
        
        print(f"Found {len(program_links)} potential program pages.")
    except Exception as e:
        print(f"Error fetching program links: {e}")
        return
    
    # Step 2: Loop through each program and extract PDFs
    print("\n📄 [2/3] Processing program pages...")
    for i, link in enumerate(program_links):
        print(f"   🔎 Processing [{i+1}/{len(program_links)}]: {link}")
        
        try:
            # Check if the link itself is a direct PDF
            if is_pdf_url(link):
                print(f"   📕 -> Detected direct PDF link, downloading and parsing...")
                
                # Extract program name from URL
                program_name = extract_program_name_from_url(link)
                
                # Download PDF directly
                pdf_resp = requests.get(link, headers=HEADERS)
                pdf_resp.raise_for_status()
                with open(TEMP_PDF_FILENAME, 'wb') as f:
                    f.write(pdf_resp.content)
                
                # Parse using the curriculum parser
                rows = parse_curriculum_pdf(TEMP_PDF_FILENAME, program_name)
                print(f"   📈 -> parse_curriculum_pdf returned {len(rows)} rows for {program_name}")
                all_data.extend(rows)
                
                # Delete Temp File
                os.remove(TEMP_PDF_FILENAME)
                
            else:
                # Visit the specific program page (HTML)
                sub_response = requests.get(link, headers=HEADERS)
                sub_response.raise_for_status()
                sub_soup = BeautifulSoup(sub_response.content, "html.parser")
                
                # Find ALL PDF links on this page (not just the first one)
                pdf_tags = sub_soup.find_all("a", href=lambda h: h and h.lower().endswith('.pdf'))
                
                if pdf_tags:
                    print(f"   -> Found {len(pdf_tags)} PDF(s) on this page")
                    
                    for pdf_idx, pdf_tag in enumerate(pdf_tags, 1):
                        pdf_url = pdf_tag['href']
                        
                        # Make sure it's an absolute URL
                        if not pdf_url.startswith("http"):
                            pdf_url = "https://www.addu.edu.ph" + pdf_url
                        
                        # Extract program name from URL
                        program_name = extract_program_name_from_url(pdf_url)
                        
                        print(f"   📄 -> Found PDF {pdf_idx}/{len(pdf_tags)}: {program_name}")
                        
                        # Download Temp File
                        pdf_resp = requests.get(pdf_url, headers=HEADERS)
                        pdf_resp.raise_for_status()
                        with open(TEMP_PDF_FILENAME, 'wb') as f:
                            f.write(pdf_resp.content)
                        
                        # Parse using the curriculum parser
                        rows = parse_curriculum_pdf(TEMP_PDF_FILENAME, program_name)
                        print(f"   📈 -> parse_curriculum_pdf returned {len(rows)} rows for {program_name}")
                        all_data.extend(rows)
                        
                        # Delete Temp File
                        os.remove(TEMP_PDF_FILENAME)
                    
                else:
                    print("   ⚠️  -> No PDF found on this page.")
                
        except Exception as e:
            print(f"   -> Error: {e}")
            
        # Sleep to be polite
        time.sleep(1)
    
    # Step 3: Save Results
    print("\n💾 [3/3] Saving results...")
    if all_data:
        df = pd.DataFrame(all_data)
        df.to_csv(OUTPUT_CSV, index=False)
        print(f"\nSUCCESS: Database saved to {OUTPUT_CSV} with {len(df)} total rows.")
        print(f"Columns: {list(df.columns)}")
        print(f"\nSample data:")
        print(df.head(10))
    else:
        print("\nFAILURE: No data extracted.")

if __name__ == "__main__":
    main()
