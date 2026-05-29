import re

# Patch App.jsx
app_file = 'agent/rules/stitch_smart_ai_task_management_system/src/App.jsx'
with open(app_file, 'r', encoding='utf-8') as f:
    app_text = f.read()

fetch_interceptor = """// --- GLOBAL FETCH INTERCEPTOR ---
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
  
  return originalFetch(...args);
};
// ---------------------------------

const getStatusConfig = (status) => {"""

if "GLOBAL FETCH INTERCEPTOR" not in app_text:
    app_text = app_text.replace('const getStatusConfig = (status) => {', fetch_interceptor)
    with open(app_file, 'w', encoding='utf-8') as f:
        f.write(app_text)
    print("Interceptor injected.")
else:
    print("Interceptor already exists.")
