import re

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

# Define the new block
new_block = """
        // ==========================================
        // NHỊP 3.5: THỰC THI TOOL VÀ FAIL-FAST
        // ==========================================
        if (toolCallName === "create_system_task" && toolCallArguments) {
            try {
                // Parse chuỗi arguments đã được nối hoàn chỉnh
                const args = JSON.parse(toolCallArguments);
                
                // Thực thi hàm chuẩn bảo mật
                const result = await executeCreateTaskTool(args, req.user);
                const toolResultStr = JSON.stringify(result);
                
                // NẾU THÀNH CÔNG: Mới ép kết quả vào mảng và gọi AI lần 2
                messages.push({
                    role: "assistant",
                    content: null,
                    tool_calls: [{
                        id: toolCallId || "call_generated",
                        type: "function",
                        function: { name: toolCallName, arguments: toolCallArguments }
                    }]
                });
                messages.push({
                    role: "tool",
                    tool_call_id: toolCallId || "call_generated",
                    name: toolCallName,
                    content: toolResultStr
                });

                // ==========================================
                // GỌI AI LẦN 2 (CHỈ KHI THÀNH CÔNG)
                // ==========================================
                const response2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: { 
                        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY || OPENROUTER_API_KEY}`, 
                        "Content-Type": "application/json" 
                    },
                    body: JSON.stringify({
                        model: "openai/gpt-4o-mini",
                        messages: messages,
                        stream: true,
                        stream_options: { include_usage: true }
                    })
                });

                if (response2.ok) {
                    reader = response2.body.getReader();
                    decoder = new TextDecoder("utf-8");
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        const chunk = decoder.decode(value, { stream: true });
                        const lines = chunk.split(String.fromCharCode(10));
                        
                        for (const line of lines) {
                            if (line.startsWith("data: ") && line !== "data: [DONE]") {
                                try {
                                    const parsed = JSON.parse(line.substring(6));
                                    if (parsed.usage) {
                                        promptTokens += parsed.usage.prompt_tokens || 0;
                                        completionTokens += parsed.usage.completion_tokens || 0;
                                    }
                                    if (parsed.choices && parsed.choices.length > 0) {
                                        const contentChunk = parsed.choices[0].delta?.content || "";
                                        if (contentChunk) {
                                            aiReplyContent += contentChunk;
                                            res.write(`data: ${JSON.stringify({ content: contentChunk })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                                        }
                                    }
                                } catch (e) {}
                            }
                        }
                    }
                }

            } catch (err) {
                // [FAIL-FAST LỆNH PO]: Dính RBAC hoặc Lỗi Data -> Báo thẳng về UI và NGẮT STREAM
                console.error("Tool Execution Error:", err.message);
                res.write(`data: ${JSON.stringify({ error: err.message })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                res.write(`data: [DONE]${String.fromCharCode(10)}${String.fromCharCode(10)}`);
                return res.end(); // Kết thúc hàm tại đây, không gọi LLM lần 2!
            }
        }

        // Kết thúc luồng stream an toàn
        if (!res.writableEnded) {
            res.write(`data: [DONE]${String.fromCharCode(10)}${String.fromCharCode(10)}`);
            res.end();
        }

        // ==========================================
        // NHỊP 4: LƯU DB & GHI LOG BẢO MẬT
"""

pattern = r"// ==========================================\s*// NHỊP 3\.5: THỰC THI TOOL VÀ GỌI LẠI AI \(LẦN 2\)\s*// ==========================================.*?// ==========================================\s*// NHỊP 4: LƯU DB & GHI LOG BẢO MẬT"

text = re.sub(pattern, new_block, text, flags=re.DOTALL)

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Fail-fast patch applied successfully!")
