/**
 * Table reconstruction from raw PDF text items
 *
 * Converts position-based text items into a 2D string[][] table,
 * producing the same shape that pdfplumber returns. This allows the
 * existing layout parsers (standard / split) to work unchanged.
 *
 * Algorithm:
 *   1. Cluster items by Y-coordinate into rows (tolerance-based)
 *   2. Detect column boundaries from X-position distribution
 *   3. Assign each text item to its row × column cell
 *   4. Merge multiple items that land in the same cell
 */

import type { TextItem, PageTextItems, Table } from '../types.js';

/** Default Y-tolerance for grouping items into the same row (in pt). */
const ROW_TOLERANCE = 4;

/** Minimum gap between column boundaries (in pt). */
const MIN_COL_GAP = 8;

// ────────────────────────────────────────────────────────────────────────────
// Row clustering
// ────────────────────────────────────────────────────────────────────────────

interface Row {
  y: number; // representative Y (average)
  item: TextItem[];
}

function clusterRows(items: TextItem[], tolerance: number): Row[] {
  if (items.length === 0) return [];

  // Sort by Y (top-down)
  const sorted = [...items].sort((a, b) => a.y - b.y);

  const rows: Row[] = [];
  let currentRow: TextItem[] = [sorted[0]];
  let currentY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - currentY) <= tolerance) {
      currentRow.push(sorted[i]);
    } else {
      rows.push({ y: avg(currentRow.map((it) => it.y)), item: currentRow });
      currentRow = [sorted[i]];
      currentY = sorted[i].y;
    }
  }
  rows.push({ y: avg(currentRow.map((it) => it.y)), item: currentRow });

  // Sort items within each row by X (left to right)
  for (const row of rows) {
    row.item.sort((a, b) => a.x - b.x);
  }

  return rows;
}

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

// ────────────────────────────────────────────────────────────────────────────
// Column boundary detection
// ────────────────────────────────────────────────────────────────────────────

/**
 * Detect column left-edge boundaries by analyzing gaps in X positions
 * across all rows.
 *
 * We collect all unique X start positions rounded to the nearest integer,
 * sort them, then split into groups wherever there is a gap > MIN_COL_GAP.
 * The representative boundary for each group is the minimum X in that group.
 */
function detectColumns(rows: Row[], pageWidth: number): number[] {
  // Collect all item X positions
  const xPositions: number[] = [];
  for (const row of rows) {
    for (const item of row.item) {
      xPositions.push(Math.round(item.x));
    }
  }

  if (xPositions.length === 0) return [0];

  // Deduplicate and sort
  const unique = [...new Set(xPositions)].sort((a, b) => a - b);

  // Group by gap — if two consecutive X positions are > MIN_COL_GAP apart,
  // they belong to different columns.
  const boundaries: number[] = [unique[0]];
  for (let i = 1; i < unique.length; i++) {
    if (unique[i] - unique[i - 1] > MIN_COL_GAP) {
      boundaries.push(unique[i]);
    }
  }

  return boundaries;
}

/**
 * Find the column index for a given X position.
 */
function findColumn(x: number, boundaries: number[]): number {
  for (let i = boundaries.length - 1; i >= 0; i--) {
    if (x >= boundaries[i] - MIN_COL_GAP / 2) return i;
  }
  return 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Reconstruct tables from a single page of text items.
 *
 * Returns an array of tables — most curriculum PDFs have one table per page,
 * but we handle multi-table pages by looking for large Y-gaps.
 */
export function reconstructTables(
  page: PageTextItems,
  options: { rowTolerance?: number } = {},
): Table[] {
  const tolerance = options.rowTolerance ?? ROW_TOLERANCE;

  if (page.item.length === 0) return [];

  const rows = clusterRows(page.item, tolerance);
  if (rows.length === 0) return [];

  // Split into separate tables when there's a large Y-gap (> 30pt)
  const TABLE_GAP = 30;
  const tableGroups: Row[][] = [[]];

  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && rows[i].y - rows[i - 1].y > TABLE_GAP) {
      // Only create a new table group if the gap is very significant
      // and the previous group has content
      if (tableGroups[tableGroups.length - 1].length > 0) {
        tableGroups.push([]);
      }
    }
    tableGroups[tableGroups.length - 1].push(rows[i]);
  }

  const tables: Table[] = [];

  for (const group of tableGroups) {
    if (group.length === 0) continue;

    // Detect columns for this table group
    const boundaries = detectColumns(group, page.width);
    const colCount = boundaries.length;

    const table: Table = [];

    for (const row of group) {
      const cells: string[] = new Array(colCount).fill('');

      for (const item of row.item) {
        const colIdx = findColumn(item.x, boundaries);
        if (cells[colIdx]) {
          cells[colIdx] += ' ' + item.text;
        } else {
          cells[colIdx] = item.text;
        }
      }

      table.push(cells);
    }

    // Only include tables with at least 2 rows (header + data)
    if (table.length >= 2) {
      tables.push(table);
    }
  }

  // If no multi-row tables were found but we have rows, return a single table
  if (tables.length === 0 && rows.length >= 2) {
    const boundaries = detectColumns(rows, page.width);
    const colCount = boundaries.length;
    const table: Table = [];

    for (const row of rows) {
      const cells: string[] = new Array(colCount).fill('');
      for (const item of row.item) {
        const colIdx = findColumn(item.x, boundaries);
        if (cells[colIdx]) {
          cells[colIdx] += ' ' + item.text;
        } else {
          cells[colIdx] = item.text;
        }
      }
      table.push(cells);
    }

    tables.push(table);
  }

  return tables;
}
