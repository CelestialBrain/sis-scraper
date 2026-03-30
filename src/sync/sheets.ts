/**
 * Google Sheets sync manager
 *
 * Ported from src/sheets.js → TypeScript.
 */

import { google, type sheets_v4 } from 'googleapis';
import type { SyncResult } from '../types.js';
import { logger } from '../utils/logger.js';

export class GoogleSheetsManager {
  private serviceAccountJson: string;
  private debugMode: boolean;
  private auth: InstanceType<typeof google.auth.JWT> | null = null;
  private sheets: sheets_v4.Sheets | null = null;

  constructor(options: { serviceAccount?: string; debug?: boolean } = {}) {
    this.serviceAccountJson = options.serviceAccount ?? process.env.GOOGLE_SERVICE_ACCOUNT ?? '';
    this.debugMode = options.debug ?? process.env.DEBUG_SCRAPER === 'true';
  }

  isEnabled(): boolean {
    return !!this.serviceAccountJson;
  }

  async init(): Promise<void> {
    if (!this.isEnabled()) {
      logger.info('Sheets', 'Sync disabled (no service account configured)');
      return;
    }

    const credentials =
      typeof this.serviceAccountJson === 'string'
        ? JSON.parse(this.serviceAccountJson)
        : this.serviceAccountJson;

    this.auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
      ],
    });

    await this.auth.authorize();
    this.sheets = google.sheets({ version: 'v4', auth: this.auth });

    if (this.debugMode) {
      logger.debug('Sheets', 'API client initialized');
    }
  }

  async syncData(
    spreadsheetId: string,
    sheetName: string,
    rows: Record<string, unknown>[],
  ): Promise<SyncResult> {
    if (!this.isEnabled()) return { success: false, reason: 'disabled' };
    if (!this.sheets) await this.init();
    if (!rows || rows.length === 0) return { success: true, row_synced: 0 };

    logger.info('Sheets', `Syncing ${rows.length} rows to "${sheetName}"...`);

    await this.ensureSheetExists(spreadsheetId, sheetName);

    const headers = Object.keys(rows[0]);
    const values = [
      headers,
      ...rows.map((row) => headers.map((h) => String(row[h] ?? ''))),
    ];

    await this.clearSheet(spreadsheetId, sheetName);

    await this.sheets!.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values },
    });

    await this.formatHeaderRow(spreadsheetId, sheetName);

    logger.success('Sheets', `Synced ${rows.length} rows to "${sheetName}"`);
    return { success: true, row_synced: rows.length };
  }

  private async ensureSheetExists(spreadsheetId: string, sheetName: string): Promise<void> {
    const resp = await this.sheets!.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties',
    });

    const sheets = resp.data.sheets ?? [];
    const exists = sheets.some((s) => s.properties?.title === sheetName);

    if (!exists) {
      await this.sheets!.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: sheetName } } }],
        },
      });
    }
  }

  private async clearSheet(spreadsheetId: string, sheetName: string): Promise<void> {
    try {
      await this.sheets!.spreadsheets.values.clear({
        spreadsheetId,
        range: `${sheetName}!A1:ZZ`,
        requestBody: {},
      });
    } catch {
      // Ignore — sheet may be empty
    }
  }

  private async formatHeaderRow(spreadsheetId: string, sheetName: string): Promise<void> {
    try {
      const resp = await this.sheets!.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties',
      });

      const sheet = resp.data.sheets?.find((s) => s.properties?.title === sheetName);
      if (!sheet?.properties?.sheetId) return;

      const sheetId = sheet.properties.sheetId;

      await this.sheets!.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                cell: { userEnteredFormat: { textFormat: { bold: true } } },
                fields: 'userEnteredFormat.textFormat.bold',
              },
            },
            {
              updateSheetProperties: {
                properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                fields: 'gridProperties.frozenRowCount',
              },
            },
          ],
        },
      });
    } catch (err) {
      logger.warn('Sheets', `Header formatting failed: ${err}`);
    }
  }
}
