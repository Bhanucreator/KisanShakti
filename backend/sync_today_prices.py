"""
KisanShakti - Real-time APMC Price Sync Script
Run this script to fetch today's live prices directly from the Karnataka State APMC Portal (KRAMA).
"""
import sys
from pathlib import Path

# Redirect to root script if called from backend directory
ROOT_SCRIPT = Path(__file__).resolve().parent.parent / "sync_today_prices.py"
if ROOT_SCRIPT.exists():
    with open(ROOT_SCRIPT, "r", encoding="utf-8") as f:
        exec(f.read())
else:
    print(f"Error: Could not locate main sync script at {ROOT_SCRIPT}")
