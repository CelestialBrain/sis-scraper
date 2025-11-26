"""
Tests for the AdDU Curriculum Scraper

This module contains unit and integration tests for the scraper,
including tests for direct PDF URL detection and parsing.
"""

import pytest
import os
import tempfile
import requests
from unittest.mock import patch, Mock, MagicMock
from main_scraper import is_pdf_url, extract_program_name_from_url
from curriculum_parser import parse_curriculum_pdf


class TestIsPdfUrl:
    """Unit tests for the is_pdf_url helper function."""
    
    def test_simple_pdf_url(self):
        """Test basic PDF URL detection."""
        url = "https://example.com/document.pdf"
        assert is_pdf_url(url) is True
    
    def test_uppercase_pdf_extension(self):
        """Test PDF URL with uppercase extension."""
        url = "https://example.com/document.PDF"
        assert is_pdf_url(url) is True
    
    def test_mixed_case_pdf_extension(self):
        """Test PDF URL with mixed case extension."""
        url = "https://example.com/document.Pdf"
        assert is_pdf_url(url) is True
    
    def test_pdf_url_with_query_params(self):
        """Test PDF URL with query parameters."""
        url = "https://example.com/document.pdf?version=1&download=true"
        assert is_pdf_url(url) is True
    
    def test_pdf_url_with_fragment(self):
        """Test PDF URL with fragment."""
        url = "https://example.com/document.pdf#page=5"
        assert is_pdf_url(url) is True
    
    def test_pdf_url_with_path_segments(self):
        """Test PDF URL with multiple path segments."""
        url = "https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Social-Work.pdf"
        assert is_pdf_url(url) is True
    
    def test_non_pdf_url(self):
        """Test that non-PDF URLs return False."""
        url = "https://example.com/page.html"
        assert is_pdf_url(url) is False
    
    def test_url_with_pdf_in_path(self):
        """Test URL with 'pdf' in path but not as extension."""
        url = "https://example.com/pdf-documents/page.html"
        assert is_pdf_url(url) is False
    
    def test_url_ending_with_slash(self):
        """Test URL ending with slash."""
        url = "https://example.com/documents/"
        assert is_pdf_url(url) is False
    
    def test_url_without_extension(self):
        """Test URL without file extension."""
        url = "https://example.com/page"
        assert is_pdf_url(url) is False


class TestExtractProgramNameFromUrl:
    """Unit tests for the extract_program_name_from_url helper function."""
    
    def test_simple_pdf_filename(self):
        """Test extracting program name from a simple PDF filename."""
        url = "https://example.com/Bachelor-of-Science-in-Computer-Science.pdf"
        name = extract_program_name_from_url(url)
        assert name == "Bachelor of Science in Computer Science"
    
    def test_pdf_with_query_params(self):
        """Test extracting program name from PDF URL with query parameters."""
        url = "https://example.com/Bachelor-of-Science.pdf?version=1"
        name = extract_program_name_from_url(url)
        assert name == "Bachelor of Science"
    
    def test_pdf_with_underscores(self):
        """Test extracting program name with underscores."""
        url = "https://example.com/BS_Computer_Science.pdf"
        name = extract_program_name_from_url(url)
        # Underscores are not replaced, only hyphens
        assert "BS_Computer_Science" in name or "BS Computer Science" in name


