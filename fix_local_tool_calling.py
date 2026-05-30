import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

pattern = re.compile(
    r"if \(msg\.tool_calls && msg\.tool_calls\.length > 0\) \{.*?const tc = msg\.tool_calls\[0\];.*?if \(tc\.id\) toolCallId = tc\.id;.*?if \(tc\.function && tc\.function\.name\) toolCallName = tc\.function\.name;.*?if \(tc\.function && tc\.function\.arguments\) toolCallArguments = tc\.function\.arguments;.*?\}",
    re.DOTALL
)

replacement = """if (msg.tool_calls && msg.tool_calls.length > 0) {
                    msg.tool_calls.forEach((tc, index) => {
                        toolCallsMap[index] = {
                            id: tc.id || '',
                            name: tc.function ? tc.function.name : '',
                            arguments: tc.function ? tc.function.arguments : ''
                        };
                        if (tc.function && tc.function.name) {
                            mainToolName = tc.function.name;
                        }
                    });
                }"""

content = pattern.sub(replacement, content)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Replaced toolCallsMap logic for LocalUser successfully!")
