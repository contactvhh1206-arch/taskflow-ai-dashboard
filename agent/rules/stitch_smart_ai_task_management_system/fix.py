import os

filepath = r'c:\Users\Hoang\Desktop\hub-dubai\agent\rules\stitch_smart_ai_task_management_system\src\components\RevenueOverviewDashboard.jsx'

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

index = content.find('function KPISettings')
if index != -1:
    # We want to keep everything up to the `}` right before `function KPISettings`
    # Let's find the closing brace. Actually `extract.py` might have added a closing brace? No.
    # We just slice up to `index`
    content = content[:index]
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
        print("Truncated RevenueOverviewDashboard.jsx")
else:
    print("function KPISettings not found in RevenueOverviewDashboard.jsx")
