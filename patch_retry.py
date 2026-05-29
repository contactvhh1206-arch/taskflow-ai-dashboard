import re

with open('agent/rules/stitch_smart_ai_task_management_system/src/App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

target = r"signal: ctrl\.signal,\n\s*onmessage\(ev\) \{"
replacement = r"""signal: ctrl.signal,
            async onopen(response) {
              if (response.ok) return;
              if (response.status >= 400 && response.status < 600) {
                throw new Error("HTTP " + response.status); // Stop on 404/500
              }
            },
            onmessage(ev) {"""

content = re.sub(target, replacement, content, count=1)

target2 = r"onerror\(err\) \{\n\s*ctrl\.abort\(\); // ngắt kết nối tĩnh lặng, không spam error\n\s*\}"
replacement2 = r"""onerror(err) {
              ctrl.abort();
              throw err; // Stop retry
            }"""

content = re.sub(target2, replacement2, content, count=1)

with open('agent/rules/stitch_smart_ai_task_management_system/src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patched App.jsx with anti-retry logic")
