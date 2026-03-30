/**
 * URL discovery crawler for AdDU curriculum PDFs
 *
 * Crawls base URLs with depth-1 recursion to discover curriculum PDFs
 * from undergraduate, graduate, and department pages.
 *
 * Ported from main_scraper.py discover_pdf_urls()
 */

import * as cheerio from 'cheerio';
import type { DiscoveredPdf } from './types.js';
import { logger } from './utils/logger.js';

// ────────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────────

const BASE_URLS = [
  'https://www.addu.edu.ph/undergraduate-programs/',
  'https://www.addu.edu.ph/graduate-programs/',
  'https://www.addu.edu.ph/academics/school-of-engineering-and-architecture/',
  'https://www.addu.edu.ph/academics/school-of-nursing/',
  'https://www.addu.edu.ph/academics/school-of-arts-and-sciences/',
  'https://www.addu.edu.ph/academics/school-of-business-and-governance/',
  'https://www.addu.edu.ph/academics/school-of-education/',
];

/**
 * Known curriculum PDF URLs on the AdDU website.
 *
 * The undergraduate-programs page renders links via JavaScript (Divi theme),
 * so cheerio-based crawling cannot discover them. This list ensures we always
 * pick up all available curriculum PDFs regardless of JS rendering.
 *
 * Format: [url, programName]
 */
