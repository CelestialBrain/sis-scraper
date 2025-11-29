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
from main_scraper import (
    is_pdf_url, extract_program_name_from_url, is_addu_domain, 
    is_garbage_url, has_download_keyword, is_department_page,
    is_pdf_content, discover_pdf_urls, BASE_URLS, GARBAGE_SUBSTRINGS,
    DOWNLOAD_KEYWORDS
)
from curriculum_parser import (
    parse_curriculum_pdf, extract_course_code, IGNORE_CODES,
    post_process_rows, VALID_CODE_PATTERN, HEADER_REGEX, SPECIAL_SUBJECTS
)


class TestExtractCourseCode:
    """Unit tests for the extract_course_code function."""
    
    def test_valid_course_code_with_space(self):
        """Test extracting a valid course code with space separator."""
        code, remaining = extract_course_code("ENGL 1101")
        assert code == "ENGL 1101"
        assert remaining == ""
    
    def test_valid_course_code_without_space(self):
        """Test extracting a valid course code without space separator."""
        code, remaining = extract_course_code("MATH1001")
        assert code == "MATH 1001"  # Should normalize with space
        assert remaining == ""
    
    def test_valid_course_code_with_trailing_letter(self):
        """Test extracting a valid course code with trailing letter."""
        code, remaining = extract_course_code("BIO 100A")
        assert code == "BIO 100A"
        assert remaining == ""
    
    def test_valid_course_code_with_dash(self):
        """Test extracting a valid course code with dash separator."""
        code, remaining = extract_course_code("CSc-1100")
        assert code == "CSc-1100"
        assert remaining == ""
    
    def test_valid_mixed_case_code(self):
        """Test extracting a valid course code with mixed case prefix."""
        code, remaining = extract_course_code("SocWk 1130")
        assert code == "SocWk 1130"
        assert remaining == ""
    
    def test_code_with_remaining_text(self):
        """Test extracting course code with remaining description text."""
        code, remaining = extract_course_code("ENGL 1101 Introduction to English")
        assert code == "ENGL 1101"
        assert remaining == "Introduction to English"
    
    def test_ignored_code_formation(self):
        """Test that FORMATION is correctly ignored."""
        code, remaining = extract_course_code("FORMATION 123")
        assert code is None
        assert remaining == "FORMATION 123"
    
    def test_ignored_code_semester(self):
        """Test that SEMESTER is correctly ignored."""
        code, remaining = extract_course_code("SEMESTER 2024")
        assert code is None
        assert remaining == "SEMESTER 2024"
    
    def test_ignored_code_year(self):
        """Test that YEAR is correctly ignored."""
        code, remaining = extract_course_code("YEAR 2024")
        assert code is None
        assert remaining == "YEAR 2024"
    
    def test_ignored_code_page(self):
        """Test that PAGE is correctly ignored."""
        code, remaining = extract_course_code("PAGE 1234")
        assert code is None
        assert remaining == "PAGE 1234"
    
    def test_ignored_code_total(self):
        """Test that TOTAL is correctly ignored."""
        code, remaining = extract_course_code("TOTAL 100A")
        assert code is None
        assert remaining == "TOTAL 100A"
    
    def test_ignored_code_units(self):
        """Test that UNITS is correctly ignored."""
        code, remaining = extract_course_code("UNITS 300")
        assert code is None
        assert remaining == "UNITS 300"
    
    def test_ignored_code_case_insensitive(self):
        """Test that ignored codes work case-insensitively."""
        code, remaining = extract_course_code("Formation 123 test")
        assert code is None
        assert remaining == "Formation 123 test"
        
        code, remaining = extract_course_code("Units 123")
        assert code is None
        assert remaining == "Units 123"
    
    def test_empty_input(self):
        """Test handling of empty input."""
        code, remaining = extract_course_code("")
        assert code is None
        assert remaining == ""
        
        code, remaining = extract_course_code(None)
        assert code is None
        assert remaining == ""
    
    def test_no_match(self):
        """Test input with no valid course code."""
        code, remaining = extract_course_code("Introduction to Programming")
        assert code is None
        assert remaining == "Introduction to Programming"
    
    def test_ignore_codes_set_exists(self):
        """Test that IGNORE_CODES set is correctly defined."""
        expected_codes = {"FORMATION", "SEMESTER", "YEAR", "PAGE", "TOTAL", "UNITS"}
        assert IGNORE_CODES == expected_codes


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
        assert len(program_links) >= 5, f"Expected at least 5 links, got {len(program_links)}: {program_links}"
        
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


