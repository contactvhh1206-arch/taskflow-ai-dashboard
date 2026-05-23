import os
import re

preview_path = 'preview.html'
components_dir = os.path.join('src', 'components')

if not os.path.exists(components_dir):
    os.makedirs(components_dir)

with open(preview_path, 'r', encoding='utf-8') as f:
    content = f.read()

components_to_extract = [
    'AdminConfigPanel',
    'ApiConfigPanel',
    'AIUsageLogs',
    'RAGManagerPanel',
    'FacilityDashboard',
    'RevenueOverviewDashboard',
    'KPISettings',
    'ArchivedFacilitiesDashboard',
    'DailyReport'
]

for name in components_to_extract:
    # First, find "function Name("
    match = re.search(r'function\s+' + name + r'\s*\(', content)
    if not match:
        print(f"Could not find {name}")
        continue
        
    start_index = match.start()
    end_index = match.end() - 1 # This points to '('
    
    # Balance parentheses
    paren_count = 1
    end_index += 1
    while end_index < len(content) and paren_count > 0:
        if content[end_index] == '(':
            paren_count += 1
        elif content[end_index] == ')':
            paren_count -= 1
        end_index += 1
        
    # Now find the first '{' after ')'
    while end_index < len(content) and content[end_index] != '{':
        end_index += 1
        
    if end_index >= len(content):
        continue
        
    # Now balance braces
    brace_count = 1
    end_index += 1
    in_string = False
    string_char = ''
    
    while brace_count > 0 and end_index < len(content):
        char = content[end_index]
        
        if in_string:
            if char == string_char and content[end_index - 1] != '\\':
                in_string = False
        else:
            if char in '"\'`':
                in_string = True
                string_char = char
            elif char == '{':
                brace_count += 1
            elif char == '}':
                brace_count -= 1
        end_index += 1
        
    component_code = content[start_index:end_index]
    
    file_content = "import React, { useState, useEffect, useRef } from 'react';\n\nexport default " + component_code + "\n"
    
    with open(os.path.join(components_dir, f"{name}.jsx"), 'w', encoding='utf-8') as f:
        f.write(file_content)
        
    print(f"Successfully extracted {name}.jsx")

