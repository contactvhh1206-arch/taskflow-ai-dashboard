import sys

with open('agent/rules/stitch_smart_ai_task_management_system/src/App.jsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

replacement_lines = """      const data = await res.json();
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
        facility: fallbackFac,
        creator_role: user.role,
        desc: (newTask.desc || "") + " <!--cr:" + user.role + "-->",
        status: 'todo',
        ...newTask
      };
      setTasks(prev => [fallbackTask, ...prev]);
"""

# The lines to replace are from line 755 to line 777 inclusive.
# In Python (0-indexed), that's index 754 to 777.
new_lines = lines[:754] + [replacement_lines] + lines[777:]

with open('agent/rules/stitch_smart_ai_task_management_system/src/App.jsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
    
print("Replaced lines successfully!")
