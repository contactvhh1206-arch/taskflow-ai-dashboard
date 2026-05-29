import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update authenticateUser to extract x-department-id
auth_replacement = """const authenticateUser = async (req, res, next) => {
    try {
        const userRole = req.headers['x-user-role']; 
        const facilityRaw = req.headers['x-facility-id'];
        const departmentId = req.headers['x-department-id'];
        
        let facilityId = parseInt(facilityRaw, 10);
        
        if (!userRole) return res.status(401).json({ error: 'Unauthorized' });

        if (isNaN(facilityId) && facilityRaw && facilityRaw !== 'ALL') {
            const facRes = await pool.query('SELECT id FROM facilities WHERE code ILIKE $1 OR name ILIKE $1 LIMIT 1', [facilityRaw]);
            if (facRes.rows.length > 0) {
                facilityId = facRes.rows[0].id;
            } else {
                facilityId = null;
            }
        } else if (facilityRaw === 'ALL') {
            facilityId = 'ALL';
        }
      
        req.user = { role: userRole, facility_id: facilityId, department_id: departmentId };
        next();
"""

content = re.sub(
    r'const authenticateUser = async \(req, res, next\) => \{[\s\S]*?next\(\);\n',
    auth_replacement,
    content
)

# 2. Update POST /api/tasks to Force Override
post_replacement = """app.post('/api/tasks', authenticateUser, async (req, res) => {
    try {
      console.log("Payload tạo task:", req.body);
      const { title, desc, pic, deadline, status, urgent, facility } = req.body;
      
      let pic_id = null;
      if (pic) {
          const picUser = await pool.query('SELECT id FROM users WHERE full_name = $1 OR email = $1 LIMIT 1', [pic]);
          if (picUser.rows.length > 0) pic_id = picUser.rows[0].id;
      }
    
      let insert_facility_id = null;
      if (req.user.role === 'FACILITY_MANAGER') {
          insert_facility_id = req.user.facility_id;
      } else if (req.user.role === 'DEPARTMENT_HEAD' || req.user.role === 'FINANCE_DEPT') {
          // FORCE OVERRIDE cho phòng ban
          let targetDept = req.user.department_id || facility;
          if (targetDept && targetDept !== 'HQ' && targetDept !== 'ALL') {
              const facRecord = await pool.query('SELECT id FROM facilities WHERE code = $1 OR name = $1 LIMIT 1', [targetDept]);
              if (facRecord.rows.length > 0) {
                  insert_facility_id = facRecord.rows[0].id;
              }
          }
      } else {
          // Admin hoặc các role khác
          if (facility && facility !== 'HQ' && facility !== 'ALL') {
              let parsedFac = parseInt(facility, 10);
              if (!isNaN(parsedFac)) {
                  insert_facility_id = parsedFac;
              } else {
                  const facRecord = await pool.query('SELECT id FROM facilities WHERE code = $1 OR name = $1 LIMIT 1', [facility]);
                  if (facRecord.rows.length > 0) { insert_facility_id = facRecord.rows[0].id; }
              }
          }
      }
"""

content = re.sub(
    r"app\.post\('/api/tasks', authenticateUser, async \(req, res\) => \{[\s\S]*?\}\s*\}\s*\}",
    post_replacement,
    content,
    count=1
)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("Backend patched.")