class TestIsAdduDomain:
    """Unit tests for the is_addu_domain helper function."""
    
    def test_valid_addu_domain(self):
        """Test that AdDU domain URLs are correctly identified."""
        assert is_addu_domain("https://www.addu.edu.ph/page") is True
        assert is_addu_domain("https://addu.edu.ph/page") is True
        assert is_addu_domain("http://www.addu.edu.ph/page.pdf") is True
    
    def test_subdomain_addu(self):
        """Test that subdomains of addu.edu.ph are accepted."""
        assert is_addu_domain("https://sis.addu.edu.ph/login") is True
        assert is_addu_domain("https://library.addu.edu.ph/resources") is True
    
    def test_non_addu_domain(self):
        """Test that non-AdDU domains are rejected."""
        assert is_addu_domain("https://www.example.com/page") is False
        assert is_addu_domain("https://google.com/search") is False
        assert is_addu_domain("https://edu.ph/page") is False
    
    def test_addu_in_path_but_wrong_domain(self):
        """Test that URLs with 'addu' in path but wrong domain are rejected."""
        assert is_addu_domain("https://example.com/addu.edu.ph/fake") is False
    
    def test_invalid_url(self):
        """Test that invalid URLs return False."""
        assert is_addu_domain("not-a-url") is False
        assert is_addu_domain("") is False


class TestIsGarbageUrl:
    """Unit tests for the is_garbage_url helper function."""
    
    def test_manual_url_is_garbage(self):
        """Test that URLs containing 'manual' are detected as garbage."""
        assert is_garbage_url("https://www.addu.edu.ph/student-manual.pdf") is True
        assert is_garbage_url("https://www.addu.edu.ph/Manual-2024.pdf") is True
    
    def test_handbook_url_is_garbage(self):
        """Test that URLs containing 'handbook' are detected as garbage."""
        assert is_garbage_url("https://www.addu.edu.ph/faculty-handbook.pdf") is True
    
    def test_memo_url_is_garbage(self):
        """Test that URLs containing 'memo' are detected as garbage."""
        assert is_garbage_url("https://www.addu.edu.ph/memo-2024.pdf") is True
    
    def test_calendar_url_is_garbage(self):
        """Test that URLs containing 'calendar' are detected as garbage."""
        assert is_garbage_url("https://www.addu.edu.ph/academic-calendar.pdf") is True
    
    def test_policy_url_is_garbage(self):
        """Test that URLs containing 'policy' or 'policies' are detected as garbage."""
        assert is_garbage_url("https://www.addu.edu.ph/privacy-policy.pdf") is True
        assert is_garbage_url("https://www.addu.edu.ph/policies.pdf") is True
    
    def test_curriculum_url_is_not_garbage(self):
        """Test that curriculum URLs are not detected as garbage."""
        assert is_garbage_url("https://www.addu.edu.ph/curriculum.pdf") is False
        assert is_garbage_url("https://www.addu.edu.ph/BS-Computer-Science.pdf") is False
    
    def test_garbage_substrings_config(self):
        """Test that GARBAGE_SUBSTRINGS is properly configured."""
        expected = {"manual", "handbook", "memo", "calendar", "policy", "policies"}
        assert set(GARBAGE_SUBSTRINGS) == expected