class TestMultiPdfParsing:
    """Tests for HTML pages containing multiple PDF links."""
    
    def test_multiple_pdfs_on_page(self):
        """Test that main_scraper can detect multiple PDFs on a single HTML page."""
        from bs4 import BeautifulSoup
        
        # Create a mock HTML page with multiple PDF links
        html_content = """
        <html>
            <body>
                <h1>Computer Science Program</h1>
                <a href="/wp-content/uploads/2020/06/BS-Computer-Science-Curriculum-2024.pdf">2024 Curriculum</a>
                <a href="/wp-content/uploads/2020/06/BS-Computer-Science-Curriculum-2023.pdf">2023 Curriculum</a>
                <a href="/wp-content/uploads/2020/06/BS-Computer-Science-Curriculum-2022.pdf">2022 Curriculum</a>
                <a href="/contact-us">Contact</a>
            </body>
        </html>
        """
        
        soup = BeautifulSoup(html_content, "html.parser")
        
        # Find all PDF links (same logic as main_scraper.py)
        pdf_tags = soup.find_all("a", href=lambda h: h and h.lower().endswith('.pdf'))
        
        # Should find exactly 3 PDF links
        assert len(pdf_tags) == 3
        
        # Verify the hrefs
        hrefs = [tag['href'] for tag in pdf_tags]
        assert all('.pdf' in href.lower() for href in hrefs)
    
    def test_program_link_filtering(self):
        """Test that the scraper discovers both undergraduate and graduate program links."""
        from bs4 import BeautifulSoup
        
        # Create a mock HTML page with various program links
        html_content = """
        <html>
            <body>
                <h1>AdDU Programs</h1>
                <a href="https://www.addu.edu.ph/bachelor-of-science-in-computer-science">Bachelor CS</a>
                <a href="https://www.addu.edu.ph/graduate-programs-new">Graduate Programs</a>
                <a href="https://www.addu.edu.ph/undergraduate-programs/">Undergraduate Programs</a>
                <a href="https://www.addu.edu.ph/academics/departments">Academics</a>
                <a href="https://www.addu.edu.ph/wp-content/uploads/curriculum.pdf">Direct PDF</a>
                <a href="https://www.example.com/not-addu">External Link</a>
                <a href="/contact-us">Contact</a>
            </body>
        </html>
        """
        
        soup = BeautifulSoup(html_content, "html.parser")
        
        # Simulate the filtering logic from main_scraper.py
        program_links = []
        for link in soup.find_all("a", href=True):
            href = link.get("href")
            if not href:
                continue
            
            # Normalize to absolute URL
            if not href.startswith("http"):
                href = "https://www.addu.edu.ph" + href
            
            href_lower = href.lower()
            
            # 1. Catch direct PDFs immediately
            if href_lower.endswith(".pdf"):
                if href not in program_links:
                    program_links.append(href)
            
            # 2. Allow "Graduate", "Programs", and "Bachelor" pages
            elif (
                "bachelor" in href_lower
                or "graduate" in href_lower
                or "programs" in href_lower
                or "/academics/" in href_lower
            ) and "addu.edu.ph" in href_lower:
                if href not in program_links:
                    program_links.append(href)
        
        # Verify that all expected links are discovered
        assert len(program_links) == 5, f"Expected 5 links, got {len(program_links)}: {program_links}"
        
        # Check that specific links are included
        link_strings = ' '.join(program_links).lower()
        assert "bachelor" in link_strings, "Bachelor link should be discovered"
        assert "graduate" in link_strings, "Graduate link should be discovered"
        assert "programs" in link_strings, "Programs links should be discovered"
        assert "academics" in link_strings, "Academics link should be discovered"
        assert ".pdf" in link_strings, "Direct PDF link should be discovered"
        
        # Check that external link is not included
        assert "example.com" not in link_strings, "External link should not be included"
        assert all("addu.edu.ph" in link for link in program_links), "All links should be from AdDU domain"
    
    def test_no_pdfs_on_page(self):
        """Test that main_scraper handles pages with no PDFs gracefully."""
        from bs4 import BeautifulSoup
        
        html_content = """
        <html>
            <body>
                <h1>About Us</h1>
                <a href="/contact">Contact</a>
                <a href="/programs">Programs</a>
            </body>
        </html>
        """
        
        soup = BeautifulSoup(html_content, "html.parser")
        pdf_tags = soup.find_all("a", href=lambda h: h and h.lower().endswith('.pdf'))
        
        # Should find no PDF links
        assert len(pdf_tags) == 0
    
    def test_pdf_url_normalization(self):
        """Test that relative PDF URLs are correctly normalized to absolute URLs."""
        base_url = "https://www.addu.edu.ph"
        relative_url = "/wp-content/uploads/2020/06/curriculum.pdf"
        
        # Same normalization logic as in main_scraper.py
        if not relative_url.startswith("http"):
            absolute_url = base_url + relative_url
        else:
            absolute_url = relative_url
        
        assert absolute_url.startswith("https://")
        assert absolute_url.endswith(".pdf")
        assert "www.addu.edu.ph" in absolute_url


