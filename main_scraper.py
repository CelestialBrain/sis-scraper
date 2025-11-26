"""
AdDU Curriculum Scraper
Scrapes curriculum PDFs from AdDU website and consolidates them into a single database.
"""

import requests
from bs4 import BeautifulSoup
import pdfplumber
import pandas as pd
import re
import os
import time

# Configuration
BASE_URL = "https://www.addu.edu.ph/undergraduate-programs/"
OUTPUT_CSV = "addu_curriculum_database.csv"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

def clean_text(text):
    """Removes newlines and extra spaces from text."""
    if not text:
        return ""
    return str(text).replace('\n', ' ').strip()

def parse_units(unit_str):
    """
    Handles standard units (3.0) and Engineering units (1-3-2).
    Logic: If '1-3-2', the last digit is the Credit Unit.
    """
    if not unit_str:
        return 0.0
    text = str(unit_str).strip()
    
    # Handle Engineering "Lec-Lab-Credit" (e.g., "1-3-2" -> 2.0)
    if '-' in text:
        try:
            return float(text.split('-')[-1])
        except:
            pass
            
    # Handle standard numbers (e.g., "3.0")
    try:
        clean = re.sub(r"[^\d\.]", "", text)  # Remove non-numeric chars
        return float(clean) if clean else 0.0
    except:
        return 0.0

def extract_course_code(text):
    """
    Extracts course code (e.g., 'ROBO 1101') from a merged string.
    Returns (code, remaining_text).
    """
    if not text:
        return None, ""
    
    # Regex: 2-6 letters, optional space, 3-4 digits (e.g., ROBO 1101, BIO 100)
    pattern = r"([A-Z]{2,6}\s?-?\d{3,4}[A-Z]?)"
    match = re.search(pattern, text)
    if match:
        code = match.group(1)
        remaining = text.replace(code, "").strip()
        return code, remaining
    return None, text

def parse_pdf_content(pdf_path, program_name):
    """
    Parses a curriculum PDF and returns a list of course dictionaries.
    Handles both "Stacked List" and "Split/Parallel" layouts.
    """
    extracted_data = []
    
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            # Extract table with loose settings to catch whitespace layouts
            tables = page.extract_tables(table_settings={
                "vertical_strategy": "text",
                "horizontal_strategy": "text"
            })
            
            for table in tables:
                if not table:
                    continue
                
                # --- AUTO-ROUTER: Detect Layout Type ---
                headers = [str(x).lower() for x in table[0] if x]
                header_str = " ".join(headers)
                
                # Logic: If headers have 'lec'/'lab' OR row is very wide -> Engineering Layout
                is_engineering = ("lec" in header_str and "lab" in header_str) or len(table[0]) > 8
                
                # Variables for context (Year/Sem headers are rows, not columns)
                current_year = 1
                current_sem = "1st Semester"
                
                if is_engineering:
                    # --- ENGINEERING LAYOUT (Split Table) ---
                    midpoint = len(table[0]) // 2
                    
                    for row in table:
                        row_text = " ".join([str(x) for x in row if x]).lower()
                        
                        # Skip header and total rows
                        if "course no" in row_text or "total" in row_text:
                            continue
                        
                        # Detect year context
                        if "first year" in row_text or "1st year" in row_text:
                            current_year = 1
                        elif "second year" in row_text or "2nd year" in row_text:
                            current_year = 2
                        elif "third year" in row_text or "3rd year" in row_text:
                            current_year = 3
                        elif "fourth year" in row_text or "4th year" in row_text:
                            current_year = 4
                        
                        # LEFT SIDE (1st Semester)
                        left_side = row[:midpoint]
                        if any(left_side) and left_side[0]:
                            code, desc = extract_course_code(clean_text(left_side[0]))
                            if code:
                                extracted_data.append({
                                    "program": program_name,
                                    "year": current_year,
                                    "semester": "1st Semester",
                                    "code": code,
                                    "title": clean_text(left_side[1]) if len(left_side) > 1 else desc,
                                    "units": parse_units(left_side[4]) if len(left_side) > 4 else 0.0
                                })
                        
                        # RIGHT SIDE (2nd Semester)
                        right_side = row[midpoint:]
                        if any(right_side) and right_side[0]:
                            code, desc = extract_course_code(clean_text(right_side[0]))
                            if code:
                                extracted_data.append({
                                    "program": program_name,
                                    "year": current_year,
                                    "semester": "2nd Semester",
                                    "code": code,
                                    "title": clean_text(right_side[1]) if len(right_side) > 1 else desc,
                                    "units": parse_units(right_side[4]) if len(right_side) > 4 else 0.0
                                })
                
                else:
                    # --- STANDARD LAYOUT (Stacked List) ---
                    for row in table:
                        row_text = " ".join([str(x) for x in row if x]).lower()
                        
                        # State Machine: Detect Context Changes
                        if "1st year" in row_text or "first year" in row_text:
                            current_year = 1
                        elif "2nd year" in row_text or "second year" in row_text:
                            current_year = 2
                        elif "3rd year" in row_text or "third year" in row_text:
                            current_year = 3
                        elif "4th year" in row_text or "fourth year" in row_text:
                            current_year = 4
                        
                        if "1st semester" in row_text:
                            current_sem = "1st Semester"
                        elif "2nd semester" in row_text:
                            current_sem = "2nd Semester"
                        elif "summer" in row_text:
                            current_sem = "Summer"
                        
                        # Skip header rows and total rows
                        if "total number" in row_text or "course" in row_text or "description" in row_text:
                            continue
                        
                        # Extract Data
                        try:
                            if len(row) < 2:
                                continue
                            
                            code = clean_text(row[0])
                            desc = clean_text(row[1])
                            
                            # Filter out garbage rows
                            if len(code) < 3 or "semester" in code.lower() or "year" in code.lower():
                                continue
                            
                            # Validate course code format
                            if not re.search(r"[A-Z]{2,6}\s?\d{3,4}", code):
                                continue
                            
                            units = parse_units(row[2]) if len(row) > 2 else 0.0
                            
                            extracted_data.append({
                                "program": program_name,
                                "year": current_year,
                                "semester": current_sem,
                                "code": code,
                                "title": desc,
                                "units": units
                            })
                        except Exception as e:
                            continue
    
    return extracted_data

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
                with open(temp_filename, 'wb') as f:
                    f.write(requests.get(pdf_url, headers=HEADERS).content)
                
                # Parse
                rows = parse_pdf_content(temp_filename, program_name)
                all_data.extend(rows)
                print(f"   -> Extracted {len(rows)} courses.")
                
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
