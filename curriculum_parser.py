"""
Curriculum PDF Parser Module

This module encapsulates all PDF parsing logic for the AdDU curriculum scraper.
It includes robust parsing for multiple PDF layouts and detailed logging for debugging.
"""

import pdfplumber
import re
import logging

# Configure module logger
logger = logging.getLogger(__name__)

# Words that match the course code pattern but are not valid course codes
IGNORE_CODES = {"FORMATION", "SEMESTER", "YEAR", "PAGE", "TOTAL", "UNITS"}

# Post-processing configuration constants
MIN_CODE_LENGTH = 4  # Minimum length for a valid course code
MAX_REASONABLE_UNITS = 30.0  # Maximum plausible unit value for a single course

# Regex for validating course codes: 2-6 letters, optional space/dash, 1-5 digits, optional trailing letter
# Examples: "MATH 101", "ECE 313", "BIO 1130", "SocWk 1130", "NSTP-1"
VALID_CODE_PATTERN = re.compile(r'^[A-Za-z]{2,6}\s?-?\d{1,5}[A-Za-z]?$', re.IGNORECASE)

# Regex for detecting header bleed rows that should be dropped
# Matches patterns like:
# - "Effective 2019" / "Effective 2020"
# - "Revised 2008"
# - "Curriculum Effective 2019-2020"
# - "Semester SY 2019-2020"
HEADER_REGEX = re.compile(
    r'(effective\s+\d{4}|revised\s+\d{4}|curriculum\s+effective\s+\d{4}|semester\s+sy\s+\d{4})',
    re.IGNORECASE
)

# Special subject labels that should be preserved even if they don't match VALID_CODE_PATTERN
SPECIAL_SUBJECTS = {"NSTP", "THESIS", "ASSEMBLY", "FYDP", "OJT", "PRACTICUM", "INTERNSHIP"}


def clean_text(text):
    """
    Removes newlines and extra spaces from text.
    
    Args:
        text: The input text to clean
        
    Returns:
        Cleaned string with normalized whitespace
    """
    if not text:
        return ""
    return " ".join(str(text).split())


def parse_units(unit_str):
    """
    Handles standard units (3.0) and Engineering units (1-3-2).
    
    For Engineering format "Lec-Lab-Credit" (e.g., "1-3-2"), extracts the last digit as Credit Units.
    For standard format (e.g., "3.0"), extracts the numeric value directly.
    
    Args:
        unit_str: String containing unit information
        
    Returns:
        Float representing the credit units, or 0.0 if parsing fails
    """
    if not unit_str:
        return 0.0
    text = str(unit_str).strip()
    
    # Handle Engineering "Lec-Lab-Credit" (e.g., "1-3-2" -> 2.0)
    if '-' in text:
        try:
            return float(text.split('-')[-1])
        except (ValueError, IndexError):
            pass
    
    # Handle standard numbers (e.g., "3.0")
    try:
        # Remove non-numeric chars except decimal point
        clean = re.sub(r"[^\d.]", "", text)
        return float(clean) if clean else 0.0
    except ValueError:
        return 0.0


def extract_course_code(text):
    """
    Extracts course code from a merged string.
    
    Supports mixed-case prefixes (e.g., 'SocWk 1130', 'ROBO 1101', 'BIO 100A').
    Returns both the matched code and any remaining description text.
    
    Args:
        text: The input text potentially containing a course code
        
    Returns:
        Tuple of (code, remaining_text) where code is the extracted course code
        or None if no match, and remaining_text is the leftover text.
    """
    if not text:
        return None, ""
    
    # Normalize whitespace first - collapse multiple spaces to single space
    normalized = " ".join(text.split())
    
    # Check if text starts with any ignored word (case-insensitive)
    # This catches cases like "FORMATION 123" where the regex would incorrectly
    # match "ORMATION 123" (skipping the first letter) instead of recognizing
    # that the text starts with an ignored word
    first_word = normalized.split()[0].upper() if normalized else ""
    if first_word in IGNORE_CODES:
        return None, text
    
    # Regex: 2-8 letters (mixed case), optional whitespace/dash, 3-4 digits, optional trailing letter
    # Examples: ROBO 1101, BIO 100A, SocWk 1130, Anthro 1201, CSc-1100
    pattern = r"([A-Za-z]{2,8}\s?-?\d{3,4}[A-Za-z]?)"
    match = re.search(pattern, normalized)
    if match:
        code = match.group(1)
        
        # Extract the prefix (letters only) and check against ignored codes
        prefix_match = re.match(r"([A-Za-z]+)", code)
        if prefix_match:
            prefix = prefix_match.group(1).upper()
            if prefix in IGNORE_CODES:
                return None, text
        
        # Normalize the code format: ensure space between letters and numbers
        # e.g., "ENGL1101" -> "ENGL 1101", but preserve "CSc-1100"
        if '-' not in code and ' ' not in code:
            # Find where digits start and insert space
            for i, char in enumerate(code):
                if char.isdigit():
                    code = code[:i] + " " + code[i:]
                    break
        
        remaining = normalized.replace(match.group(1), "", 1).strip()
        return code, remaining
    return None, text


