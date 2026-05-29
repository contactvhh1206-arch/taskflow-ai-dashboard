import re

filepath = 'agent/rules/stitch_smart_ai_task_management_system/src/App.jsx'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the onClick handler for the send-comment-btn
old_code = """                    <button id="send-comment-btn" onClick={async () => {
                      if (!chatInput.trim()) return;
                      try {
                        const res = await fetch(`https://taskflow-ai-dashboard.onrender.com/api/tasks/${selectedTask.id}/comments`, {"""

new_code = """                    <button id="send-comment-btn" onClick={async () => {
                      if (!chatInput.trim()) return;
                      // Lấy ID an toàn
                      const taskId = selectedTask?.id || selectedTask?.task_id;
                      console.log("DEBUG taskId trước khi gửi comment:", taskId);
                      if (!taskId || taskId === 'undefined') {
                          console.error("Lỗi: Không tìm thấy ID của task đang mở!");
                          return;
                      }
                      
                      try {
                        const res = await fetch(`https://taskflow-ai-dashboard.onrender.com/api/tasks/${taskId}/comments`, {"""

# Also replace the second fetch inside the same block (refreshing comments)
old_code_2 = """                          const fetchRes = await fetch(`https://taskflow-ai-dashboard.onrender.com/api/tasks/${selectedTask.id}/comments`, {"""

new_code_2 = """                          const fetchRes = await fetch(`https://taskflow-ai-dashboard.onrender.com/api/tasks/${taskId}/comments`, {"""

content = content.replace(old_code, new_code)
content = content.replace(old_code_2, new_code_2)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("App.jsx patched successfully.")
