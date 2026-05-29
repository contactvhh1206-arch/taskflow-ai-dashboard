import re

app_file = 'agent/rules/stitch_smart_ai_task_management_system/src/App.jsx'
with open(app_file, 'r', encoding='utf-8') as f:
    app_text = f.read()

# Update global fetch interceptor
old_fetch = """  return originalFetch(...args);
};
// ---------------------------------"""

new_fetch = """  return originalFetch(...args).then(res => {
    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('taskflow_token');
      localStorage.removeItem('taskflow_auth');
      window.location.reload();
    }
    return res;
  });
};
// ---------------------------------"""

if old_fetch in app_text:
    app_text = app_text.replace(old_fetch, new_fetch)

# Update login function
old_login = """  const login = (userData, token) => {
    if (userData && userData.role) {
      userData.role = userData.role.trim().toUpperCase();
    }
    localStorage.setItem('taskflow_auth', JSON.stringify({ token, user: userData }));
    if (token) localStorage.setItem('taskflow_token', token);"""

new_login = """  const login = (userData, token) => {
    if (userData && userData.role) {
      userData.role = userData.role.trim().toUpperCase();
    }
    localStorage.setItem('taskflow_auth', JSON.stringify({ token, user: userData }));
    if (token) {
        localStorage.setItem('taskflow_token', token);
        localStorage.setItem('token', token);
    }"""

if old_login in app_text:
    app_text = app_text.replace(old_login, new_login)

# Update logout function
old_logout = """  const logout = () => {
    localStorage.removeItem('taskflow_auth');
    localStorage.removeItem('taskflow_token');"""

new_logout = """  const logout = () => {
    localStorage.removeItem('taskflow_auth');
    localStorage.removeItem('taskflow_token');
    localStorage.removeItem('token');"""

if old_logout in app_text:
    app_text = app_text.replace(old_logout, new_logout)

with open(app_file, 'w', encoding='utf-8') as f:
    f.write(app_text)

print("App.jsx patched for tokens and 401 redirect")
