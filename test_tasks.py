import urllib.request, json
req = urllib.request.Request('https://taskflow-ai-dashboard.onrender.com/api/tasks', headers={'x-user-role': 'FACILITY_MANAGER', 'x-facility-id': 'DB41'.encode('utf-8')})
try:
    res = urllib.request.urlopen(req)
    print(res.read().decode('utf-8'))
except Exception as e:
    print(e)
