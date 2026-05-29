import re

with open('agent/rules/stitch_smart_ai_task_management_system/src/App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

replacement = """        const data = await res.json();
        if (data.success) {
          let newTaskData = data.data;
          if (newTaskData.facility === 'TRUYEN_THONG') newTaskData.facility = 'Phòng Truyền thông';
          if (newTaskData.facility === 'FINANCE') newTaskData.facility = 'Phòng Kế toán';
          if (newTaskData.facility === 'BGD') newTaskData.facility = 'Ban Giám Đốc';
          
          setTasks(prev => [newTaskData, ...prev]);
          showToast('Tạo công việc thành công');
        } else {
          throw new Error(data.error || 'Lỗi server');
        }
      } catch (e) {
        console.error("Fallback offline create task:", e);
        
        let fallbackFac = newTask.facility || (user.role === 'SUPER_ADMIN' ? 'HQ' : user.facility_id);
        if (fallbackFac === 'TRUYEN_THONG') fallbackFac = 'Phòng Truyền thông';
        if (fallbackFac === 'FINANCE') fallbackFac = 'Phòng Kế toán';
        if (fallbackFac === 'BGD') fallbackFac = 'Ban Giám Đốc';

        const fallbackTask = {
          id: Date.now(),
          pic: user.name,
          deadline: new Date().toISOString().split('T')[0],
          urgent: false,
          creator_role: user.role,
          status: 'todo',
          ...newTask,
          facility: fallbackFac
        };
        setTasks(prev => [fallbackTask, ...prev]);"""

content = re.sub(
    r"        const data = await res\.json\(\);\n        if \(data\.success\) \{\n          setTasks\(prev => \[data\.data, \.\.\.prev\]\);\n          showToast\('T.o công vi.c thành công'\);\n        \} else \{\n          throw new Error\(data\.error \|\| 'L.i server'\);\n        \}\n      \} catch \(e\) \{\n        console\.error\(\"Fallback offline create task:\", e\);\n        const fallbackTask = \{\n          id: Date\.now\(\),\n          pic: user\.name,\n          deadline: new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\],\n          urgent: false,\n          facility: user\.role === 'SUPER_ADMIN' \? 'HQ' : user\.facility_id,\n          creator_role: user\.role,\n            desc: \(newTask\.desc \|\| \"\"\) \+ \" <!--cr:\" \+ user\.role \+ \"-->\",\n          status: 'todo',\n          \.\.\.newTask\n        \};\n        setTasks\(prev => \[fallbackTask, \.\.\.prev\]\);",
    replacement,
    content
)

with open('agent/rules/stitch_smart_ai_task_management_system/src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Optimistic UI update patched.")
