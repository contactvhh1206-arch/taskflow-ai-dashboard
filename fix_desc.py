import re

with open('agent/rules/stitch_smart_ai_task_management_system/src/App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace {selectedTask.desc} with stripped version
content = content.replace('{selectedTask.desc}', "{selectedTask.desc?.replace(/<!--cr:.*?-->/g, '').trim()}")

# Replace {task.desc} with stripped version
content = content.replace('{task.desc}', "{task.desc?.replace(/<!--cr:.*?-->/g, '').trim()}")

with open('agent/rules/stitch_smart_ai_task_management_system/src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Replaced desc to hide cr tags")
