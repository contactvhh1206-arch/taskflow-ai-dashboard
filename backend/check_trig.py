import os
import psycopg2

DB_URL = "postgres://postgres.bipshksixssudfndfgyk:9n5D^T=3j8t_aH8W@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres"

try:
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    cur.execute("""
        SELECT tgname, proname, prosrc 
        FROM pg_trigger
        JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
        WHERE tgrelid = 'ai_chat_messages'::regclass;
    """)
    triggers = cur.fetchall()
    print("Triggers:", triggers)
except Exception as e:
    print("Error:", e)
