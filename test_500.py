import urllib.request, urllib.error
req = urllib.request.Request('https://taskflow-ai-dashboard.onrender.com/api/tasks', headers={'x-user-role': 'FACILITY_MANAGER', 'x-facility-id': 'DB41'.encode('utf-8')})
try:
    urllib.request.urlopen(req)
except urllib.error.HTTPError as e:
    open('error.json', 'w', encoding='utf-8').write(e.read().decode('utf-8'))