const KNOWN_PDF_URLS: [string, string][] = [
  // ── School of Arts & Sciences ──
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Arts-in-English-Language.pdf', 'Bachelor of Arts in English Language'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Arts-Major-in-Philosophy.pdf', 'Bachelor of Arts Major in Philosophy'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Arts-Major-in-Political-Science.pdf', 'Bachelor of Arts Major in Political Science'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Arts-Major-in-Economics.pdf', 'Bachelor of Arts Major in Economics'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Arts-Major-in-Sociology.pdf', 'Bachelor of Arts Major in Sociology'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-od-Arts-in-Communication.pdf', 'Bachelor of Arts in Communication'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Arts-in-Interdisciplinary-Studies-Minor-in-Language-and-Literature.pdf', 'Bachelor of Arts in Interdisciplinary Studies Minor in Language and Literature'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Arts-in-Interdisciplinary-Studies-Minor-in-Media-and-Business.pdf', 'Bachelor of Arts in Interdisciplinary Studies Minor in Media and Business'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Arts-in-Interdisciplinary-Studies-Minor-in-Media-and-Technology.pdf', 'Bachelor of Arts in Interdisciplinary Studies Minor in Media and Technology'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Arts-in-Interdisciplinary-Studies-Minor-in-Media-and-Philosophy.pdf', 'Bachelor of Arts in Interdisciplinary Studies Minor in Media and Philosophy'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Arts-in-Interdisciplinary-Studies-Minor-in-Philosophy-and-Theology.pdf', 'Bachelor of Arts in Interdisciplinary Studies Minor in Philosophy and Theology'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Arts-in-Islamic-Studies.pdf', 'Bachelor of Arts in Islamic Studies'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Arts-in-Development-Studies.pdf', 'Bachelor of Arts in Development Studies'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/AB-Anthropology-Prospectus_MedAnth.pdf', 'AB Anthropology Medical Anthropology'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-BiologyGeneral-Biology.pdf', 'Bachelor of Science in Biology General Biology'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Chemistry.pdf', 'Bachelor of Science in Chemistry'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Mathematics.pdf', 'Bachelor of Science in Mathematics'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Environmental-Science.pdf', 'Bachelor of Science in Environmental Science'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Computer-Science.pdf', 'Bachelor of Science in Computer Science'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Information-Technolgy.pdf', 'Bachelor of Science in Information Technology'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Information-System.pdf', 'Bachelor of Science in Information Systems'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Data-Science.pdf', 'Bachelor of Data Science'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Social-Work.pdf', 'Bachelor of Science in Social Work'],
  // ── School of Business & Governance ──
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Accountancy.pdf', 'Bachelor of Science in Accountancy'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Marketing.pdf', 'Bachelor of Science in Marketing'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Finance.pdf', 'Bachelor of Science in Finance'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Human-Resource-Development-and-Management.pdf', 'Bachelor of Science in Human Resource Development and Management'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Public-Management-1.pdf', 'Bachelor of Public Management'],
  // ── School of Engineering & Architecture ──
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Aerospace-Engineerng.pdf', 'Bachelor of Science in Aerospace Engineering'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Architecture.pdf', 'Bachelor of Science in Architecture'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Chemical-Engineering.pdf', 'Bachelor of Science in Chemical Engineering'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Civil-Engineering.pdf', 'Bachelor of Science in Civil Engineering'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Computer-Engineering.pdf', 'Bachelor of Science in Computer Engineering'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Electrical-Engineering.pdf', 'Bachelor of Science in Electrical Engineering'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Electronics-Engineering.pdf', 'Bachelor of Science in Electronics Engineering'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Industrial-Engineering.pdf', 'Bachelor of Science in Industrial Engineering'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Mechanical-Engineering.pdf', 'Bachelor of Science in Mechanical Engineering'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/BS-Robotics-Engineering.pdf', 'Bachelor of Science in Robotics Engineering'],
  // ── School of Nursing ──
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Science-in-Nursing.pdf', 'Bachelor of Science in Nursing'],
  // ── School of Education ──
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Elementary-Education.pdf', 'Bachelor of Elementary Education'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Early-Childhood-Education.pdf', 'Bachelor of Early Childhood Education'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Secondary-Education-Major-in-Science.pdf', 'Bachelor of Secondary Education Major in Science'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Secondary-Education-Major-in-Mathematics.pdf', 'Bachelor of Secondary Education Major in Mathematics'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Secondary-Education-Major-in-English.pdf', 'Bachelor of Secondary Education Major in English'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Secondary-Education-Major-in-Physical-Sciences.pdf', 'Bachelor of Secondary Education Major in Physical Sciences'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Bachelor-of-Secondary-Education-Major-in-Social-Studies.pdf', 'Bachelor of Secondary Education Major in Social Studies'],
  // ── Graduate: Doctoral ──
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/PIDSCurriculum2020.pdf', 'Doctor of Philosophy in Development Studies'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Doctor-of-Business-Administration.pdf', 'Doctor of Business Administration'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Doctor-of-Philosophy-in-Educational-Administration-Major-in-Basic-Education-Administration.pdf', 'Doctor of Philosophy in Educational Administration'],
  // ── Graduate: Masters ──
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/MADSCurriculum2018.pdf', 'Master of Arts in Development Studies'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Course-Prospectus-MA-Anthro_2020.pdf', 'Master of Arts in Anthropology'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Master-in-Tropical-Risk-Management.pdf', 'Master in Tropical Risk Management'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Master-of-Engineering-Major-in-Computer-Engineering.pdf', 'Master of Engineering Major in Computer Engineering'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Master-of-Engineering-Major-in-Civil-Engineering.pdf', 'Master of Engineering Major in Civil Engineering'],
  ['https://www.addu.edu.ph/wp-content/uploads/2020/06/Master-in-Public-Administration-Major-of-Public-Policy.pdf', 'Master in Public Administration Major in Public Policy'],
  // ── Old (2015) Undergraduate PDFs ──
  ['https://www.addu.edu.ph/wp-content/uploads/2015/05/p_psychology.pdf', 'Psychology (2015)'],
  ['https://www.addu.edu.ph/wp-content/uploads/2015/05/p_sociology.pdf', 'Sociology (2015)'],
  ['https://www.addu.edu.ph/wp-content/uploads/2015/05/p_economics.pdf', 'Economics (2015)'],
  ['https://www.addu.edu.ph/wp-content/uploads/2015/05/p_biology.pdf', 'Biology (2015)'],
  ['https://www.addu.edu.ph/wp-content/uploads/2015/05/p_chemistry.pdf', 'Chemistry (2015)'],
  ['https://www.addu.edu.ph/wp-content/uploads/2015/05/p_nursing.pdf', 'Nursing (2015)'],
  ['https://www.addu.edu.ph/wp-content/uploads/2015/05/p_comscie.pdf', 'Computer Science (2015)'],
  ['https://www.addu.edu.ph/wp-content/uploads/2015/05/p_mechanical_eng.pdf', 'Mechanical Engineering (2015)'],
  ['https://www.addu.edu.ph/wp-content/uploads/2015/05/p_ece.pdf', 'Electronics and Communications Engineering (2015)'],
  ['https://www.addu.edu.ph/wp-content/uploads/2015/05/p_architecture.pdf', 'Architecture (2015)'],
  ['https://www.addu.edu.ph/wp-content/uploads/2015/05/p_philosophy.pdf', 'Philosophy (2015)'],
  ['https://www.addu.edu.ph/wp-content/uploads/2015/05/p_socialwork.pdf', 'Social Work (2015)'],
  ['https://www.addu.edu.ph/wp-content/uploads/2015/05/p_civil.pdf', 'Civil Engineering (2015)'],
  ['https://www.addu.edu.ph/wp-content/uploads/2015/05/p_math.pdf', 'Mathematics (2015)'],
];

