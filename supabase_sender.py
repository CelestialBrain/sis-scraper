"""
Supabase Batch Sender Module

Handles batch upsert of curriculum data to Supabase via HTTP POST.
Uses the same environment variable names as aisis-scraper for compatibility.
"""

import os
import json
import logging

import requests

from schema_transformer import UNIVERSITY_CODE

logger = logging.getLogger(__name__)

# Default batch size
DEFAULT_BATCH_SIZE = 2000

# Default endpoint path
DEFAULT_INGEST_ENDPOINT = "/functions/v1/ingest-curriculum"


def get_supabase_config():
    """
    Get Supabase configuration from environment variables.
    
    Returns:
        dict with url, token, batch_size, and endpoint
    """
    supabase_url = os.environ.get("SUPABASE_URL", "")
    ingest_token = os.environ.get("DATA_INGEST_TOKEN", "")
    
    # Safe integer parsing with fallback
    try:
        batch_size = int(os.environ.get("SUPABASE_CLIENT_BATCH_SIZE", DEFAULT_BATCH_SIZE))
    except (ValueError, TypeError):
        logger.warning(f"Invalid SUPABASE_CLIENT_BATCH_SIZE, using default: {DEFAULT_BATCH_SIZE}")
        batch_size = DEFAULT_BATCH_SIZE
    
    # Construct full endpoint URL
    endpoint = supabase_url.rstrip("/") + DEFAULT_INGEST_ENDPOINT if supabase_url else ""
    
    return {
        "url": supabase_url,
        "token": ingest_token,
        "batch_size": batch_size,
        "endpoint": endpoint
    }


def send_to_supabase(df, config=None):
    """
    Send curriculum data to Supabase in batches.
    
    Args:
        df: pandas DataFrame with AISIS-style curriculum data
        config: Optional config dict (defaults to env vars)
        
    Returns:
        dict with success status and details
    """
    if config is None:
        config = get_supabase_config()
    
    # Validate configuration
    if not config.get("url"):
        logger.warning("[Supabase] No SUPABASE_URL configured, skipping upload")
        return {"success": False, "reason": "no_supabase_url"}
    
    if not config.get("token"):
        logger.warning("[Supabase] No DATA_INGEST_TOKEN configured, skipping upload")
        return {"success": False, "reason": "no_ingest_token"}
    
    endpoint = config.get("endpoint")
    token = config.get("token")
    batch_size = config.get("batch_size", DEFAULT_BATCH_SIZE)
    
    # Convert DataFrame to list of dicts
    records = df.to_dict(orient="records")
    
    if not records:
        logger.warning("[Supabase] No records to send")
        return {"success": True, "records_sent": 0}
    
    # Ensure each record has university_code
    for record in records:
        record["university_code"] = UNIVERSITY_CODE
    
    # Split into batches
    batches = [records[i:i + batch_size] for i in range(0, len(records), batch_size)]
    
    logger.info(f"[Supabase] Sending {len(records)} records in {len(batches)} batches (batch_size={batch_size})")
    
    total_sent = 0
    errors = []
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"
    }
    
    for batch_idx, batch in enumerate(batches, 1):
        try:
            payload = {
                "records": batch,
                "metadata": {
                    "source": "sis-scraper",
                    "university_code": UNIVERSITY_CODE,
                    "batch_index": batch_idx,
                    "total_batches": len(batches)
                }
            }
            
            logger.info(f"[Supabase] Sending batch {batch_idx}/{len(batches)} ({len(batch)} records)...")
            
            response = requests.post(
                endpoint,
                headers=headers,
                json=payload,
                timeout=60
            )
            
            if response.ok:
                total_sent += len(batch)
                logger.info(f"[Supabase] Batch {batch_idx} sent successfully")
            else:
                # Sanitize error message - don't expose full response body
                error_msg = f"HTTP {response.status_code}"
                logger.error(f"[Supabase] Batch {batch_idx} failed: {error_msg}")
                errors.append({"batch": batch_idx, "error": error_msg})
                
        except requests.RequestException as e:
            # Sanitize error - only log exception type, not full details
            error_type = type(e).__name__
            logger.error(f"[Supabase] Batch {batch_idx} request failed: {error_type}")
            errors.append({"batch": batch_idx, "error": error_type})
    
    success = len(errors) == 0
    result = {
        "success": success,
        "records_sent": total_sent,
        "total_records": len(records),
        "batches_sent": len(batches) - len(errors),
        "total_batches": len(batches)
    }
    
    if errors:
        result["errors"] = errors
    
    if success:
        logger.info(f"[Supabase] Successfully sent {total_sent} records")
    else:
        logger.error(f"[Supabase] Completed with errors: {len(errors)} batch(es) failed")
    
    return result