def _detect_layout(table):
    """
    Detect the layout type of a table.
    
    Returns:
        Tuple of (is_split, reason) where is_split is True for split/engineering layout,
        False for standard layout, and reason is a string explaining the detection.
    """
    if not table or not table[0]:
        return False, "Empty table"
    
    headers = [str(x).lower() for x in table[0] if x]
    header_str = " ".join(headers)
    
    # Check for lec/lab columns (Engineering layout)
    if "lec" in header_str and "lab" in header_str:
        return True, "Headers contain 'lec' and 'lab'"
    
    # Check for dual semester headers (Biology-like layout)
    if "first semester" in header_str and "second semester" in header_str:
        return True, "Headers contain 'first semester' and 'second semester'"
    
    # Check for wide table (many columns)
    if len(table[0]) > 8:
        return True, f"Wide table with {len(table[0])} columns"
    
    return False, "Standard stacked layout"


def _parse_split_layout(table, program_name, current_year):
    """
    Parse a split/engineering layout table.
    
    This handles tables where each row contains data for both semesters,
    with the left half representing 1st semester and right half representing 2nd semester.
    
    Args:
        table: The table data (list of rows)
        program_name: Name of the program
        current_year: Current year level context
        
    Returns:
        Tuple of (extracted_data, updated_year)
    """
    extracted_data = []
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
                # Try to get title from second cell, or use description from code extraction
                title = clean_text(left_side[1]) if len(left_side) > 1 and left_side[1] else desc
                
                # Try to find units - prefer position 4, fallback to position 2
                units = 0.0
                if len(left_side) > 4 and left_side[4]:
                    units = parse_units(left_side[4])
                elif len(left_side) > 2 and left_side[2]:
                    units = parse_units(left_side[2])
                
                extracted_data.append({
                    "program": program_name,
                    "year": current_year,
                    "semester": "1st Semester",
                    "code": code,
                    "title": title,
                    "units": units
                })
        
        # RIGHT SIDE (2nd Semester)
        right_side = row[midpoint:]
        if any(right_side) and right_side[0]:
            code, desc = extract_course_code(clean_text(right_side[0]))
            if code:
                # Try to get title from second cell, or use description from code extraction
                title = clean_text(right_side[1]) if len(right_side) > 1 and right_side[1] else desc
                
                # Try to find units - prefer position 4, fallback to position 2
                units = 0.0
                if len(right_side) > 4 and right_side[4]:
                    units = parse_units(right_side[4])
                elif len(right_side) > 2 and right_side[2]:
                    units = parse_units(right_side[2])
                
                extracted_data.append({
                    "program": program_name,
                    "year": current_year,
                    "semester": "2nd Semester",
                    "code": code,
                    "title": title,
                    "units": units
                })
    
    return extracted_data, current_year


