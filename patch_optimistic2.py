import sys

with open('agent/rules/stitch_smart_ai_task_management_system/src/App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

target_block = """        const data = await res.json();
        if (data.success) {
          setTasks(prev => [data.data, ...prev]);
          showToast('Tạo công việc thành công');
        } else {
          throw new Error(data.error || 'Lỗi server');
        }
      } catch (e) {
        console.error("Fallback offline create task:", e);
        const fallbackTask = {
          id: Date.now(),
          pic: user.name,
          deadline: new Date().toISOString().split('T')[0],
          urgent: false,
          facility: user.role === 'SUPER_ADMIN' ? 'HQ' : user.facility_id,
          creator_role: user.role,
            desc: (newTask.desc || "") + " <!--cr:" + user.role + "-->",
          status: 'todo',
          ...newTask
        };
        setTasks(prev => [fallbackTask, ...prev]);"""

# Sometimes the utf-8 characters might have small differences or the newlines are \r\n vs \n
# To be absolutely sure, let's just find the start and end indices using shorter substrings

start_str = "const data = await res.json();\n        if (data.success) {\n          setTasks(prev => [data.data, ...prev]);"
if start_str not in content:
    start_str = start_str.replace('\n', '\r\n')

end_str = "setTasks(prev => [fallbackTask, ...prev]);"

start_idx = content.find("const data = await res.json();")
end_idx = content.find(end_str) + len(end_str)

if start_idx != -1 and end_idx != -1:
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
    
    new_content = content[:start_idx] + replacement + content[end_idx:]
    with open('agent/rules/stitch_smart_ai_task_management_system/src/App.jsx', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Patched successfully via index.")
else:
    print("Could not find block.")
