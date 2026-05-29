import sys

with open('agent/rules/stitch_smart_ai_task_management_system/src/App.jsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
in_hack_block = False

hack_replacement = """               // HACK: Auto-correct tasks incorrectly assigned to DUBAI 41 by old backend
                fetchedTasks = fetchedTasks.map(t => {
                   if (t.facility === 'DUBAI 41' || t.facilityId === 'DUBAI 41' || t.facility === 'HQ' || !t.facility || t.facilityId === 'ALL') {
                       if (user?.role === 'DEPARTMENT_HEAD' || user?.role === 'FINANCE_DEPT') {
                           const myDept = user?.department_id || (user?.role === 'FINANCE_DEPT' ? 'FINANCE' : 'TRUYEN_THONG');
                           const myDeptName = myDept === 'FINANCE' ? 'Phòng Kế toán' : 'Phòng Truyền thông';
                           return { ...t, facility: myDeptName, facilityId: myDept, department_tag: myDept };
                       }
                       const picStr = String(t.pic).toLowerCase();
                       const picIdStr = String(t.picId || '').toLowerCase();
                       if (picIdStr === '@thien' || picStr === 'thiện' || picIdStr === '@cuong' || picStr === 'cường' || picIdStr === 'truyen_thong' || picStr.includes('truyen_thong')) {
                           return { ...t, facility: 'Phòng Truyền thông', facilityId: 'TRUYEN_THONG', department_tag: 'TRUYEN_THONG' };
                       }
                       if (picIdStr === 'ketoan' || picStr.includes('kế toán')) {
                           return { ...t, facility: 'Phòng Finance', facilityId: 'FINANCE', department_tag: 'FINANCE' };
                       }
                       if (picStr.includes('phó') || picStr.includes('bgd') || picStr.includes('giám đốc')) {
                           return { ...t, facility: 'Ban Giám Đốc', facilityId: 'BGD', department_tag: 'BGD' };
                       }
                   }
                   return t;
                });
"""

for line in lines:
    if "// HACK: Auto-correct tasks incorrectly assigned to DUBAI 41 by old backend" in line:
        in_hack_block = True
        new_lines.append(hack_replacement)
        continue
    
    if in_hack_block:
        if "return t;" in line and "});" in lines[lines.index(line)+1]:
            # This is the end of the hack block. Skip the next line as well.
            pass
        elif "});" in line and "return t;" in lines[lines.index(line)-1]:
            in_hack_block = False
        continue
        
    new_lines.append(line)

with open('agent/rules/stitch_smart_ai_task_management_system/src/App.jsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("HACK block replaced successfully.")
