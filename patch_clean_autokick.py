import re

app_file = 'agent/rules/stitch_smart_ai_task_management_system/src/App.jsx'
with open(app_file, 'r', encoding='utf-8') as f:
    app_text = f.read()

# 1. Restore auto-kick
old_interceptor = """    if (res.status === 401) {
      // localStorage.removeItem('token');
      // localStorage.removeItem('taskflow_token');
      // localStorage.removeItem('taskflow_auth');
      // window.location.reload();
      console.error('[Interceptor] API bị 401:', res.url);
    }"""
new_interceptor = """    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('taskflow_token');
      localStorage.removeItem('taskflow_auth');
      window.location.reload();
    }"""
if old_interceptor in app_text:
    app_text = app_text.replace(old_interceptor, new_interceptor)
else:
    print("WARNING: Could not find interceptor block to replace")

# 2. Remove console.logs
app_text = re.sub(r'[ \t]*console\.log\([\'"]Token gửi đi:[\'"].*\n', '', app_text)
app_text = re.sub(r'[ \t]*console\.log\([\'"]Token đã lưu:[\'"].*\n', '', app_text)

with open(app_file, 'w', encoding='utf-8') as f:
    f.write(app_text)

print("App.jsx cleaned")
