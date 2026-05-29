import re

with open('agent/rules/stitch_smart_ai_task_management_system/src/App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: Form Data default facility
form_replacement = """const [formData, setFormData] = useState({
      title: '',
      desc: '',
      pic: user.name,
      facility: user?.role === 'DEPARTMENT_HEAD' ? (user?.department_id || 'TRUYEN_THONG') : (user?.role === 'FINANCE_DEPT' ? 'FINANCE' : ''),
      deadline: new Date().toISOString().slice(0, 16),"""
      
content = re.sub(
    r"const \[formData, setFormData\] = useState\(\{\n\s*title: '',\n\s*desc: '',\n\s*pic: user\.name,\n\s*facility: '',\n\s*deadline: new Date\(\)\.toISOString\(\)\.slice\(0, 16\),",
    form_replacement,
    content
)

# Fix 2: HACK logic
hack_replacement = """// HACK: Auto-correct tasks incorrectly assigned to DUBAI 41 by old backend
                fetchedTasks = fetchedTasks.map(t => {
                   if (t.facility === 'DUBAI 41' || t.facilityId === 'DUBAI 41' || t.facility === 'HQ' || !t.facility || t.facilityId === 'ALL') {
                       // Mặc định ép về phòng ban của user nếu user là DEPARTMENT_HEAD
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
                });"""

content = re.sub(
    r"// HACK: Auto-correct tasks incorrectly assigned to DUBAI 41 by old backend[\s\S]*?return t;\n                \}\);",
    hack_replacement,
    content
)

with open('agent/rules/stitch_smart_ai_task_management_system/src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("App.jsx patched for modal facility and fallback.")
