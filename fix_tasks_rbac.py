import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add ALL_ACCESS_ROLES and fix GET /api/tasks
old_get_tasks = """app.get('/api/tasks', authenticateUser, async (req, res) => {
  try {
    const { role, facility_id, department_code, department_id, id } = req.user;
    
    let query = `
      SELECT t.id, t.title, t.description as desc, t.status, t.urgency as urgent, 
             TO_CHAR(t.deadline, 'YYYY-MM-DD"T"HH24:MI') as deadline, 
             t.created_at as "createdAt", t.updated_at as "completedAt",
             t.needs_support as "needsSupport",
             u.full_name as pic, u.email as "picId",
             f.name as facility, f.code as "facilityId",
             COUNT(tc.id) AS comment_count
      FROM tasks t
      LEFT JOIN users u ON t.pic_id = u.id
      LEFT JOIN facilities f ON t.facility_id = f.id AND f.is_deleted = false
      LEFT JOIN task_comments tc ON t.id = tc.task_id
      WHERE 1=1
    `;
    const params = [];
    const userDept = normalizeDept(department_code || department_id);

    if (
        role === 'SUPER_ADMIN' || 
        role === 'VICE_PRESIDENT' || 
        (role === 'DEPARTMENT_HEAD' && userDept === 'MARKETING')
    ) {
        // Nhóm All-Access: Không áp dụng điều kiện lọc bổ sung
    } else {
        // Nhóm Local: Áp dụng chung cho FACILITY_MANAGER, FINANCE_DEPT...
        params.push(userDept, id, id);
        query += ` AND (t.department_code = $${params.length - 2} OR t.created_by = $${params.length - 1} OR t.pic_id = $${params.length})`;
    }"""

new_get_tasks = """const ALL_ACCESS_ROLES = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'DEPARTMENT_HEAD', 'FINANCE_DEPT'];

app.get('/api/tasks', authenticateUser, async (req, res) => {
  try {
    const { role, facility_id, department_code, department_id, id } = req.user;
    
    let query = `
      SELECT t.id, t.title, t.description as desc, t.status, t.urgency as urgent, 
             TO_CHAR(t.deadline, 'YYYY-MM-DD"T"HH24:MI') as deadline, 
             t.created_at as "createdAt", t.updated_at as "completedAt",
             t.needs_support as "needsSupport",
             u.full_name as pic, u.email as "picId",
             f.name as facility, f.code as "facilityId",
             COUNT(tc.id) AS comment_count
      FROM tasks t
      LEFT JOIN users u ON t.pic_id = u.id
      LEFT JOIN facilities f ON t.facility_id = f.id AND f.is_deleted = false
      LEFT JOIN task_comments tc ON t.id = tc.task_id
      WHERE 1=1
    `;
    const params = [];
    const userDept = normalizeDept(department_code || department_id);

    if (ALL_ACCESS_ROLES.includes(role)) {
        // Nhóm All-Access: Không áp dụng điều kiện lọc bổ sung
    } else {
        // Nhóm Local: Áp dụng chung cho FACILITY_MANAGER, FINANCE_DEPT...
        params.push(department_code, id, id);
        query += ` AND (t.department_code = $${params.length - 2} OR t.created_by = $${params.length - 1} OR t.pic_id = $${params.length})`;
    }"""

# Since the file might have unicode characters, we use simple string replacement, wait, the original file has:
# "NhÃ³m All-Access: KhÃ´ng Ã¡p dá»¥ng Ä‘iá» u kiá»‡n lá» c bá»• sung"
# So I should use regex to replace it safely without relying on exact UTF-8 strings.
import re
get_tasks_pattern = re.compile(
    r"app\.get\('/api/tasks'.*?const userDept = normalizeDept\(department_code \|\| department_id\);\s+if \(.*?\) \{\s+// [^\n]+\s+\} else \{\s+// [^\n]+\s+params\.push\(userDept, id, id\);\s+query \+= ` AND \(t\.department_code = \$\$\{params\.length - 2\} OR t\.created_by = \$\$\{params\.length - 1\} OR t\.pic_id = \$\$\{params\.length\}\)`;\s+\}",
    re.DOTALL
)

