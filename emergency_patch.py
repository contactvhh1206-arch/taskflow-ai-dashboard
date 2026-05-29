import re

server_file = 'server.js'
with open(server_file, 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Remove normalizeDept from its current local spot
text = re.sub(
    r'const normalizeDept = \(code\) => \{.*?return normalized;\n\};\n',
    '',
    text,
    flags=re.DOTALL
)

# 2. Insert normalizeDept at the global level (after dotenv.config())
text = text.replace(
    "dotenv.config();",
    """dotenv.config();

const normalizeDept = (code) => {
    if (!code) return '';
    let normalized = code.toString().trim().toUpperCase();
    normalized = normalized.replace(/^PHÒNG\s+/i, '').replace(/^PHONG\s+/i, '');
    if (normalized === 'MKT') return 'MARKETING';
    return normalized;
};"""
)

# 3. Patch GET /api/tasks logic
# I need to find the `const params = [];` part inside app.get('/api/tasks'...)
# And replace the `if (role !== 'SUPER_ADMIN' && role !== 'VICE_PRESIDENT') { ... }` logic.

text = re.sub(
    r'      const params = \[\];\s*if \(role !== \'SUPER_ADMIN\' && role !== \'VICE_PRESIDENT\'\) \{.*?\n      \}',
    """      const params = [];
      if (role === 'SUPER_ADMIN' || role === 'VICE_PRESIDENT') {
          // Không nối thêm AND. Đặc quyền xem toàn bộ hệ thống.
      } else if (role === 'FACILITY_MANAGER') {
          // Lọc theo cơ sở
          params.push(req.user.facility_id);
          query += ` AND t.facility_id = $${params.length}`;
      } else {
          // Lọc theo phòng ban (Dành cho DEPARTMENT_HEAD và LOCAL)
          const userDept = normalizeDept(req.user.department_code || req.user.department_id);
          params.push(userDept);
          query += ` AND t.department_code = $${params.length}`;
      }""",
    text,
    flags=re.DOTALL
)

with open(server_file, 'w', encoding='utf-8') as f:
    f.write(text)

print("Emergency patch applied to server.js")
