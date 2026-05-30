import psycopg2

conn_str = "postgres://postgres:1@localhost:5432/hub_dubai_db"

try:
    conn = psycopg2.connect(conn_str)
    cur = conn.cursor()
    
    cur.execute("ALTER TABLE users DROP COLUMN IF EXISTS password;")
    conn.commit()
    
    print("Dropped 'password' column from 'users' table successfully.")
    
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error dropping column: {e}")
