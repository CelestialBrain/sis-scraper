"""
Google Sheets Uploader Module

Handles uploading curriculum data to Google Sheets using the Google Sheets API.
Uses the same environment variable names as aisis-scraper for compatibility.
"""

import os
import json
import logging

logger = logging.getLogger(__name__)


def get_sheets_credentials():
    """
    Get Google service account credentials from environment.
    
    Returns:
        dict or None: Parsed service account JSON, or None if not configured
    """
    sa_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT")
    if not sa_json:
        return None
    
    try:
        return json.loads(sa_json)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse GOOGLE_SERVICE_ACCOUNT JSON: {e}")
        return None


def upload_to_sheets(df, spreadsheet_id=None, sheet_name="Curriculum"):
    """
    Upload a DataFrame to Google Sheets.
    
    Clears the target sheet range and writes header row + all data rows in one batch.
    
    Args:
        df: pandas DataFrame to upload
        spreadsheet_id: Target spreadsheet ID (or from SPREADSHEET_ID env var)
        sheet_name: Name of the sheet/tab (default: "Curriculum")
        
    Returns:
        dict with success status and details
    """
    # Get spreadsheet ID from argument or environment
    spreadsheet_id = spreadsheet_id or os.environ.get("SPREADSHEET_ID")
    if not spreadsheet_id:
        logger.warning("[Sheets] No SPREADSHEET_ID configured, skipping upload")
        return {"success": False, "reason": "no_spreadsheet_id"}
    
    # Get credentials
    credentials = get_sheets_credentials()
    if not credentials:
        logger.warning("[Sheets] No GOOGLE_SERVICE_ACCOUNT configured, skipping upload")
        return {"success": False, "reason": "no_credentials"}
    
    try:
        # Import Google libraries
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build
        
        # Create credentials
        scopes = [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive.file"
        ]
        creds = Credentials.from_service_account_info(credentials, scopes=scopes)
        
        # Build service
        service = build("sheets", "v4", credentials=creds)
        sheets_api = service.spreadsheets()
        
        # Prepare data: header row + data rows
        headers = list(df.columns)
        values = [headers]
        
        for _, row in df.iterrows():
            # Convert all values to strings for sheets
            row_values = [str(v) if v is not None else "" for v in row.tolist()]
            values.append(row_values)
        
        # Clear existing data
        clear_range = f"{sheet_name}!A1:ZZ"
        logger.info(f"[Sheets] Clearing range: {clear_range}")
        
        try:
            sheets_api.values().clear(
                spreadsheetId=spreadsheet_id,
                range=clear_range,
                body={}
            ).execute()
        except Exception as clear_error:
            # Sheet might not exist yet, try to create it
            # Note: googleapiclient.errors.HttpError would be more specific but
            # we handle any error here since the recovery action is the same
            error_type = type(clear_error).__name__
            logger.info(f"[Sheets] Clear failed ({error_type}), attempting to create sheet")
            _ensure_sheet_exists(sheets_api, spreadsheet_id, sheet_name)
        
        # Write data
        write_range = f"{sheet_name}!A1"
        logger.info(f"[Sheets] Writing {len(values)} rows to {write_range}")
        
        result = sheets_api.values().update(
            spreadsheetId=spreadsheet_id,
            range=write_range,
            valueInputOption="RAW",
            body={"values": values}
        ).execute()
        
        updated_cells = result.get("updatedCells", 0)
        logger.info(f"[Sheets] Successfully wrote {updated_cells} cells")
        
        # Format header row (optional, best-effort)
        try:
            _format_header_row(sheets_api, spreadsheet_id, sheet_name)
        except Exception as format_error:
            logger.warning(f"[Sheets] Header formatting failed (non-fatal): {format_error}")
        
        return {
            "success": True,
            "rows_written": len(values) - 1,  # Exclude header
            "cells_updated": updated_cells
        }
        
    except ImportError as e:
        logger.error(f"[Sheets] Missing Google API libraries: {e}")
        return {"success": False, "reason": "missing_libraries", "error": str(e)}
    except Exception as e:
        logger.error(f"[Sheets] Upload failed: {e}")
        return {"success": False, "reason": "upload_error", "error": str(e)}


def _ensure_sheet_exists(sheets_api, spreadsheet_id, sheet_name):
    """
    Ensure a sheet/tab exists in the spreadsheet.
    
    Args:
        sheets_api: Google Sheets API service
        spreadsheet_id: Target spreadsheet ID
        sheet_name: Name of the sheet to create
    """
    try:
        # Get spreadsheet metadata
        response = sheets_api.get(
            spreadsheetId=spreadsheet_id,
            fields="sheets.properties"
        ).execute()
        
        sheets = response.get("sheets", [])
        sheet_exists = any(s["properties"]["title"] == sheet_name for s in sheets)
        
        if not sheet_exists:
            # Create the sheet
            sheets_api.batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={
                    "requests": [{
                        "addSheet": {
                            "properties": {"title": sheet_name}
                        }
                    }]
                }
            ).execute()
            logger.info(f"[Sheets] Created new sheet: {sheet_name}")
            
    except Exception as e:
        logger.error(f"[Sheets] Failed to ensure sheet exists: {e}")
        raise


def _format_header_row(sheets_api, spreadsheet_id, sheet_name):
    """
    Format the header row (bold, freeze).
    
    Args:
        sheets_api: Google Sheets API service
        spreadsheet_id: Target spreadsheet ID
        sheet_name: Name of the sheet
    """
    # Get sheet ID
    response = sheets_api.get(
        spreadsheetId=spreadsheet_id,
        fields="sheets.properties"
    ).execute()
    
    sheet = next(
        (s for s in response.get("sheets", []) 
         if s["properties"]["title"] == sheet_name),
        None
    )
    
    if not sheet:
        return
    
    sheet_id = sheet["properties"]["sheetId"]
    
    # Apply formatting
    sheets_api.batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={
            "requests": [
                # Bold header row
                {
                    "repeatCell": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": 0,
                            "endRowIndex": 1
                        },
                        "cell": {
                            "userEnteredFormat": {
                                "textFormat": {"bold": True}
                            }
                        },
                        "fields": "userEnteredFormat.textFormat.bold"
                    }
                },
                # Freeze header row
                {
                    "updateSheetProperties": {
                        "properties": {
                            "sheetId": sheet_id,
                            "gridProperties": {
                                "frozenRowCount": 1
                            }
                        },
                        "fields": "gridProperties.frozenRowCount"
                    }
                }
            ]
        }
    ).execute()
    
    logger.info(f"[Sheets] Formatted header row for: {sheet_name}")
