import psycopg2

conn_str = "postgresql://taskflow_db_328p_user:6E6G6eB1A4VlP6b85H9r8W154i4K0k7m@dpg-cu141a0gph6c73cdv56g-a.singapore-postgres.render.com/taskflow_db_328p"

try:
    conn = psycopg2.connect(conn_str)
    cur = conn.cursor()

    print("Executing ALTER TABLE...")
    cur.execute("ALTER TABLE facilities ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;")
    conn.commit()
    print("ALTER TABLE Success.")

    print("Checking information_schema...")
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='facilities' AND column_name='is_deleted';")
    rows = cur.fetchall()
    
    print("Validation Result:")
    for row in rows:
        print(f"Column found: {row[0]}")

    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
