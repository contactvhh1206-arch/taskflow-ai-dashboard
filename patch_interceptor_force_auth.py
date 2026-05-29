import re

app_file = 'agent/rules/stitch_smart_ai_task_management_system/src/App.jsx'
with open(app_file, 'r', encoding='utf-8') as f:
    app_text = f.read()

old_interceptor = """// --- GLOBAL FETCH INTERCEPTOR ---
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  let [resource, config] = args;
  
  if (typeof resource === 'string' && resource.includes('/api/')) {
    config = config || {};
    config.headers = config.headers || {};
    
    const token = localStorage.getItem('token');
    if (token) {
      if (config.headers instanceof Headers) {
        if (!config.headers.has('Authorization') && !config.headers.has('authorization')) {
            config.headers.set('Authorization', `Bearer ${token}`);
        }
      } else {
        // Plain object
        const hasAuth = Object.keys(config.headers).some(k => k.toLowerCase() === 'authorization');
        if (!hasAuth) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
      }
    }
    args[1] = config;
  }
  
  return originalFetch(...args).then(res => {"""

new_interceptor = """// --- GLOBAL FETCH INTERCEPTOR ---
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  let [resource, config] = args;
  
  if (typeof resource === 'string' && resource.includes('/api/')) {
    config = config || {};
    config.headers = config.headers || {};
    
    let token = localStorage.getItem('token') || localStorage.getItem('taskflow_token');
    if (!token || token === 'undefined' || token === 'null') {
      try {
        const authData = JSON.parse(localStorage.getItem('taskflow_auth') || '{}');
        if (authData.token) token = authData.token;
      } catch(e) {}
    }
    
    console.log("Token gửi đi:", token);
    
    if (token && token !== 'undefined' && token !== 'null') {
      if (config.headers instanceof Headers) {
        config.headers.set('Authorization', `Bearer ${token}`);
      } else {
        // Force overwrite the garbage Authorization header passed by callers
        Object.keys(config.headers).forEach(k => {
          if (k.toLowerCase() === 'authorization') delete config.headers[k];
        });
        config.headers['Authorization'] = `Bearer ${token}`;
      }
    } else {
      if (config.headers instanceof Headers) {
        config.headers.delete('Authorization');
      } else {
        Object.keys(config.headers).forEach(k => {
          if (k.toLowerCase() === 'authorization') delete config.headers[k];
        });
      }
    }
    args[1] = config;
  }
  
  return originalFetch(...args).then(res => {"""

if old_interceptor in app_text:
    app_text = app_text.replace(old_interceptor, new_interceptor)
    with open(app_file, 'w', encoding='utf-8') as f:
        f.write(app_text)
    print("Interceptor patched successfully.")
else:
    print("Could not find the old interceptor.")
