"""
AdDU Curriculum Scraper
Scrapes curriculum PDFs from AdDU website and consolidates them into a single database.
"""

import requests
from bs4 import BeautifulSoup
import pandas as pd
import os
import time

from curriculum_parser import parse_curriculum_pdf

# Configuration
BASE_URL = "https://www.addu.edu.ph/undergraduate-programs/"
OUTPUT_CSV = "addu_curriculum_database.csv"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

def main():
    """Main scraper function."""
    print("Starting AdDU Curriculum Scraper...")
    print(f"Target URL: {BASE_URL}")
    
    all_data = []
    program_links = []
    
    # Step 1: Get all program links from the main page
    print("\n[1/3] Fetching program links...")
    try:
        response = requests.get(BASE_URL, headers=HEADERS)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, "html.parser")
        
        # Find all links on the page
        for link in soup.find_all("a", href=True):
            href = link['href']
            
            # Make sure it's an absolute URL
            if not href.startswith("http"):
                href = "https://www.addu.edu.ph" + href
            
            # Filter for relevant academic pages
            if ("bachelor" in href.lower() or "/academics/" in href) and "addu.edu.ph" in href:
                if href not in program_links:
                    program_links.append(href)
        
        print(f"Found {len(program_links)} potential program pages.")
    except Exception as e:
        print(f"Error fetching program links: {e}")
        return
    
    # Step 2: Loop through each program and extract PDFs
    print("\n[2/3] Processing program pages...")
    for i, link in enumerate(program_links):
        print(f"Processing [{i+1}/{len(program_links)}]: {link}")
        
        try:
            # Visit the specific program page
            sub_response = requests.get(link, headers=HEADERS)
            sub_response.raise_for_status()
            sub_soup = BeautifulSoup(sub_response.content, "html.parser")
            
            # Find the PDF link
            pdf_tag = sub_soup.find("a", href=lambda h: h and h.lower().endswith('.pdf'))
            
            if pdf_tag:
                pdf_url = pdf_tag['href']
                
                # Make sure it's an absolute URL
                if not pdf_url.startswith("http"):
                    pdf_url = "https://www.addu.edu.ph" + pdf_url
                
                # Clean up name: "Bachelor-of-Arts-in-Anthropology.pdf" -> "Bachelor of Arts in Anthropology"
                program_name = pdf_url.split('/')[-1].replace('.pdf', '').replace('-', ' ')
                
                print(f"   -> Found PDF: {program_name}")
                
                # Download Temp File
                temp_filename = "temp_curriculum.pdf"
                pdf_resp = requests.get(pdf_url, headers=HEADERS)
                pdf_resp.raise_for_status()
                with open(temp_filename, 'wb') as f:
                    f.write(pdf_resp.content)
                
                # Parse using the new curriculum parser
                rows = parse_curriculum_pdf(temp_filename, program_name)
                print(f"   -> parse_curriculum_pdf returned {len(rows)} rows for {program_name}")
                all_data.extend(rows)
                
                # Delete Temp File
                os.remove(temp_filename)
                
            else:
                print("   -> No PDF found on this page.")
                
        except Exception as e:
            print(f"   -> Error: {e}")
            
        # Sleep to be polite
        time.sleep(1)
    
    # Step 3: Save Results
    print("\n[3/3] Saving results...")
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
