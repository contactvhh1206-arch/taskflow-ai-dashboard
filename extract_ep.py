import re

with open('backend/server.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

endpoints = ['app.patch(\'/api/tasks/:id/restore\'', 'app.put(\'/api/tasks/:id/status\'', 'app.put(\'/api/tasks/:id/support\'', 'app.post(\'/api/tasks/:id/comments\'', 'app.post(\'/api/tasks\'']

for i, ep in enumerate(endpoints):
    start_idx = content.find(ep)
    if start_idx != -1:
        # find the next app. or EOF
        end_idx = content.find('\napp.', start_idx + 10)
        if end_idx == -1: end_idx = len(content)
        
        with open(f'endpoint_{i}.js', 'w', encoding='utf-8') as out:
            out.write(content[start_idx:end_idx])
