import re

filepath = 'agent/rules/stitch_smart_ai_task_management_system/src/App.jsx'
with open(filepath, 'r', encoding='utf-8') as f:
    text = f.read()

# Part 1: Insert useEffect
use_effect_code = """  const [selectedTaskComments, setSelectedTaskComments] = useState([]);

  useEffect(() => {
    if (selectedTask) {
      const taskId = selectedTask.id || selectedTask.task_id;
      if (taskId) {
        setSelectedTaskComments([]); // Chống rò rỉ State
        const fetchComments = async () => {
          try {
            const res = await fetch(`https://taskflow-ai-dashboard.onrender.com/api/tasks/${taskId}/comments`, {
              headers: { 
                'x-user-role': user?.role, 
                'x-facility-id': user?.role === 'SUPER_ADMIN' ? 'ALL' : (Array.isArray(user?.facility_id) ? user.facility_id.join(',') : user?.facility_id) 
              }
            });
            const data = await res.json();
            if (data.success) {
              setSelectedTaskComments(data.data);
            }
          } catch (err) {
            console.error("Error fetching comments:", err);
          }
        };
        fetchComments();
      }
    } else {
      setSelectedTaskComments([]);
    }
  }, [selectedTask?.id, selectedTask?.task_id, user]);
"""
text = text.replace("  const [selectedTaskComments, setSelectedTaskComments] = useState([]);\n", use_effect_code)


# Part 2: Fix optimistic update (remove fake UI, append returned data)
old_submit = """                        if (data.success) {
                          setChatInput('');
                          const fetchRes = await fetch(`https://taskflow-ai-dashboard.onrender.com/api/tasks/${taskId}/comments`, {
                            headers: { 'x-user-role': user.role, 'x-facility-id': user.role === 'SUPER_ADMIN' ? 'ALL' : (Array.isArray(user.facility_id) ? user.facility_id.join(',') : user.facility_id) }
                          });
                          const fetchJson = await fetchRes.json();
                          if (fetchJson.success) setSelectedTaskComments(fetchJson.data);
                          setTasks(tasks.map(t => t.id === selectedTask.id ? { ...t, comments_count: parseInt(t.comments_count || 0) + 1, latest_comment: chatInput, latest_comment_user_id: user.id } : t));
                          setTimeout(() => {
                            const el = document.getElementById('comments-scroll-container');
                            if (el) el.scrollTop = el.scrollHeight;
                          }, 100);
                        }"""

new_submit = """                        if (data.success) {
                          setChatInput('');
                          // CẬP NHẬT GIAO DIỆN KHI BACKEND ĐÃ TRẢ VỀ DATA THÀNH CÔNG
                          setSelectedTaskComments(prev => [...prev, data.data]);
                          
                          setTasks(tasks.map(t => t.id === selectedTask.id ? { ...t, comments_count: parseInt(t.comments_count || 0) + 1, latest_comment: chatInput, latest_comment_user_id: user.id } : t));
                          setTimeout(() => {
                            const el = document.getElementById('comments-scroll-container');
                            if (el) el.scrollTop = el.scrollHeight;
                          }, 100);
                        }"""
text = text.replace(old_submit, new_submit)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(text)

print("App.jsx patched successfully.")
