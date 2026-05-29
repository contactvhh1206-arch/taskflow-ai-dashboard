import re

# 1. Patch server.js
server_file = 'server.js'
with open(server_file, 'r', encoding='utf-8') as f:
    server_text = f.read()

# Update authenticateUser
old_auth = """        let facilityId = parseInt(facilityRaw, 10);
        
        if (!userRole) return res.status(401).json({ error: 'Unauthorized' });

        if (isNaN(facilityId) && facilityRaw && facilityRaw !== 'ALL') {"""

new_auth = """        let facilityId = parseInt(facilityRaw, 10);
        const userId = req.headers['x-user-id'];
        
        if (!userRole) return res.status(401).json({ error: 'Unauthorized' });

        if (isNaN(facilityId) && facilityRaw && facilityRaw !== 'ALL') {"""

server_text = server_text.replace(old_auth, new_auth)

old_auth_set = "req.user = { role: userRole, facility_id: facilityId, department_id: departmentId };"
new_auth_set = "req.user = { id: userId ? parseInt(userId, 10) : null, role: userRole, facility_id: facilityId, department_id: departmentId };"
server_text = server_text.replace(old_auth_set, new_auth_set)

with open(server_file, 'w', encoding='utf-8') as f:
    f.write(server_text)

# 2. Patch App.jsx
app_file = 'agent/rules/stitch_smart_ai_task_management_system/src/App.jsx'
with open(app_file, 'r', encoding='utf-8') as f:
    app_text = f.read()

# Fix headers for GET
old_get_headers = """              headers: { 
                'x-user-role': user?.role, 
                'x-facility-id': user?.role === 'SUPER_ADMIN' ? 'ALL' : (Array.isArray(user?.facility_id) ? user.facility_id.join(',') : user?.facility_id) 
              }"""
new_get_headers = """              headers: { 
                'x-user-id': user?.id,
                'x-user-role': user?.role, 
                'x-facility-id': user?.role === 'SUPER_ADMIN' ? 'ALL' : (Array.isArray(user?.facility_id) ? user.facility_id.join(',') : user?.facility_id) 
              }"""
app_text = app_text.replace(old_get_headers, new_get_headers)

# Fix headers for POST
old_post_headers = """                          headers: {
                            'Content-Type': 'application/json',
                            'x-user-role': user.role,
                            'x-facility-id': user.role === 'SUPER_ADMIN' ? 'ALL' : (Array.isArray(user.facility_id) ? user.facility_id.join(',') : user.facility_id)
                          }"""
new_post_headers = """                          headers: {
                            'Content-Type': 'application/json',
                            'x-user-id': user.id,
                            'x-user-role': user.role,
                            'x-facility-id': user.role === 'SUPER_ADMIN' ? 'ALL' : (Array.isArray(user.facility_id) ? user.facility_id.join(',') : user.facility_id)
                          }"""
app_text = app_text.replace(old_post_headers, new_post_headers)

# Fix UI fallback as requested by CTO
old_ui = """<span className="font-bold text-[11px]">{c.user_name || 'Người dùng ẩn danh'}</span>"""
new_ui = """<span className="font-bold text-[11px]">{c.user_name ? c.user_name : 'Người dùng hệ thống'}</span>"""
app_text = app_text.replace(old_ui, new_ui)

with open(app_file, 'w', encoding='utf-8') as f:
    f.write(app_text)

print("Patch applied successfully.")