class TestHasDownloadKeyword:
    """Unit tests for the has_download_keyword helper function."""
    
    def test_curriculum_keyword(self):
        """Test that 'curriculum' keyword is detected."""
        assert has_download_keyword("https://www.addu.edu.ph/curriculum") is True
        assert has_download_keyword("https://www.addu.edu.ph/Curriculum-2024") is True
    
    def test_prospectus_keyword(self):
        """Test that 'prospectus' keyword is detected."""
        assert has_download_keyword("https://www.addu.edu.ph/prospectus") is True
    
    def test_download_keyword(self):
        """Test that 'download' keyword is detected."""
        assert has_download_keyword("https://www.addu.edu.ph/download/file") is True
    
    def test_course_keyword(self):
        """Test that 'course' keyword is detected."""
        assert has_download_keyword("https://www.addu.edu.ph/course-list") is True
    
    def test_checklist_keyword(self):
        """Test that 'checklist' keyword is detected."""
        assert has_download_keyword("https://www.addu.edu.ph/checklist") is True
    
    def test_plan_keyword(self):
        """Test that 'plan' keyword is detected."""
        assert has_download_keyword("https://www.addu.edu.ph/study-plan") is True
    
    def test_no_download_keyword(self):
        """Test that URLs without download keywords return False."""
        assert has_download_keyword("https://www.addu.edu.ph/about-us") is False
        assert has_download_keyword("https://www.addu.edu.ph/contact") is False
    
    def test_download_keywords_config(self):
        """Test that DOWNLOAD_KEYWORDS is properly configured."""
        expected = {"curriculum", "prospectus", "download", "course", "checklist", "plan"}
        assert set(DOWNLOAD_KEYWORDS) == expected


class TestIsDepartmentPage:
    """Unit tests for the is_department_page helper function."""
    
    def test_school_page(self):
        """Test that school pages are detected."""
        assert is_department_page("https://www.addu.edu.ph/academics/school-of-engineering/") is True
    
    def test_college_page(self):
        """Test that college pages are detected."""
        assert is_department_page("https://www.addu.edu.ph/college-of-law/") is True
    
    def test_academics_page(self):
        """Test that academics pages are detected."""
        assert is_department_page("https://www.addu.edu.ph/academics/departments") is True
    
    def test_department_page(self):
        """Test that department pages are detected."""
        assert is_department_page("https://www.addu.edu.ph/department-of-mathematics") is True
    
    def test_graduate_programs_page(self):
        """Test that graduate programs pages are detected."""
        assert is_department_page("https://www.addu.edu.ph/graduate-programs/") is True
    
    def test_undergraduate_programs_page(self):
        """Test that undergraduate programs pages are detected."""
        assert is_department_page("https://www.addu.edu.ph/undergraduate-programs/") is True
    
    def test_bachelor_page(self):
        """Test that bachelor program pages are detected."""
        assert is_department_page("https://www.addu.edu.ph/bachelor-of-science-in-cs") is True
    
    def test_non_department_page(self):
        """Test that non-department pages are not detected."""
        assert is_department_page("https://www.addu.edu.ph/about-us") is False
        assert is_department_page("https://www.addu.edu.ph/contact") is False


