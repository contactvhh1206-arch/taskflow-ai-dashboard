import re

# 1. Update server.js
with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'r', encoding='utf-8') as f:
    server_text = f.read()

old_reset_backend = """    await pool.query('TRUNCATE TABLE tasks RESTART IDENTITY CASCADE');
    await pool.query('DELETE FROM daily_logs WHERE entry_type != $1', ['SYSTEM_CONFIG']);
    await pool.query('DELETE FROM daily_financial_reports');"""

new_reset_backend = """    await pool.query('TRUNCATE TABLE tasks RESTART IDENTITY CASCADE');
    await pool.query('TRUNCATE TABLE company_knowledge_base RESTART IDENTITY CASCADE');
    await pool.query('TRUNCATE TABLE ai_chat_sessions RESTART IDENTITY CASCADE');
    await pool.query('TRUNCATE TABLE ai_chat_messages RESTART IDENTITY CASCADE');
    await pool.query('DELETE FROM daily_logs WHERE entry_type != $1', ['SYSTEM_CONFIG']);
    await pool.query('DELETE FROM daily_financial_reports');"""

server_text = server_text.replace(old_reset_backend, new_reset_backend)

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'w', encoding='utf-8') as f:
    f.write(server_text)

# 2. Update AdminConfigPanel.jsx
with open('C:/Users/Hoang/Desktop/hub-dubai/agent/rules/stitch_smart_ai_task_management_system/src/components/AdminConfigPanel.jsx', 'r', encoding='utf-8') as f:
    admin_text = f.read()

old_reset_frontend = """               // 1. Chỉ xóa công việc và checkin ở client (Local Storage)
               localStorage.removeItem('taskflow_tasks');
               localStorage.removeItem('taskflow_checkins');
               localStorage.removeItem('taskflow_daily_financial_reports');
               localStorage.removeItem('taskflow_facility_kpis');"""

new_reset_frontend = """               // 1. Chỉ xóa công việc và checkin ở client (Local Storage)
               localStorage.removeItem('taskflow_tasks');
               localStorage.removeItem('taskflow_checkins');
               localStorage.removeItem('taskflow_daily_financial_reports');
               localStorage.removeItem('taskflow_facility_kpis');
               localStorage.removeItem('taskflow_rag_docs');
               localStorage.removeItem('taskflow_rag_contents');"""

admin_text = admin_text.replace(old_reset_frontend, new_reset_frontend)

with open('C:/Users/Hoang/Desktop/hub-dubai/agent/rules/stitch_smart_ai_task_management_system/src/components/AdminConfigPanel.jsx', 'w', encoding='utf-8') as f:
    f.write(admin_text)

print("Patch applied to reset endpoints safely.")
