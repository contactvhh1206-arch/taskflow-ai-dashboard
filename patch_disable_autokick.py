import re

app_file = 'agent/rules/stitch_smart_ai_task_management_system/src/App.jsx'
with open(app_file, 'r', encoding='utf-8') as f:
    app_text = f.read()

# Update global fetch interceptor (disable auto-kick)
old_interceptor = """  return originalFetch(...args).then(res => {
    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('taskflow_token');
      localStorage.removeItem('taskflow_auth');
      window.location.reload();
    }
    return res;
  });"""

new_interceptor = """  return originalFetch(...args).then(res => {
    if (res.status === 401) {
      // localStorage.removeItem('token');
      // localStorage.removeItem('taskflow_token');
      // localStorage.removeItem('taskflow_auth');
      // window.location.reload();
      console.error('[Interceptor] API bị 401:', res.url);
    }
    return res;
  });"""

if old_interceptor in app_text:
    app_text = app_text.replace(old_interceptor, new_interceptor)
else:
    print("Interceptor replace failed")

# Update login function
old_login = """  const login = (userData, token) => {
    if (userData && userData.role) {
      userData.role = userData.role.trim().toUpperCase();
    }
    localStorage.setItem('taskflow_auth', JSON.stringify({ token, user: userData }));
    if (token) {
        localStorage.setItem('taskflow_token', token);
        localStorage.setItem('token', token);
    }"""

new_login = """  const login = (userData, token) => {
    if (userData && userData.role) {
      userData.role = userData.role.trim().toUpperCase();
    }
    console.log('Token đã lưu:', token);
    localStorage.setItem('taskflow_auth', JSON.stringify({ token, user: userData }));
    if (token) {
        localStorage.setItem('taskflow_token', token);
        localStorage.setItem('token', token);
    }"""

if old_login in app_text:
    app_text = app_text.replace(old_login, new_login)
else:
    print("Login replace failed")

with open(app_file, 'w', encoding='utf-8') as f:
    f.write(app_text)

print("Patch applied.")
