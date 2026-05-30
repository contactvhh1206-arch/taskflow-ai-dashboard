import psycopg2

conn_str = "postgres://postgres:1@localhost:5432/hub_dubai_db"

try:
    with open('20260529_add_ai_chat_memory.sql', 'r', encoding='utf-8') as f:
        sql = f.read()

    conn = psycopg2.connect(conn_str)
    cur = conn.cursor()
    cur.execute(sql)
    conn.commit()
    print("Migration executed successfully!")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