def _parse_standard_layout(table, program_name, current_year, current_sem):
    """
    Parse a standard stacked layout table.
    
    This handles tables where courses are listed sequentially with year/semester
    context provided by header rows.
    
    Args:
        table: The table data (list of rows)
        program_name: Name of the program
        current_year: Current year level context
        current_sem: Current semester context
        
    Returns:
        Tuple of (extracted_data, updated_year, updated_sem)
    """
    extracted_data = []
    
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
        # Be more selective: only skip if row ONLY contains these keywords or starts with them
        if "total number" in row_text:
            continue
        
        # Skip rows that are clearly headers (but don't skip course data that might contain these words)
        first_cell = clean_text(row[0]) if row and row[0] else ""
        first_cell_lower = first_cell.lower()
        if first_cell_lower in ["course", "course code", "description", "course description", "units"]:
            continue
        
        # Extract Data
        try:
            if len(row) < 2:
                continue
            
            first_cell = clean_text(row[0])
            second_cell = clean_text(row[1]) if len(row) > 1 else ""
            
            # Skip empty rows
            if not first_cell and not second_cell:
                continue
            
            # Filter out garbage rows - check first cell
            if len(first_cell) < 2:
                continue
            if "semester" in first_cell_lower or "year" in first_cell_lower:
                continue
            
            # Try to extract course code from first cell
            code, leftover = extract_course_code(first_cell)
            
            if code:
                # Determine title: use second cell if available and non-empty, otherwise use leftover
                title = second_cell if second_cell else leftover
                
                # Find the first usable units value by scanning remaining cells
                units = 0.0
                for i in range(2, len(row)):
                    if row[i]:
                        parsed = parse_units(row[i])
                        if parsed > 0:
                            units = parsed
                            break
                
                extracted_data.append({
                    "program": program_name,
                    "year": current_year,
                    "semester": current_sem,
                    "code": code,
                    "title": title,
                    "units": units
                })
            else:
                # If first cell doesn't contain a course code, try combining first two cells
                # This handles cases where pdfplumber splits the code across cells
                # e.g., "SocWk" in cell 0, "1130" in cell 1
                # or "ENGL 1" in cell 0, "101" in cell 1 (split within the number)
                
                # Try direct combination first
                combined = first_cell + second_cell  # No space - handles "ENGL 1" + "101" -> "ENGL 1101"
                code, leftover = extract_course_code(combined)
                
                # If that didn't work, try with space
                if not code:
                    combined = first_cell + " " + second_cell
                    code, leftover = extract_course_code(combined)
                
                if code:
                    # Title is in the third cell or later, or use leftover
                    title = ""
                    title_start_idx = 2
                    if len(row) > 2 and row[2]:
                        title = clean_text(row[2])
                        title_start_idx = 3
                    elif leftover:
                        title = leftover
                    
                    # Find the first usable units value by scanning remaining cells
                    units = 0.0
                    for i in range(title_start_idx, len(row)):
                        if row[i]:
                            parsed = parse_units(row[i])
                            if parsed > 0:
                                units = parsed
                                break
                    
                    extracted_data.append({
                        "program": program_name,
                        "year": current_year,
                        "semester": current_sem,
                        "code": code,
                        "title": title,
                        "units": units
                    })
                
        except Exception as e:
            # Log error instead of silently suppressing
            print(f"      [WARN] Error parsing row: {row}")
            print(f"             Exception: {e}")
            continue
    
    return extracted_data, current_year, current_sem


def _is_special_subject(code_str):
    """
    Check if a code string contains any special subject label.
    
    Args:
        code_str: The code string to check
        
    Returns:
        True if the code contains a special subject label, False otherwise
    """
    if not code_str:
        return False
    code_upper = str(code_str).upper()
    return any(special in code_upper for special in SPECIAL_SUBJECTS)


def _contains_year(text):
    """
    Check if text contains a 4-digit year (1900-2099).
    
    Args:
        text: The text to check
        
    Returns:
        True if the text contains a 4-digit year, False otherwise
    """
    if not text:
        return False
    return bool(re.search(r'\b(19|20)\d{2}\b', str(text)))


