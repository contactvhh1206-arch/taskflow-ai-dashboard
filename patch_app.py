import re

with open('frontend/src/App.jsx', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# Snippet 4: Add isLocalLocked flag
if 'const isLocalLocked' not in content:
    content = content.replace(
        'function TaskCreationModal({ onClose, onSave, defaultStatus, user }) {',
        "function TaskCreationModal({ onClose, onSave, defaultStatus, user }) {\n  const isLocalLocked = ['FACILITY_MANAGER', 'DEPARTMENT_HEAD', 'FINANCE_DEPT', 'ADMIN'].includes(user.role);"
    )

# Snippet 5: fetchUsers filter replacement
old_filter = """        let filtered = [];
        if (['SUPER_ADMIN', 'VICE_PRESIDENT', 'ADMIN'].includes(user.role)) {
          filtered = allUsers;
        } else {
          filtered = allUsers.filter(u => 
            (u.facility_id && user.facility_id && u.facility_id === user.facility_id) || 
            (u.facility_name && user.facility_name && u.facility_name === user.facility_name)
          );
        }
        setPicOptions(filtered);"""

new_filter = """        let filtered = [];
        if (['SUPER_ADMIN', 'VICE_PRESIDENT'].includes(user.role)) {
          filtered = allUsers;
        } else if (['DEPARTMENT_HEAD', 'FINANCE_DEPT', 'ADMIN'].includes(user.role)) {
          filtered = allUsers.filter(u => u.department_code === user.department_code || u.department_id === user.department_id);
        } else {
          filtered = allUsers.filter(u => u.facility_id === user.facility_id);
        }
        setPicOptions(filtered);"""

content = content.replace(old_filter, new_filter)

old_filter_fallback = """        let filtered = [];
        if (['SUPER_ADMIN', 'VICE_PRESIDENT', 'ADMIN'].includes(user.role)) {
          filtered = allUsers;
        } else {
          filtered = allUsers.filter(u => 
            (u.facility_id && user.facility_id && u.facility_id === user.facility_id) || 
            (u.facility_name && user.facility_name && u.facility_name === user.facility_name)
          );
        }
        setPicOptions(filtered);"""
        
content = content.replace(old_filter_fallback, new_filter)

# Snippet 6: Facility Dropdown replacement
old_select = """                <select name="facility" value={formData.facility} onChange={handleChange} className="w-full pl-9 pr-4 py-2.5 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none transition-all dark:text-white truncate">
                  <option value="">-- Tự động --</option>
                  {(filteredFacilities || []).map(f => (
                    <option key={f.id || f.name} value={f.name}>{f.name}</option>
                  ))}
                  {availableDepts.includes('HQ') && <option value="HQ">Ban Giám đốc (HQ)</option>}
                  {availableDepts.includes('MARKETING') && <option value="MARKETING">Phòng Truyền thông</option>}
                  {availableDepts.includes('FINANCE') && <option value="FINANCE">Phòng Kế toán</option>}
                </select>"""

new_select = """                <select name="facility" value={formData.facility} onChange={handleChange} className="w-full pl-9 pr-4 py-2.5 bg-surface-container-low dark:bg-[#252525] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none transition-all dark:text-white truncate">
                  <option value="">-- Tự động --</option>
                  {isLocalLocked ? (
                    <option value={user.facility_id || user.department_code || user.department_id}>
                      {user.facility_name || user.department_code || user.department_id || "Khu vực của bạn"}
                    </option>
                  ) : (
                    <>
                      {(filteredFacilities || []).map(f => (
                        <option key={f.id || f.name} value={f.name}>{f.name}</option>
                      ))}
                      {availableDepts.includes('HQ') && <option value="HQ">Ban Giám đốc (HQ)</option>}
                      {availableDepts.includes('MARKETING') && <option value="MARKETING">Phòng Truyền thông</option>}
                      {availableDepts.includes('FINANCE') && <option value="FINANCE">Phòng Kế toán</option>}
                    </>
                  )}
                </select>"""

content = content.replace(old_select, new_select)

with open('frontend/src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
