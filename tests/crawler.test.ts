/**
 * Tests for crawler URL helpers — ported from test_scraper.py
 */

import { describe, it, expect } from 'vitest';
import {
  isPdfUrl,
  isAdduDomain,
  isGarbageUrl,
  hasDownloadKeyword,
  isDepartmentPage,
  extractProgramNameFromUrl,
} from '../src/crawler.js';

describe('isPdfUrl', () => {
  it('detects simple PDF URL', () => {
    expect(isPdfUrl('https://example.com/document.pdf')).toBe(true);
  });

  it('detects uppercase PDF extension', () => {
    expect(isPdfUrl('https://example.com/document.PDF')).toBe(true);
  });

  it('detects mixed case extension', () => {
    expect(isPdfUrl('https://example.com/document.Pdf')).toBe(true);
  });

  it('detects PDF with query params', () => {
    expect(isPdfUrl('https://example.com/document.pdf?version=1&download=true')).toBe(true);
  });

  it('detects PDF with fragment', () => {
    expect(isPdfUrl('https://example.com/document.pdf#page=5')).toBe(true);
  });

  it('detects real AdDU PDF URL', () => {
    expect(
      isPdfUrl(
        'https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Social-Work.pdf',
      ),
    ).toBe(true);
  });

  it('rejects non-PDF URLs', () => {
    expect(isPdfUrl('https://example.com/page.html')).toBe(false);
    expect(isPdfUrl('https://example.com/pdf-documents/page.html')).toBe(false);
    expect(isPdfUrl('https://example.com/documents/')).toBe(false);
    expect(isPdfUrl('https://example.com/page')).toBe(false);
  });
});

describe('isAdduDomain', () => {
  it('accepts AdDU URLs', () => {
    expect(isAdduDomain('https://www.addu.edu.ph/page')).toBe(true);
    expect(isAdduDomain('https://addu.edu.ph/page')).toBe(true);
    expect(isAdduDomain('http://www.addu.edu.ph/page.pdf')).toBe(true);
  });

  it('accepts subdomains', () => {
    expect(isAdduDomain('https://sis.addu.edu.ph/login')).toBe(true);
    expect(isAdduDomain('https://library.addu.edu.ph/resources')).toBe(true);
  });

  it('rejects non-AdDU domains', () => {
    expect(isAdduDomain('https://www.example.com/page')).toBe(false);
    expect(isAdduDomain('https://google.com/search')).toBe(false);
    expect(isAdduDomain('https://edu.ph/page')).toBe(false);
  });

  it('rejects addu in path but wrong domain', () => {
    expect(isAdduDomain('https://example.com/addu.edu.ph/fake')).toBe(false);
  });

  it('handles invalid URLs', () => {
    expect(isAdduDomain('not-a-url')).toBe(false);
    expect(isAdduDomain('')).toBe(false);
  });
});

describe('isGarbageUrl', () => {
  it('detects garbage URLs', () => {
    expect(isGarbageUrl('https://www.addu.edu.ph/student-manual.pdf')).toBe(true);
    expect(isGarbageUrl('https://www.addu.edu.ph/Manual-2024.pdf')).toBe(true);
    expect(isGarbageUrl('https://www.addu.edu.ph/faculty-handbook.pdf')).toBe(true);
    expect(isGarbageUrl('https://www.addu.edu.ph/memo-2024.pdf')).toBe(true);
    expect(isGarbageUrl('https://www.addu.edu.ph/academic-calendar.pdf')).toBe(true);
    expect(isGarbageUrl('https://www.addu.edu.ph/privacy-policy.pdf')).toBe(true);
    expect(isGarbageUrl('https://www.addu.edu.ph/policies.pdf')).toBe(true);
  });

  it('allows curriculum URLs', () => {
    expect(isGarbageUrl('https://www.addu.edu.ph/curriculum.pdf')).toBe(false);
    expect(isGarbageUrl('https://www.addu.edu.ph/BS-Computer-Science.pdf')).toBe(false);
  });
});

describe('hasDownloadKeyword', () => {
  it('detects download keywords', () => {
    expect(hasDownloadKeyword('https://www.addu.edu.ph/curriculum')).toBe(true);
    expect(hasDownloadKeyword('https://www.addu.edu.ph/prospectus')).toBe(true);
    expect(hasDownloadKeyword('https://www.addu.edu.ph/download/file')).toBe(true);
    expect(hasDownloadKeyword('https://www.addu.edu.ph/course-list')).toBe(true);
    expect(hasDownloadKeyword('https://www.addu.edu.ph/checklist')).toBe(true);
    expect(hasDownloadKeyword('https://www.addu.edu.ph/study-plan')).toBe(true);
  });

  it('rejects URLs without keywords', () => {
    expect(hasDownloadKeyword('https://www.addu.edu.ph/about-us')).toBe(false);
    expect(hasDownloadKeyword('https://www.addu.edu.ph/contact')).toBe(false);
  });
});

describe('isDepartmentPage', () => {
  it('detects department pages', () => {
    expect(isDepartmentPage('https://www.addu.edu.ph/academics/school-of-engineering/')).toBe(true);
    expect(isDepartmentPage('https://www.addu.edu.ph/college-of-law/')).toBe(true);
    expect(isDepartmentPage('https://www.addu.edu.ph/academics/departments')).toBe(true);
    expect(isDepartmentPage('https://www.addu.edu.ph/department-of-mathematics')).toBe(true);
    expect(isDepartmentPage('https://www.addu.edu.ph/graduate-programs/')).toBe(true);
    expect(isDepartmentPage('https://www.addu.edu.ph/undergraduate-programs/')).toBe(true);
    expect(isDepartmentPage('https://www.addu.edu.ph/bachelor-of-science-in-cs')).toBe(true);
  });

  it('rejects non-department pages', () => {
    expect(isDepartmentPage('https://www.addu.edu.ph/about-us')).toBe(false);
    expect(isDepartmentPage('https://www.addu.edu.ph/contact')).toBe(false);
  });
});

describe('extractProgramNameFromUrl', () => {
  it('extracts program name from PDF URL', () => {
    const name = extractProgramNameFromUrl(
      'https://example.com/Bachelor-of-Science-in-Computer-Science.pdf',
    );
    expect(name).toBe('Bachelor of Science in Computer Science');
  });
});