def post_process_rows(rows):
    """
    Clean up parsing artifacts from curriculum rows.
    
    Filters out:
    - Header bleed rows (e.g., "Effective 2019", "Revised 2008")
    - Rows with absurd unit values (> 30.0)
    - Rows with invalid course codes
    
    Preserves:
    - Special subject labels (NSTP, THESIS, ASSEMBLY, FYDP, etc.)
    - Valid course codes matching VALID_CODE_PATTERN
    - Rows with non-numeric unit values (e.g., "NC")
    
    Args:
        rows: List of dictionaries with keys: program, year, semester, code, title, units
        
    Returns:
        Cleaned list of dictionaries with same structure
    """
    if not rows:
        return rows
    
    cleaned_rows = []
    original_count = len(rows)
    
    for row in rows:
        # Normalize fields to strings for checking
        code = str(row.get('code', '') or '').strip()
        title = str(row.get('title', '') or '').strip()
        units_raw = row.get('units', 0)
        
        # Drop header bleed rows: check if code or title matches HEADER_REGEX
        if HEADER_REGEX.search(code) or HEADER_REGEX.search(title):
            logger.debug(f"[Post-Process] Dropping header bleed row: code='{code}', title='{title}'")
            continue
        
        # Validate course codes
        # Allow special subjects even if they don't fully match VALID_CODE_PATTERN
        if not _is_special_subject(code):
            # Check if code is valid
            if not VALID_CODE_PATTERN.match(code):
                # Drop if code is very short (likely junk) or contains a 4-digit year
                if len(code) < MIN_CODE_LENGTH or _contains_year(code):
                    logger.debug(f"[Post-Process] Dropping invalid code row: code='{code}', title='{title}'")
                    continue
        
        # Normalize and validate units
        try:
            # Strip commas and convert to float
            units_str = str(units_raw).replace(',', '').strip()
            units_float = float(units_str)
            
            # Check for absurd values (likely merged text artifacts)
            if units_float > MAX_REASONABLE_UNITS:
                logger.warning(f"[Post-Process] Dropping row with absurd units: code='{code}', units={units_float}")
                continue
            
            # Store normalized float value
            row['units'] = units_float
            
        except (ValueError, TypeError):
            # Non-numeric units (e.g., "NC") - keep as-is
            pass
        
        cleaned_rows.append(row)
    
    cleaned_count = len(cleaned_rows)
    logger.info(f"[Post-Process] Cleaned data: {original_count} -> {cleaned_count} rows")
    
    return cleaned_rows


def parse_curriculum_pdf(pdf_path, program_name):
    """
    Parses a curriculum PDF and returns a list of course dictionaries.
    
    Handles both "Stacked List" and "Split/Parallel" layouts with automatic detection.
    Includes detailed logging for debugging PDF parsing issues.
    
    Args:
        pdf_path: Path to the PDF file
        program_name: Name of the program (used in output)
        
    Returns:
        List of dictionaries with keys: program, year, semester, code, title, units
    """
    extracted_data = []
    
    print(f"   [PDF] Parsing: {program_name}")
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            page_count = len(pdf.pages)
            print(f"   [PDF] Page count: {page_count}")
            
            # Track context across pages
            current_year = 1
            current_sem = "1st Semester"
            
            for page_num, page in enumerate(pdf.pages, 1):
                # Extract table with loose settings to catch whitespace layouts
                tables = page.extract_tables(table_settings={
                    "vertical_strategy": "text",
                    "horizontal_strategy": "text"
                }) or []
                
                print(f"   [PDF] Page {page_num}: Found {len(tables)} table(s)")
                
                for table_num, table in enumerate(tables, 1):
                    if not table:
                        continue
                    
                    # Detect layout type
                    is_split, reason = _detect_layout(table)
                    layout_type = "Split" if is_split else "Standard"
                    
                    # Get header info for logging
                    headers = [str(x)[:20] for x in table[0][:5] if x] if table and table[0] else []
                    header_str = " | ".join(headers)
                    col_count = len(table[0]) if table and table[0] else 0
                    
                    print(f"   [PDF] Page {page_num}, Table {table_num}: Layout={layout_type} ({reason}), Cols={col_count}")
                    print(f"         Headers: [{header_str}]")
                    
                    rows_before = len(extracted_data)
                    
                    if is_split:
                        # Split/Engineering layout
                        new_data, current_year = _parse_split_layout(
                            table, program_name, current_year
                        )
                        extracted_data.extend(new_data)
                    else:
                        # Standard stacked layout
                        new_data, current_year, current_sem = _parse_standard_layout(
                            table, program_name, current_year, current_sem
                        )
                        extracted_data.extend(new_data)
                    
                    rows_added = len(extracted_data) - rows_before
                    print(f"         Rows added: {rows_added}")
                    
    except Exception as e:
        print(f"   [PDF] ERROR parsing PDF: {e}")
        return []
    
    # Apply post-processing to clean up parsing artifacts
    cleaned_data = post_process_rows(extracted_data)
    
    print(f"   [PDF] Total courses extracted: {len(cleaned_data)}")
    return cleaned_data