const HEAD_CHECK_LIMIT = 50;
const ENABLE_HEAD_PROBE =
  (process.env.ENABLE_HEAD_PROBE ?? 'true').toLowerCase() === 'true';

const DOWNLOAD_KEYWORDS = [
  'curriculum',
  'prospectus',
  'download',
  'course',
  'checklist',
  'plan',
];

const GARBAGE_SUBSTRINGS = [
  'manual',
  'handbook',
  'memo',
  'calendar',
  'policy',
  'policies',
];

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

// ────────────────────────────────────────────────────────────────────────────
// URL helpers
// ────────────────────────────────────────────────────────────────────────────

export function isPdfUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.endsWith('.pdf');
  } catch {
    return false;
  }
}

export function isAdduDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname.endsWith('addu.edu.ph');
  } catch {
    return false;
  }
}

export function isGarbageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return GARBAGE_SUBSTRINGS.some((g) => lower.includes(g));
}

export function hasDownloadKeyword(url: string): boolean {
  const lower = url.toLowerCase();
  return DOWNLOAD_KEYWORDS.some((k) => lower.includes(k));
}

export function isDepartmentPage(url: string): boolean {
  const lower = url.toLowerCase();
  return [
    '/school-',
    '/college-',
    '/academics/',
    '/department',
    'graduate',
    'undergraduate',
    'programs',
    'bachelor',
  ].some((k) => lower.includes(k));
}

/**
 * Extract a human-readable program name from a PDF URL.
 */
export function extractProgramNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const filename = path.split('/').pop() ?? '';
    const raw = filename
      .replace(/\.pdf$/i, '')
      .replace(/-/g, ' ')
      .replace(/_/g, ' ');

    // Clean up common prefixes like "p grad", "p "
    let cleaned = raw
      .replace(/^p\s+grad\s+/i, '')
      .replace(/^p\s+/i, '')
      .replace(/^new\s+/i, '')
      .trim();

    // Title-case, preserving acronyms but lowercasing stop words
    const stopWords = new Set(['of', 'in', 'the', 'and', 'for', 'a', 'an', 'to', 'with']);
    cleaned = cleaned
      .split(/\s+/)
      .map((w, i) => {
        const lower = w.toLowerCase();
        // Keep known acronyms (2+ chars, all alpha) uppercase
        if (/^[A-Z]{2,}$/i.test(w) && w.length <= 6 && !stopWords.has(lower)) {
          return w.toUpperCase();
        }
        // Lowercase stop words (except first word)
        if (i > 0 && stopWords.has(lower)) return lower;
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      })
      .join(' ');

    return cleaned || raw;
  } catch {
    return url;
  }
}

/**
 * Derive the best program name from available sources.
 * Prefers descriptive link text over URL-derived names.
 */
export function deriveProgramName(pdf: DiscoveredPdf): string {
  const linkText = pdf.link_text.trim();
  if (linkText && linkText.length > 5) {
    const lower = linkText.toLowerCase();
    // Skip generic link text
    if (
      !lower.includes('download') &&
      !lower.includes('click') &&
      !lower.includes('here') &&
      lower !== 'pdf' &&
      !lower.endsWith('.pdf')
    ) {
      return linkText
        .replace(/\s*curriculum\s*$/i, '')
        .replace(/\s*checklist\s*$/i, '')
        .trim();
    }
  }

  return extractProgramNameFromUrl(pdf.url);
}