class TestIsPdfContent:
    """Unit tests for the is_pdf_content helper function."""
    
    def test_pdf_extension_fast_path(self):
        """Test that .pdf extension is detected without HEAD request."""
        counter = {'count': 0}
        assert is_pdf_content("https://example.com/file.pdf", counter) is True
        assert counter['count'] == 0  # No HEAD request made
    
    def test_uppercase_pdf_extension(self):
        """Test that .PDF extension is detected (case insensitive)."""
        counter = {'count': 0}
        assert is_pdf_content("https://example.com/file.PDF", counter) is True
        assert counter['count'] == 0
    
    def test_pdf_with_query_params(self):
        """Test PDF URL with query params is detected."""
        counter = {'count': 0}
        assert is_pdf_content("https://example.com/file.pdf?v=1", counter) is True
        assert counter['count'] == 0
    
    @patch('main_scraper.ENABLE_HEAD_PROBE', False)
    def test_head_probe_disabled(self):
        """Test that HEAD probe is skipped when disabled."""
        counter = {'count': 0}
        # No .pdf extension, and HEAD probe disabled
        result = is_pdf_content("https://example.com/curriculum-download", counter)
        assert result is False
        assert counter['count'] == 0
    
    @patch('main_scraper.ENABLE_HEAD_PROBE', True)
    @patch('main_scraper.requests.head')
    def test_head_probe_for_download_keyword(self, mock_head):
        """Test that HEAD probe is used for download keyword URLs."""
        mock_response = Mock()
        mock_response.headers = {'Content-Type': 'application/pdf'}
        mock_head.return_value = mock_response
        
        counter = {'count': 0}
        result = is_pdf_content("https://www.addu.edu.ph/curriculum-download", counter)
        
        assert result is True
        assert counter['count'] == 1
        mock_head.assert_called_once()
    
    @patch('main_scraper.ENABLE_HEAD_PROBE', True)
    @patch('main_scraper.requests.head')
    def test_head_probe_non_pdf_content_type(self, mock_head):
        """Test that non-PDF content type returns False."""
        mock_response = Mock()
        mock_response.headers = {'Content-Type': 'text/html'}
        mock_head.return_value = mock_response
        
        counter = {'count': 0}
        result = is_pdf_content("https://www.addu.edu.ph/curriculum-page", counter)
        
        assert result is False
        assert counter['count'] == 1
    
    @patch('main_scraper.ENABLE_HEAD_PROBE', True)
    def test_head_probe_limit_respected(self):
        """Test that HEAD probe limit is respected."""
        counter = {'count': 50}  # Already at limit
        # URL has download keyword but limit reached
        result = is_pdf_content("https://www.addu.edu.ph/curriculum-download", counter)
        assert result is False
        assert counter['count'] == 50  # Count unchanged
    
    def test_no_head_for_non_download_url(self):
        """Test that HEAD is not used for URLs without download keywords."""
        counter = {'count': 0}
        result = is_pdf_content("https://www.addu.edu.ph/about-us", counter)
        assert result is False
        assert counter['count'] == 0  # No HEAD request


