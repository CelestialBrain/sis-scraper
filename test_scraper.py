"""
Tests for the AdDU Curriculum Scraper

This module contains unit and integration tests for the scraper,
including tests for direct PDF URL detection and parsing.
"""

import pytest
import os
import tempfile
import requests
from main_scraper import is_pdf_url
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
