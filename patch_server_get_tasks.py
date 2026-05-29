import re

filepath = 'server.js'
with open(filepath, 'r', encoding='utf-8') as f:
    text = f.read()

old_query = """      SELECT t.id, t.title, t.description as desc, t.status, t.urgency as urgent, 
             TO_CHAR(t.deadline, 'YYYY-MM-DD"T"HH24:MI') as deadline, 
             t.created_at as "createdAt", t.updated_at as "completedAt",
             t.needs_support as "needsSupport",
             u.full_name as pic, u.email as "picId",
             f.name as facility, f.code as "facilityId"
      FROM tasks t
      LEFT JOIN users u ON t.pic_id = u.id
      LEFT JOIN facilities f ON t.facility_id = f.id
      WHERE 1=1"""

new_query = """      SELECT t.id, t.title, t.description as desc, t.status, t.urgency as urgent, 
             TO_CHAR(t.deadline, 'YYYY-MM-DD"T"HH24:MI') as deadline, 
             t.created_at as "createdAt", t.updated_at as "completedAt",
             t.needs_support as "needsSupport",
             u.full_name as pic, u.email as "picId",
             f.name as facility, f.code as "facilityId",
             COUNT(tc.id) AS comment_count
      FROM tasks t
      LEFT JOIN users u ON t.pic_id = u.id
      LEFT JOIN facilities f ON t.facility_id = f.id
      LEFT JOIN task_comments tc ON t.id = tc.task_id
      WHERE 1=1"""
text = text.replace(old_query, new_query)

old_order = "query += ` ORDER BY t.created_at DESC`;"
new_order = "query += ` GROUP BY t.id, u.full_name, u.email, f.name, f.code ORDER BY t.created_at DESC`;"
text = text.replace(old_order, new_order)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(text)

print("server.js patched successfully.")
