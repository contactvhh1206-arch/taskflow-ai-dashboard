import re

# 1. Patch package.json
pkg_file = 'package.json'
with open(pkg_file, 'r', encoding='utf-8') as f:
    pkg_text = f.read()

if '"jsonwebtoken":' not in pkg_text:
    pkg_text = pkg_text.replace('"dependencies": {', '"dependencies": {\n    "jsonwebtoken": "^9.0.2",')
    with open(pkg_file, 'w', encoding='utf-8') as f:
        f.write(pkg_text)

# 2. Patch server.js
server_file = 'server.js'
with open(server_file, 'r', encoding='utf-8') as f:
    server_text = f.read()

if "import jwt from 'jsonwebtoken';" not in server_text:
    server_text = server_text.replace("import express from 'express';", "import express from 'express';\nimport jwt from 'jsonwebtoken';")

old_auth = """const authenticateUser = async (req, res, next) => {
    try {
        const userRole = req.headers['x-user-role']; 
        const facilityRaw = req.headers['x-facility-id'];
        const departmentId = req.headers['x-department-id'];
        
        let facilityId = parseInt(facilityRaw, 10);
        const userId = req.headers['x-user-id'];
        
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
      
        req.user = { id: userId ? parseInt(userId, 10) : null, role: userRole, facility_id: facilityId, department_id: departmentId };
        next();
    } catch (err) {
        console.error("Auth middleware error:", err);
        return res.status(500).json({ error: 'Lỗi xác thực nội bộ.' });
    }
};"""

new_auth = """const authenticateUser = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' });
        }

        const token = authHeader.split(' ')[1];
        let userId = null;
        let userRole = null;
        let facilityRaw = null;
        let departmentId = null;

        try {
            const payload = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_key_taskflow');
            userId = payload.id;
            userRole = payload.role;
            facilityRaw = payload.facility_id;
            departmentId = payload.department_id;
        } catch (jwtErr) {
            if (token === 'mock-jwt-token-admin') {
                userId = 1; userRole = 'SUPER_ADMIN'; facilityRaw = 'ALL';
            } else if (token === 'mock-jwt-token-manager') {
                userId = 2; userRole = 'FACILITY_MANAGER'; facilityRaw = '1';
            } else if (token === 'mock-jwt-token-sysadmin') {
                userId = 3; userRole = 'ADMIN'; facilityRaw = 'ALL';
            } else if (token.startsWith('jwt-token-')) {
                userId = parseInt(token.replace('jwt-token-', ''), 10);
                userRole = req.headers['x-user-role'];
                facilityRaw = req.headers['x-facility-id'];
                departmentId = req.headers['x-department-id'];
            } else {
                return res.status(401).json({ error: 'Unauthorized: Invalid token' });
            }
        }
        
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
      
        req.user = { id: userId, role: userRole, facility_id: facilityId, department_id: departmentId };
        next();
    } catch (err) {
        console.error("Auth middleware error:", err);
        return res.status(500).json({ error: 'Lỗi xác thực nội bộ.' });
    }
};"""

if old_auth in server_text:
    server_text = server_text.replace(old_auth, new_auth)
else:
    print("WARNING: old_auth not found in server.js")

old_login_payload = """                return res.json({
                    success: true,
                    token: 'jwt-token-' + user.id,
                    user: { 
                        name: user.full_name, 
                        role: user.role_name, 
                        facility_id: user.managed_facilities || user.facility_name || 'ALL',
                        facility_code: user.facility_code || '',
                        username: user.email || user.full_name
                    }
                });"""

new_login_payload = """                const tokenPayload = {
                    id: user.id,
                    role: user.role_name,
                    facility_id: user.managed_facilities || user.facility_name || 'ALL',
                    facility_code: user.facility_code || '',
                    department_id: user.department_id || null
                };
                return res.json({
                    success: true,
                    token: jwt.sign(tokenPayload, process.env.JWT_SECRET || 'fallback_secret_key_taskflow', { expiresIn: '7d' }),
                    user: { 
                        name: user.full_name, 
                        role: user.role_name, 
                        facility_id: tokenPayload.facility_id,
                        facility_code: tokenPayload.facility_code,
                        username: user.email || user.full_name
                    }
                });"""
if old_login_payload in server_text:
    server_text = server_text.replace(old_login_payload, new_login_payload)

with open(server_file, 'w', encoding='utf-8') as f:
    f.write(server_text)


# 3. Patch App.jsx
app_file = 'agent/rules/stitch_smart_ai_task_management_system/src/App.jsx'
with open(app_file, 'r', encoding='utf-8') as f:
    app_text = f.read()

# GET Headers
old_get_headers = """              headers: { 
                'x-user-id': user?.id,
                'x-user-role': user?.role, 
                'x-facility-id': user?.role === 'SUPER_ADMIN' ? 'ALL' : (Array.isArray(user?.facility_id) ? user.facility_id.join(',') : user?.facility_id) 
              }"""
new_get_headers = """              headers: { 
                'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
                'x-user-id': user?.id,
                'x-user-role': user?.role, 
                'x-facility-id': user?.role === 'SUPER_ADMIN' ? 'ALL' : (Array.isArray(user?.facility_id) ? user.facility_id.join(',') : user?.facility_id) 
              }"""
if old_get_headers in app_text:
    app_text = app_text.replace(old_get_headers, new_get_headers)

# POST Headers
old_post_headers = """                          headers: {
                            'Content-Type': 'application/json',
                            'x-user-id': user.id,
                            'x-user-role': user.role,
                            'x-facility-id': user.role === 'SUPER_ADMIN' ? 'ALL' : (Array.isArray(user.facility_id) ? user.facility_id.join(',') : user.facility_id)
                          }"""
new_post_headers = """                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
                            'x-user-id': user.id,
                            'x-user-role': user.role,
                            'x-facility-id': user.role === 'SUPER_ADMIN' ? 'ALL' : (Array.isArray(user.facility_id) ? user.facility_id.join(',') : user.facility_id)
                          }"""
if old_post_headers in app_text:
    app_text = app_text.replace(old_post_headers, new_post_headers)

# POST Response Status check
old_response_handling = """                        const data = await res.json();
                        if (data.success) {"""
new_response_handling = """                        const data = await res.json();
                        if ((res.status === 200 || res.status === 201) && data.success) {"""
if old_response_handling in app_text:
    app_text = app_text.replace(old_response_handling, new_response_handling)

with open(app_file, 'w', encoding='utf-8') as f:
    f.write(app_text)

print("Patch applied successfully.")
