import os
import json
import urllib.request
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("OPENROUTER_API_KEY")

payload = {
    "model": "google/gemini-3.1-pro-preview",
    "messages": [
        {"role": "user", "content": "doanh thu tháng 5"},
        {
            "role": "assistant",
            "content": " ",
            "tool_calls": [{
                "id": "call_123",
                "type": "function",
                "function": {
                    "name": "fetch_financial_reports",
                    "arguments": "{}"
                }
            }]
        },
        {
            "role": "tool",
            "tool_call_id": "call_123",
            "name": "fetch_financial_reports",
            "content": "Doanh thu: 1000"
        }
    ],
    "max_tokens": 4096
}

req = urllib.request.Request(
    "https://openrouter.ai/api/v1/chat/completions",
    data=json.dumps(payload).encode('utf-8'),
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
)

try:
    with urllib.request.urlopen(req) as response:
        res = response.read()
        print("SUCCESS:", res.decode('utf-8'))
except urllib.error.HTTPError as e:
    print("HTTP ERROR:", e.code, e.read().decode('utf-8'))
except Exception as e:
    print("ERROR:", str(e))
