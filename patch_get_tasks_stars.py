import re

# 1. Update server.js
server_file = 'server.js'
with open(server_file, 'r', encoding='utf-8') as f:
    server_text = f.read()

old_get_query = """      const params = [];
      if (role === 'FACILITY_MANAGER') {
        if (!facility_id || facility_id === 'ALL') {
            return res.status(403).json({ error: "Lỗi phân quyền: Không xác định được cơ sở hợp lệ." });
        }
        params.push(facility_id);
        query += ` AND t.facility_id = $${params.length}`;
      } else if (facility_id && facility_id !== 'ALL') {
        params.push(facility_id);
        query += ` AND t.facility_id = $${params.length}`;
      }"""
# Wait, the actual text in server.js has encoding issues like "L?i phn quy?n: Khng xc d?nh du?c co s? h?p l?." if my grep was literally matching question marks. But let's use regex to replace it robustly.

server_text = re.sub(
    r'      const params = \[\];.*?      \} else if \(facility_id && facility_id !== \'ALL\'\) \{.*?\n      \}',
    """      const params = [];
      if (role !== 'SUPER_ADMIN' && role !== 'VICE_PRESIDENT') {
          const userDept = normalizeDept(req.user.department_code || req.user.department_id);
          params.push(userDept);
          query += ` AND t.department_code = $${params.length}`;
      }""",
    server_text,
    flags=re.DOTALL
)

with open(server_file, 'w', encoding='utf-8') as f:
    f.write(server_text)

# 2. Update App.jsx
app_file = 'agent/rules/stitch_smart_ai_task_management_system/src/App.jsx'
with open(app_file, 'r', encoding='utf-8') as f:
    app_text = f.read()

app_text = re.sub(
    r'\{[^}]*task\.creator_role === \'SUPER_ADMIN\'.*?star<\/span>\s*<\/>\s*\)\}',
    """{task.priority_stars === 3 && (
                  <>
                    <span className="material-symbols-outlined text-[14px] text-yellow-400" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                    <span className="material-symbols-outlined text-[14px] text-yellow-400" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                    <span className="material-symbols-outlined text-[14px] text-yellow-400" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                  </>
                )}""",
    app_text,
    flags=re.DOTALL
)

app_text = re.sub(
    r'\{[^}]*task\.creator_role === \'VICE_PRESIDENT\'.*?star<\/span>\s*<\/>\s*\)\}',
    """{task.priority_stars === 2 && (
                  <>
                    <span className="material-symbols-outlined text-[14px] text-yellow-400" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                    <span className="material-symbols-outlined text-[14px] text-yellow-400" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                  </>
                )}""",
    app_text,
    flags=re.DOTALL
)

with open(app_file, 'w', encoding='utf-8') as f:
    f.write(app_text)

print("Patch applied to server.js and App.jsx")