get_tasks_replacement = """const ALL_ACCESS_ROLES = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'DEPARTMENT_HEAD', 'FINANCE_DEPT'];

app.get('/api/tasks', authenticateUser, async (req, res) => {
  try {
    const { role, facility_id, department_code, department_id, id } = req.user;
    
    let query = `
      SELECT t.id, t.title, t.description as desc, t.status, t.urgency as urgent, 
             TO_CHAR(t.deadline, 'YYYY-MM-DD"T"HH24:MI') as deadline, 
             t.created_at as "createdAt", t.updated_at as "completedAt",
             t.needs_support as "needsSupport",
             u.full_name as pic, u.email as "picId",
             f.name as facility, f.code as "facilityId",
             COUNT(tc.id) AS comment_count
      FROM tasks t
      LEFT JOIN users u ON t.pic_id = u.id
      LEFT JOIN facilities f ON t.facility_id = f.id AND f.is_deleted = false
      LEFT JOIN task_comments tc ON t.id = tc.task_id
      WHERE 1=1
    `;
    const params = [];
    const userDept = normalizeDept(department_code || department_id);

    if (ALL_ACCESS_ROLES.includes(role)) {
        // Nhóm All-Access: Không áp dụng điều kiện lọc bổ sung
    } else {
        // Nhóm Local: Áp dụng chung cho FACILITY_MANAGER, FINANCE_DEPT...
        params.push(department_code, id, id);
        query += ` AND (t.department_code = $${params.length - 2} OR t.created_by = $${params.length - 1} OR t.pic_id = $${params.length})`;
    }"""

content = get_tasks_pattern.sub(get_tasks_replacement, content)

post_tasks_pattern = re.compile(
    r"// 1\. CH.*?NG PAYLOAD SPOOFING.*?\n\s+if \(req\.user\.role === 'FACILITY_MANAGER'\) \{.*?\n\s+insert_facility_id = req\.user\.facility_id;.*?\n\s+\} else if \(req\.user\.role === 'DEPARTMENT_HEAD' \|\| req\.user\.role === 'FINANCE_DEPT' \|\| req\.user\.role === 'LOCAL'\) \{.*?\n\s+insert_dept_code = normalizeDept\(req\.user\.department_code \|\| req\.user\.department_id\);.*?\n\s+if \(facility && facility !== 'HQ' && facility !== 'ALL'\) \{.*?\n\s+let parsedFac = parseInt\(facility, 10\);.*?\n\s+if \(!isNaN\(parsedFac\)\) insert_facility_id = parsedFac;.*?\n\s+else \{.*?\n\s+const facRecord = await pool\.query\('SELECT id FROM facilities WHERE code = \$1 OR name = \$1 LIMIT 1', \[facility\]\);.*?\n\s+if \(facRecord\.rows\.length > 0\) insert_facility_id = facRecord\.rows\[0\]\.id;.*?\n\s+\}.*?\n\s+\}.*?\n\s+\} else \{.*?\n\s+// ADMIN hoáº·c VICE_PRESIDENT.*?\n\s+if \(facility && facility !== 'HQ' && facility !== 'ALL'\) \{.*?\n\s+let parsedFac = parseInt\(facility, 10\);.*?\n\s+if \(!isNaN\(parsedFac\)\) insert_facility_id = parsedFac;.*?\n\s+else \{.*?\n\s+const facRecord = await pool\.query\('SELECT id FROM facilities WHERE code = \$1 OR name = \$1 LIMIT 1', \[facility\]\);.*?\n\s+if \(facRecord\.rows\.length > 0\) insert_facility_id = facRecord\.rows\[0\]\.id;.*?\n\s+\}.*?\n\s+\}.*?\n\s+\}",
    re.DOTALL
)

post_tasks_replacement = """// 1. CHỐNG PAYLOAD SPOOFING: ÉP CỨNG ĐỊNH DANH THEO ROLE
      if (!ALL_ACCESS_ROLES.includes(req.user.role)) {
          // Nhóm Local (VD: FACILITY_MANAGER)
          insert_dept_code = req.user.department_code;
          insert_facility_id = req.user.facility_id;
      } else {
          // Nhóm All-Access
          if (facility && facility !== 'HQ' && facility !== 'ALL') {
              let parsedFac = parseInt(facility, 10);
              if (!isNaN(parsedFac)) insert_facility_id = parsedFac;
              else {
                  const facRecord = await pool.query('SELECT id FROM facilities WHERE code = $1 OR name = $1 LIMIT 1', [facility]);
                  if (facRecord.rows.length > 0) insert_facility_id = facRecord.rows[0].id;
              }
          }
      }"""

content = post_tasks_pattern.sub(post_tasks_replacement, content)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Replaced successfully!")