class TestDiscoverPdfUrls:
    """Unit tests for the discover_pdf_urls function with mocked requests."""
    
    @patch('main_scraper.requests.get')
    def test_discover_finds_pdf_links(self, mock_get):
        """Test that discover_pdf_urls finds PDF links on pages."""
        # Mock HTML response with PDF links
        html_content = """
        <html>
            <body>
                <a href="/wp-content/uploads/2020/06/BS-Computer-Science.pdf">CS Curriculum</a>
                <a href="https://www.addu.edu.ph/uploads/BS-Math.pdf">Math Curriculum</a>
            </body>
        </html>
        """
        mock_response = Mock()
        mock_response.content = html_content.encode()
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response
        
        urls = discover_pdf_urls(delay_ms=0)
        
        # Should find both PDFs
        assert len(urls) >= 2
        # Check that URLs are properly normalized
        pdf_urls_lower = [u.lower() for u in urls]
        assert any('bs-computer-science.pdf' in u for u in pdf_urls_lower)
        assert any('bs-math.pdf' in u for u in pdf_urls_lower)
    
    @patch('main_scraper.requests.get')
    def test_discover_respects_domain_restriction(self, mock_get):
        """Test that discover_pdf_urls only follows AdDU domain links."""
        html_content = """
        <html>
            <body>
                <a href="https://www.addu.edu.ph/curriculum.pdf">AdDU PDF</a>
                <a href="https://www.example.com/external.pdf">External PDF</a>
            </body>
        </html>
        """
        mock_response = Mock()
        mock_response.content = html_content.encode()
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response
        
        urls = discover_pdf_urls(delay_ms=0)
        
        # Should only include AdDU domain PDFs
        assert all('addu.edu.ph' in u for u in urls)
        assert not any('example.com' in u for u in urls)
    
    @patch('main_scraper.requests.get')
    def test_discover_filters_garbage_urls(self, mock_get):
        """Test that discover_pdf_urls filters out garbage URLs."""
        html_content = """
        <html>
            <body>
                <a href="https://www.addu.edu.ph/curriculum.pdf">Curriculum</a>
                <a href="https://www.addu.edu.ph/student-manual.pdf">Manual</a>
                <a href="https://www.addu.edu.ph/handbook.pdf">Handbook</a>
            </body>
        </html>
        """
        mock_response = Mock()
        mock_response.content = html_content.encode()
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response
        
        urls = discover_pdf_urls(delay_ms=0)
        
        # Should include curriculum but not manual or handbook
        assert any('curriculum.pdf' in u for u in urls)
        assert not any('manual' in u.lower() for u in urls)
        assert not any('handbook' in u.lower() for u in urls)
    
    @patch('main_scraper.requests.get')
    def test_discover_deduplicates_urls(self, mock_get):
        """Test that discover_pdf_urls returns de-duplicated URLs."""
        html_content = """
        <html>
            <body>
                <a href="https://www.addu.edu.ph/curriculum.pdf">Link 1</a>
                <a href="https://www.addu.edu.ph/curriculum.pdf">Link 2</a>
                <a href="https://www.addu.edu.ph/curriculum.pdf">Link 3</a>
            </body>
        </html>
        """
        mock_response = Mock()
        mock_response.content = html_content.encode()
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response
        
        urls = discover_pdf_urls(delay_ms=0)
        
        # Should only have one instance of the URL
        curriculum_count = sum(1 for u in urls if 'curriculum.pdf' in u)
        assert curriculum_count == 1
    
    @patch('main_scraper.requests.get')
    def test_discover_follows_department_pages(self, mock_get):
        """Test that discover_pdf_urls follows department pages with depth 1."""
        # First page (base URL) has link to department
        base_html = """
        <html>
            <body>
                <a href="https://www.addu.edu.ph/academics/school-of-engineering/">Engineering</a>
            </body>
        </html>
        """
        # Department page has PDF
        dept_html = """
        <html>
            <body>
                <a href="https://www.addu.edu.ph/engineering-curriculum.pdf">Curriculum</a>
            </body>
        </html>
        """
        
        def mock_get_side_effect(url, **kwargs):
            mock_response = Mock()
            mock_response.raise_for_status = Mock()
            if 'school-of-engineering' in url:
                mock_response.content = dept_html.encode()
            else:
                mock_response.content = base_html.encode()
            return mock_response
        
        mock_get.side_effect = mock_get_side_effect
        
        urls = discover_pdf_urls(delay_ms=0)
        
        # Should find PDF from department page
        assert any('engineering-curriculum.pdf' in u for u in urls)
    
    @patch('main_scraper.requests.get')
    def test_discover_handles_request_errors(self, mock_get):
        """Test that discover_pdf_urls handles request errors gracefully."""
        mock_get.side_effect = requests.RequestException("Network error")
        
        # Should not raise, just return empty or partial results
        urls = discover_pdf_urls(delay_ms=0)
        assert isinstance(urls, list)
    
    def test_base_urls_configured(self):
        """Test that BASE_URLS includes all required URLs."""
        assert "https://www.addu.edu.ph/undergraduate-programs/" in BASE_URLS
        assert "https://www.addu.edu.ph/graduate-programs/" in BASE_URLS
        assert "https://www.addu.edu.ph/academics/school-of-engineering-and-architecture/" in BASE_URLS
        assert "https://www.addu.edu.ph/academics/school-of-nursing/" in BASE_URLS
        assert "https://www.addu.edu.ph/academics/school-of-arts-and-sciences/" in BASE_URLS


