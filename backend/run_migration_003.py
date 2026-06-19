"""Run migration 003_task_extension_request.sql on the Supabase database."""
import urllib.parse
import ssl
import os
import sys

try:
    import psycopg2
except ImportError:
    print("Installing psycopg2-binary...")
    os.system(f"{sys.executable} -m pip install psycopg2-binary --quiet")
    import psycopg2

DB_URL = "postgres://postgres.bipshksixssudfndfgyk:9n5D^T=3j8t_aH8W@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres"

SQL = """
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS extension_requested BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS extension_reason TEXT;
"""

try:
    print("Connecting to database...")
    conn = psycopg2.connect(DB_URL, sslmode='require')
    conn.autocommit = True
    cur = conn.cursor()
    print("Running migration: ADD COLUMN extension_requested, extension_reason...")
    cur.execute(SQL)
    # Verify the columns exist
    cur.execute("""
        SELECT column_name, data_type, column_default
        FROM information_schema.columns
        WHERE table_name = 'tasks' AND column_name IN ('extension_requested', 'extension_reason')
        ORDER BY column_name;
    """)
    rows = cur.fetchall()
    if rows:
        print("[OK] Migration successful! Columns found:")
        for row in rows:
            print(f"  - {row[0]}: {row[1]} (default: {row[2]})")
    else:
        print("[WARN] Columns may not have been created. Check manually.")
    cur.close()
    conn.close()
    print("Done.")
except Exception as e:
    print(f"[ERROR] Migration failed: {e}")
    sys.exit(1)
