import psycopg2
DB_URL = "postgres://postgres.bipshksixssudfndfgyk:9n5D^T=3j8t_aH8W@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres"
conn = psycopg2.connect(DB_URL)
cursor = conn.cursor()
cursor.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'system_config'")
print(cursor.fetchall())
