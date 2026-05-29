import os
import psycopg2

# Basic implementation loading from .env
env_vars = {}
try:
    with open('agent/rules/stitch_smart_ai_task_management_system/server/.env', 'r') as f:
        for line in f:
            if '=' in line:
                k, v = line.strip().split('=', 1)
                env_vars[k] = v
except FileNotFoundError:
    pass

# If not found in specific location, try root
if not env_vars:
    try:
        with open('.env', 'r') as f:
            for line in f:
                if '=' in line:
                    k, v = line.strip().split('=', 1)
                    env_vars[k] = v
    except FileNotFoundError:
        pass

try:
    conn = psycopg2.connect(
        dbname=env_vars.get('DB_NAME', 'hub_dubai_db'),
        user=env_vars.get('DB_USER', 'postgres'),
        password=env_vars.get('DB_PASSWORD', 'postgres'),
        host=env_vars.get('DB_HOST', 'localhost'),
        port=env_vars.get('DB_PORT', '5432')
    )
    conn.autocommit = True
    cur = conn.cursor()

    print("Starting Migration...")

    # MARKETING
    cur.execute("""
      UPDATE tasks 
      SET department_code = 'MARKETING' 
      WHERE department_code ILIKE '%Truyền%' OR department_code ILIKE '%MKT%' OR department_code IS NULL
    """)
    print(f"Updated {cur.rowcount} rows to MARKETING.")

    # ACCOUNTING
    cur.execute("""
      UPDATE tasks 
      SET department_code = 'ACCOUNTING' 
      WHERE department_code ILIKE '%Kế toán%' OR department_code ILIKE '%Ke toan%' OR department_code ILIKE '%ACC%'
    """)
    print(f"Updated {cur.rowcount} rows to ACCOUNTING.")

    # HR
    cur.execute("""
      UPDATE tasks 
      SET department_code = 'HR' 
      WHERE department_code ILIKE '%Nhân sự%' OR department_code ILIKE '%Nhan su%' OR department_code ILIKE '%HR%'
    """)
    print(f"Updated {cur.rowcount} rows to HR.")

    cur.close()
    conn.close()
    print("Migration finished successfully.")

except Exception as e:
    print(f"Migration Error: {e}")
