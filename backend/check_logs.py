import psycopg2
import urllib.parse

def main():
    # Direct DB URL
    password = urllib.parse.quote_plus("9n5D^T=3j8t_aH8W")
    # project ref is bipshksixssudfndfgyk
    DB_URL = f"postgresql://postgres:{password}@db.bipshksixssudfndfgyk.supabase.co:5432/postgres"

    try:
        conn = psycopg2.connect(DB_URL)
        cursor = conn.cursor()
        
        print("=== SCHEMA OF daily_logs ===")
        cursor.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'daily_logs';")
        for row in cursor.fetchall():
            print(f"- {row[0]}: {row[1]}")
            
        print("\n=== DATA SAMPLE OF daily_logs ===")
        cursor.execute("SELECT id, org_unit, entry_type, date, display_time, ai_vector_data FROM daily_logs ORDER BY id DESC LIMIT 2;")
        for row in cursor.fetchall():
            print(f"ID: {row[0]} | OrgUnit: {row[1]} | Type: {row[2]} | Date: {row[3]} | Time: {row[4]}")
            print(f"AI Vector Data: {row[5]}")
            print("---")
            
    except Exception as e:
        print("Error:", e)
    finally:
        if 'conn' in locals() and conn:
            conn.close()

if __name__ == '__main__':
    main()
