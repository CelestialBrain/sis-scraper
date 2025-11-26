/**
 * Google Sheets Manager Module
 * 
 * Handles OAuth2 authentication and data sync to Google Sheets.
 * Mirrors the architecture of GoogleSheetsManager from aisis-scraper.
 */

import { google } from 'googleapis';

/**
 * GoogleSheetsManager class
 * 
 * Manages Google Sheets authentication and data synchronization.
 */
export class GoogleSheetsManager {
  constructor(options = {}) {
    this.serviceAccountJson = options.serviceAccount || process.env.GOOGLE_SERVICE_ACCOUNT;
    this.debugMode = options.debug || process.env.DEBUG_SCRAPER === 'true';
    this.auth = null;
    this.sheets = null;
  }

  /**
   * Check if Sheets sync is enabled
   * 
   * @returns {boolean}
   */
  isEnabled() {
    return !!this.serviceAccountJson;
  }

  /**
   * Initialize Google Sheets API client
   * 
   * @returns {Promise<void>}
   */
  async init() {
    if (!this.isEnabled()) {
      console.log('[Sheets] Sync disabled (no service account configured)');
      return;
    }

    try {
      // Parse service account JSON
      const credentials = typeof this.serviceAccountJson === 'string'
        ? JSON.parse(this.serviceAccountJson)
        : this.serviceAccountJson;

      // Create JWT auth client
      this.auth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive.file'
        ]
      });

      await this.auth.authorize();

      // Initialize Sheets API
      this.sheets = google.sheets({ version: 'v4', auth: this.auth });

      if (this.debugMode) {
        console.log('[Sheets] API client initialized successfully');
      }
    } catch (error) {
      throw new Error(`Failed to initialize Google Sheets: ${error.message}`);
    }
  }

  /**
   * Sync data to a Google Sheet
   * 
   * @param {string} spreadsheetId - Target spreadsheet ID
   * @param {string} sheetName - Sheet/tab name
   * @param {Array<object>} rows - Data rows (array of objects)
   * @returns {Promise<object>} Sync result
   */
  async syncData(spreadsheetId, sheetName, rows) {
    if (!this.isEnabled()) {
      console.log('[Sheets] Sync disabled');
      return { success: false, reason: 'disabled' };
    }

    if (!this.sheets) {
      await this.init();
    }

    if (!rows || rows.length === 0) {
      console.log('[Sheets] No data to sync');
      return { success: true, rowsWritten: 0 };
    }

    console.log(`[Sheets] Syncing ${rows.length} rows to sheet "${sheetName}"...`);

    try {
      // Ensure the sheet exists
      await this._ensureSheetExists(spreadsheetId, sheetName);

      // Convert objects to 2D array with headers
      const headers = Object.keys(rows[0]);
      const values = [
        headers,
        ...rows.map(row => headers.map(h => row[h] ?? ''))
      ];

      // Clear existing data
      await this._clearSheet(spreadsheetId, sheetName);

      // Write new data
      const range = `${sheetName}!A1`;
      await this.sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: { values }
      });

      // Format header row
      await this._formatHeaderRow(spreadsheetId, sheetName);

      console.log(`[Sheets] Successfully synced ${rows.length} rows to "${sheetName}"`);
      return { success: true, rowsWritten: rows.length };

    } catch (error) {
      console.error(`[Sheets] Sync failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Ensure a sheet/tab exists in the spreadsheet
   * 
   * @param {string} spreadsheetId - Spreadsheet ID
   * @param {string} sheetName - Sheet name
   * @returns {Promise<void>}
   */
  async _ensureSheetExists(spreadsheetId, sheetName) {
    try {
      // Get spreadsheet metadata
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties'
      });

      const sheets = response.data.sheets || [];
      const sheetExists = sheets.some(s => s.properties.title === sheetName);

      if (!sheetExists) {
        // Create the sheet
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              addSheet: {
                properties: { title: sheetName }
              }
            }]
          }
        });

        if (this.debugMode) {
          console.log(`[Sheets] Created new sheet: ${sheetName}`);
        }
      }
    } catch (error) {
      throw new Error(`Failed to ensure sheet exists: ${error.message}`);
    }
  }

  /**
   * Clear all data from a sheet
   * 
   * @param {string} spreadsheetId - Spreadsheet ID
   * @param {string} sheetName - Sheet name
   * @returns {Promise<void>}
   */
  async _clearSheet(spreadsheetId, sheetName) {
    try {
      await this.sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${sheetName}!A1:ZZ`,
        requestBody: {}
      });

      if (this.debugMode) {
        console.log(`[Sheets] Cleared sheet: ${sheetName}`);
      }
    } catch (error) {
      // Ignore errors if sheet doesn't exist yet
      if (this.debugMode) {
        console.log(`[Sheets] Clear error (ignored): ${error.message}`);
      }
    }
  }

  /**
   * Format the header row (bold, freeze)
   * 
   * @param {string} spreadsheetId - Spreadsheet ID
   * @param {string} sheetName - Sheet name
   * @returns {Promise<void>}
   */
  async _formatHeaderRow(spreadsheetId, sheetName) {
    try {
      // Get sheet ID
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties'
      });

      const sheet = response.data.sheets?.find(s => s.properties.title === sheetName);
      if (!sheet) return;

      const sheetId = sheet.properties.sheetId;

      // Apply formatting
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            // Bold header row
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true }
                  }
                },
                fields: 'userEnteredFormat.textFormat.bold'
              }
            },
            // Freeze header row
            {
              updateSheetProperties: {
                properties: {
                  sheetId,
                  gridProperties: {
                    frozenRowCount: 1
                  }
                },
                fields: 'gridProperties.frozenRowCount'
              }
            }
          ]
        }
      });

      if (this.debugMode) {
        console.log(`[Sheets] Formatted header row for: ${sheetName}`);
      }
    } catch (error) {
      // Non-fatal error
      console.warn(`[Sheets] Failed to format header: ${error.message}`);
    }
  }
}