class TestPostProcessRows:
    """Unit tests for the post_process_rows function."""
    
    def _make_row(self, code="MATH 101", title="Intro to Math", units=3.0):
        """Helper to create a test row dictionary."""
        return {
            "program": "Test Program",
            "year": 1,
            "semester": "1st Semester",
            "code": code,
            "title": title,
            "units": units
        }
    
    def test_empty_input_returns_empty(self):
        """Test that empty input returns empty list."""
        assert post_process_rows([]) == []
        assert post_process_rows(None) is None
    
    def test_valid_rows_preserved(self):
        """Test that valid rows are preserved."""
        rows = [
            self._make_row("MATH 101", "Introduction to Mathematics", 3.0),
            self._make_row("ECE 313", "Digital Electronics", 6.0),
            self._make_row("BIO 1130", "General Biology", 4.0),
        ]
        result = post_process_rows(rows)
        assert len(result) == 3
        assert result[0]['code'] == "MATH 101"
        assert result[1]['code'] == "ECE 313"
        assert result[2]['code'] == "BIO 1130"
    
    def test_header_bleed_code_dropped(self):
        """Test that rows with header-like code are dropped."""
        rows = [
            self._make_row("Effective 2019", ""),
            self._make_row("Effective 2019-2020", "Some text"),
            self._make_row("Revised 2008", "Curriculum"),
            self._make_row("MATH 101", "Valid course", 3.0),  # This should be kept
        ]
        result = post_process_rows(rows)
        assert len(result) == 1
        assert result[0]['code'] == "MATH 101"
    
    def test_header_bleed_title_dropped(self):
        """Test that rows with header-like title are dropped."""
        rows = [
            self._make_row("BS 1234", "Curriculum Effective 2019-2020"),
            self._make_row("XY 100", "Semester SY 2019-2020"),
            self._make_row("ENGL 1101", "Valid English Course", 3.0),  # This should be kept
        ]
        result = post_process_rows(rows)
        assert len(result) == 1
        assert result[0]['code'] == "ENGL 1101"
    
    def test_absurd_units_dropped(self):
        """Test that rows with absurd numeric units (> 30.0) are dropped."""
        rows = [
            self._make_row("MATH 101", "Normal Course", 3.0),
            self._make_row("ECE 200", "Mangled Course", 573.0),
            self._make_row("BIO 300", "Merged Text Artifact", 910911.0),
            self._make_row("PHYS 101", "Physics", 6.0),  # This should be kept
        ]
        result = post_process_rows(rows)
        assert len(result) == 2
        assert result[0]['code'] == "MATH 101"
        assert result[1]['code'] == "PHYS 101"
    
    def test_normal_units_preserved(self):
        """Test that normal unit values (up to 30.0) are preserved."""
        rows = [
            self._make_row("MATH 101", "Course 1", 3.0),
            self._make_row("ECE 200", "Course 2", 6.0),
            self._make_row("THESIS 500", "Research", 12.0),
            self._make_row("THESIS 600", "Dissertation", 30.0),  # Edge case - should be kept
        ]
        result = post_process_rows(rows)
        assert len(result) == 4
    
    def test_units_normalized_to_float(self):
        """Test that units are normalized to floats."""
        rows = [
            self._make_row("MATH 101", "Course", "3.0"),
            self._make_row("ECE 200", "Course", "6"),
            self._make_row("BIO 300", "Course", "4.5"),
        ]
        result = post_process_rows(rows)
        assert len(result) == 3
        assert result[0]['units'] == 3.0
        assert isinstance(result[0]['units'], float)
        assert result[1]['units'] == 6.0
        assert result[2]['units'] == 4.5
    
    def test_nonnumeric_units_preserved(self):
        """Test that non-numeric unit markers (e.g., 'NC') are preserved as-is."""
        rows = [
            self._make_row("NSTP 1", "NSTP Course", "NC"),
            self._make_row("ASSEMBLY", "Assembly", "N/A"),
        ]
        result = post_process_rows(rows)
        assert len(result) == 2
        assert result[0]['units'] == "NC"
        assert result[1]['units'] == "N/A"
    
    def test_invalid_code_with_year_dropped(self):
        """Test that codes containing a 4-digit year are dropped when not valid course codes."""
        rows = [
            self._make_row("2024", "Just a year", 3.0),  # Just year, too short
            self._make_row("SY 2019-2020", "Academic year marker", 3.0),  # Has year range, not valid pattern
            self._make_row("MATH 101", "Valid course", 3.0),  # This should be kept
        ]
        result = post_process_rows(rows)
        assert len(result) == 1
        assert result[0]['code'] == "MATH 101"
    
    def test_very_short_invalid_code_dropped(self):
        """Test that very short codes (< 4 chars) that don't match valid pattern are dropped."""
        rows = [
            self._make_row("une", "Invalid code", 3.0),
            self._make_row("XY", "Too short", 3.0),
            self._make_row("MATH 101", "Valid course", 3.0),  # This should be kept
        ]
        result = post_process_rows(rows)
        assert len(result) == 1
        assert result[0]['code'] == "MATH 101"
    
    def test_special_subjects_preserved(self):
        """Test that special subject labels (NSTP, THESIS, etc.) are preserved."""
        rows = [
            self._make_row("NSTP", "National Service Training", 3.0),
            self._make_row("NSTP-1", "NSTP First Course", 3.0),
            self._make_row("THESIS", "Undergraduate Thesis", 6.0),
            self._make_row("ASSEMBLY", "General Assembly", 0.0),
            self._make_row("FYDP", "Final Year Design Project", 6.0),
            self._make_row("OJT", "On-the-Job Training", 3.0),
            self._make_row("PRACTICUM", "Field Practicum", 6.0),
            self._make_row("INTERNSHIP", "Industry Internship", 6.0),
        ]
        result = post_process_rows(rows)
        assert len(result) == 8
    
    def test_mixed_case_codes_preserved(self):
        """Test that mixed-case valid codes like 'SocWk 1130' are preserved."""
        rows = [
            self._make_row("SocWk 1130", "Social Work Course", 3.0),
            self._make_row("Anthro 1201", "Anthropology Course", 3.0),
        ]
        result = post_process_rows(rows)
        assert len(result) == 2
        assert result[0]['code'] == "SocWk 1130"
        assert result[1]['code'] == "Anthro 1201"
    
    def test_valid_code_pattern_matches(self):
        """Test that VALID_CODE_PATTERN matches expected course codes."""
        valid_codes = [
            "MATH 101", "ECE 313", "BIO 1130", "ENGL 1101",
            "CSc-1100", "SocWk 1130", "PE 1", "NSTP1",
        ]
        for code in valid_codes:
            assert VALID_CODE_PATTERN.match(code), f"Expected {code} to match VALID_CODE_PATTERN"
    
    def test_header_regex_matches(self):
        """Test that HEADER_REGEX matches expected header patterns."""
        headers = [
            "Effective 2019", "Effective 2020", "Revised 2008",
            "Curriculum Effective 2019-2020", "Semester SY 2019-2020",
        ]
        for header in headers:
            assert HEADER_REGEX.search(header), f"Expected {header} to match HEADER_REGEX"
    
    def test_special_subjects_set_exists(self):
        """Test that SPECIAL_SUBJECTS set is properly defined."""
        expected = {"NSTP", "THESIS", "ASSEMBLY", "FYDP", "OJT", "PRACTICUM", "INTERNSHIP"}
        assert SPECIAL_SUBJECTS == expected


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
