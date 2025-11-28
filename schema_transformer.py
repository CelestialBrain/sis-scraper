"""
AISIS Schema Transformer Module

Transforms raw parsed curriculum data from curriculum_parser into AISIS-style schema.
This module provides compatibility with the aisis-scraper data pipeline.
"""

import pandas as pd

# Hard-coded university code for ADDU - NOT from environment
UNIVERSITY_CODE = "ADDU"


def extract_deg_code(program_name):
    """
    Extract a degree code from the program name.
    
    Uses simple heuristics to derive a short code from the program name.
    Examples:
        "Bachelor of Science in Computer Science" -> "BSCS"
        "Bachelor of Arts in Psychology" -> "BAP"
        "Bachelor of Science in Social Work" -> "BSSW"
    
    Args:
        program_name: The full program name string
        
    Returns:
        A short degree code string
    """
    if not program_name:
        return ""
    
    # Normalize to uppercase for processing
    name = program_name.upper()
    
    # Common degree prefixes
    deg_prefix = ""
    if "BACHELOR OF SCIENCE" in name or "BS " in name or "B.S." in name:
        deg_prefix = "BS"
    elif "BACHELOR OF ARTS" in name or "BA " in name or "B.A." in name:
        deg_prefix = "BA"
    elif "BACHELOR" in name:
        deg_prefix = "B"
    elif "MASTER" in name:
        deg_prefix = "M"
    elif "DOCTOR" in name:
        deg_prefix = "D"
    
    # Try to extract program field abbreviation
    # Look for keywords in the program name
    field_abbrevs = {
        "COMPUTER SCIENCE": "CS",
        "INFORMATION TECHNOLOGY": "IT",
        "INFORMATION SYSTEMS": "IS",
        "SOCIAL WORK": "SW",
        "PSYCHOLOGY": "P",
        "NURSING": "N",
        "ACCOUNTANCY": "A",
        "ACCOUNTING": "A",
        "MANAGEMENT": "M",
        "BUSINESS ADMINISTRATION": "BA",
        "ENGINEERING": "E",
        "MATHEMATICS": "MATH",
        "BIOLOGY": "BIO",
        "CHEMISTRY": "CHEM",
        "PHYSICS": "PHYS",
        "EDUCATION": "ED",
        "ENGLISH": "ENG",
        "COMMUNICATION": "COM",
        "POLITICAL SCIENCE": "PS",
        "ECONOMICS": "ECON",
        "ANTHROPOLOGY": "ANTH",
        "SOCIOLOGY": "SOC",
        "PHILOSOPHY": "PHIL",
    }
    
    field_code = ""
    for field, abbrev in field_abbrevs.items():
        if field in name:
            field_code = abbrev
            break
    
    # If no specific field found, use first letters of significant words
    if not field_code:
        words = [w for w in name.split() if w not in 
                 ["BACHELOR", "MASTER", "DOCTOR", "OF", "IN", "THE", "AND", "A", "AN",
                  "SCIENCE", "ARTS", "B.S.", "B.A.", "BS", "BA"]]
        if words:
            field_code = "".join(w[0] for w in words[:3])
    
    return deg_prefix + field_code


def transform_to_aisis_schema(raw_rows):
    """
    Transform raw parsed curriculum data to AISIS-style schema.
    
    Takes the list of dicts produced by parse_curriculum_pdf with keys:
        program, year, semester, code, title, units
    
    Returns a pandas DataFrame with columns:
        deg_code, program_label, program_title, year_level, semester,
        course_code, course_title, units, prerequisites, category, university_code
    
    Args:
        raw_rows: List of dictionaries from parse_curriculum_pdf
        
    Returns:
        pandas DataFrame with AISIS-style schema
    """
    if not raw_rows:
        return pd.DataFrame(columns=[
            "deg_code", "program_label", "program_title", "year_level",
            "semester", "course_code", "course_title", "units",
            "prerequisites", "category", "university_code"
        ])
    
    transformed = []
    
    for row in raw_rows:
        program = row.get("program", "")
        
        transformed.append({
            "deg_code": extract_deg_code(program),
            "program_label": program,  # Full program name as label
            "program_title": program,  # Full program name as title
            "year_level": row.get("year", 1),
            "semester": row.get("semester", ""),
            "course_code": row.get("code", ""),
            "course_title": row.get("title", ""),
            "units": row.get("units", 0),
            "prerequisites": "",  # Placeholder - not available from PDF
            "category": "",  # Placeholder - not available from PDF
            "university_code": UNIVERSITY_CODE
        })
    
    # Create DataFrame with columns in specified order
    df = pd.DataFrame(transformed)
    
    # Ensure column order
    column_order = [
        "deg_code", "program_label", "program_title", "year_level",
        "semester", "course_code", "course_title", "units",
        "prerequisites", "category", "university_code"
    ]
    
    return df[column_order]