// ────────────────────────────────────────────────────────────────────────────
// HEAD probe
// ────────────────────────────────────────────────────────────────────────────

async function isPdfContent(
  url: string,
  headCheckCount: { count: number },
): Promise<boolean> {
  if (isPdfUrl(url)) return true;

  if (!ENABLE_HEAD_PROBE) return false;
  if (headCheckCount.count >= HEAD_CHECK_LIMIT) return false;
  if (!hasDownloadKeyword(url)) return false;

  try {
    headCheckCount.count++;
    const resp = await fetch(url, {
      method: 'HEAD',
      headers: HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });
    const ct = resp.headers.get('content-type') ?? '';
    return ct.toLowerCase().includes('application/pdf');
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main discovery
// ────────────────────────────────────────────────────────────────────────────

/**
 * Discover all curriculum PDF URLs from the AdDU website.
 * Returns DiscoveredPdf objects with link text and source page info.
 */
export async function discoverPdfUrls(
  delayMs = 100,
): Promise<DiscoveredPdf[]> {
  const pdfMap = new Map<string, DiscoveredPdf>();
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [];
  const headCheckCount = { count: 0 };

  // Seed known PDF URLs (JS-rendered pages can't be crawled with cheerio)
  for (const [url, programName] of KNOWN_PDF_URLS) {
    pdfMap.set(url, {
      url,
      link_text: programName,
      source_page: 'known',
    });
  }
  logger.info('Discovery', `Seeded ${KNOWN_PDF_URLS.length} known PDF URLs`);

  logger.info('Discovery', `Starting from ${BASE_URLS.length} base URLs`);

  for (const url of BASE_URLS) {
    queue.push({ url, depth: 0 });
  }

  while (queue.length > 0) {
    const { url: currentUrl, depth } = queue.shift()!;

    if (visited.has(currentUrl)) continue;
    if (!isAdduDomain(currentUrl)) continue;
    visited.add(currentUrl);

    if (delayMs > 0 && visited.size > 1) {
      await sleep(delayMs);
    }

    logger.debug('Discovery', `Crawling (depth=${depth}): ${currentUrl}`);

    try {
      const resp = await fetch(currentUrl, {
        headers: HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      });

      if (!resp.ok) continue;
      const html = await resp.text();
      const $ = cheerio.load(html);

      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;

        let absUrl: string;
        try {
          absUrl = new URL(href, currentUrl).href;
        } catch {
          return;
        }

        if (!isAdduDomain(absUrl)) return;
        if (isGarbageUrl(absUrl)) return;

        const linkText = $(el).text().trim();

        if (isPdfUrl(absUrl)) {
          if (!pdfMap.has(absUrl)) {
            logger.debug('Discovery', `Found PDF: ${absUrl} [${linkText}]`);
            pdfMap.set(absUrl, {
              url: absUrl,
              link_text: linkText,
              source_page: currentUrl,
            });
          }
        } else if (
          depth < 1 &&
          isDepartmentPage(absUrl) &&
          !visited.has(absUrl)
        ) {
          queue.push({ url: absUrl, depth: depth + 1 });
        }
      });

      // HEAD probe for non-.pdf download links
      if (ENABLE_HEAD_PROBE) {
        const potentialLinks: { url: string; linkText: string }[] = [];
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          try {
            const absUrl = new URL(href, currentUrl).href;
            if (
              isAdduDomain(absUrl) &&
              !isPdfUrl(absUrl) &&
              hasDownloadKeyword(absUrl) &&
              !pdfMap.has(absUrl)
            ) {
              potentialLinks.push({
                url: absUrl,
                linkText: $(el).text().trim(),
              });
            }
          } catch {
            /* skip */
          }
        });

        for (const link of potentialLinks) {
          if (headCheckCount.count >= HEAD_CHECK_LIMIT) break;
          if (await isPdfContent(link.url, headCheckCount)) {
            pdfMap.set(link.url, {
              url: link.url,
              link_text: link.linkText,
              source_page: currentUrl,
            });
          }
        }
      }
    } catch (err) {
      logger.warn('Discovery', `Error crawling ${currentUrl}: ${err}`);
    }
  }

  const result = [...pdfMap.values()];
  logger.info('Discovery', `Total PDFs found: ${result.length}`);
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