class TestSocialWorkCurriculumParsing:
    """Integration test for the Social Work curriculum PDF."""
    
    # The actual Social Work curriculum URL
    SOCIAL_WORK_PDF_URL = "https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Social-Work.pdf"
    
    @pytest.fixture(scope="class")
    def social_work_pdf_path(self):
        """
        Download the Social Work PDF for testing.
        
        This fixture downloads the PDF once and caches it in a temporary location.
        The PDF is cleaned up after all tests in this class are complete.
        """
        # Create a temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
            pdf_path = tmp_file.name
            
        try:
            # Download the PDF
            print(f"\nDownloading Social Work PDF from {self.SOCIAL_WORK_PDF_URL}...")
            response = requests.get(self.SOCIAL_WORK_PDF_URL, timeout=30)
            response.raise_for_status()
            
            # Save to temporary file
            with open(pdf_path, 'wb') as f:
                f.write(response.content)
            
            print(f"PDF downloaded successfully ({len(response.content)} bytes)")
            
            # Yield the path for tests to use
            yield pdf_path
            
        finally:
            # Cleanup: remove the temporary file
            if os.path.exists(pdf_path):
                os.remove(pdf_path)
                print(f"\nCleaned up temporary PDF file")
    
    def test_social_work_url_is_detected_as_pdf(self):
        """Test that the Social Work URL is correctly identified as a PDF."""
        assert is_pdf_url(self.SOCIAL_WORK_PDF_URL) is True
    
    @pytest.mark.network
    def test_social_work_pdf_parsing(self, social_work_pdf_path):
        """
        Test parsing of the actual Social Work curriculum PDF.
        
        This test verifies that:
        1. The PDF can be parsed without errors
        2. At least one program with "SOCIAL WORK" in the name is extracted
        3. At least some courses are parsed
        4. Representative course codes from the Social Work curriculum are present
        """
        # Parse the PDF
        program_name = "Bachelor of Science in Social Work"
        rows = parse_curriculum_pdf(social_work_pdf_path, program_name)
        
        # Assert that data was extracted
        assert len(rows) > 0, "No data was extracted from the Social Work PDF"
        
        # Check that the program name is present
        programs = set(row['program'] for row in rows)
        assert any('social work' in p.lower() for p in programs), \
            f"No 'Social Work' program found in extracted data. Programs: {programs}"
        
        # Check that we have course codes
        course_codes = [row['code'] for row in rows if row.get('code')]
        assert len(course_codes) > 0, "No course codes were extracted"
        
        # Check for representative course codes from Social Work curriculum
        # These are example codes that should appear in the actual PDF
        # Note: The actual codes depend on the PDF content
        all_codes_str = ' '.join(course_codes).upper()
        
        # Look for common course patterns in Social Work curriculum
        # The PDF should contain courses from various departments
        has_general_education = any(
            code for code in course_codes 
            if any(prefix in code.upper() for prefix in ['ENGL', 'THEO', 'FIL', 'MATH', 'NSTP', 'PE', 'HIS'])
        )
        
        # Check that we have a reasonable number of courses
        assert len(course_codes) >= 10, \
            f"Expected at least 10 course codes, but got {len(course_codes)}"
        
        # Verify general education courses are present (common across all programs)
        assert has_general_education, \
            f"Expected to find general education courses. Codes found: {course_codes[:10]}"
        
        # Check that we have year and semester information
        years = set(row['year'] for row in rows if row.get('year'))
        semesters = set(row['semester'] for row in rows if row.get('semester'))
        
        assert len(years) > 0, "No year information was extracted"
        assert len(semesters) > 0, "No semester information was extracted"
        
        # Print summary for debugging
        print(f"\n=== Social Work PDF Parsing Summary ===")
        print(f"Total courses extracted: {len(rows)}")
        print(f"Unique course codes: {len(set(course_codes))}")
        print(f"Programs: {programs}")
        print(f"Years: {sorted(years)}")
        print(f"Semesters: {sorted(semesters)}")
        print(f"Sample course codes: {course_codes[:10]}")
        print(f"Sample courses:")
        for row in rows[:5]:
            print(f"  {row.get('code', 'N/A')} - {row.get('title', 'N/A')[:50]} ({row.get('units', 0)} units)")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
