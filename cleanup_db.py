import os
import psycopg2
from dotenv import load_dotenv

load_dotenv('backend/.env')
conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor()

try:
    print('Dropping NOT NULL constraint on facility_id...')
    cur.execute('ALTER TABLE tasks ALTER COLUMN facility_id DROP NOT NULL;')
    
    print('Updating tasks that were assigned to HQ to NULL...')
    cur.execute("UPDATE tasks SET facility_id = NULL WHERE facility_id IN (SELECT id FROM facilities WHERE code = 'HQ');")
    
    print('Deleting HQ facility...')
    cur.execute("DELETE FROM facilities WHERE code = 'HQ';")
    
    conn.commit()
    print('Success!')
except Exception as e:
    print('Error:', e)
    conn.rollback()
finally:
    cur.close()
    conn.close()
