import psycopg2

DB_URL = "postgres://postgres.bipshksixssudfndfgyk:9n5D^T=3j8t_aH8W@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres"
try:
    conn = psycopg2.connect(DB_URL)
    cursor = conn.cursor()
    cursor.execute("SELECT data FROM system_config WHERE key = 'taskflow_ai_config'")
    res = cursor.fetchall()
    print("DB CONFIG:", res)
except Exception as e:
    print("Error:", e)
