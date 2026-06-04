import re

with open('backend/server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove the Finance RAG block completely
rag_pattern = re.compile(r'// --- KHỐI QUÉT TÀI CHÍNH \(FINANCE\) ---.*?hasData = true;\s*\}', re.DOTALL)
content = rag_pattern.sub('// --- KHỐI QUÉT TÀI CHÍNH (FINANCE) ĐÃ ĐƯỢC CHUYỂN SANG TOOL CALLING ---', content)

# 2. Add tools to openRouterResponse
fetch_pattern = re.compile(r'(const openRouterResponse = await fetch\("https://openrouter\.ai/api/v1/chat/completions", \{.*?body: JSON\.stringify\(\{.*?messages: messagesForAI)(\n\s*\}\),\n\s*signal: controller\.signal)', re.DOTALL)

tools_injection = r"""\1,
        tools: [
            {
                type: "function",
                function: {
                    name: "get_revenue_report",
                    description: "Lấy báo cáo doanh thu của cơ sở/phòng ban theo thời gian. Dùng tool này BẮT BUỘC KHI NGƯỜI DÙNG HỎI DOANH THU.",
                    parameters: {
                        type: "object",
                        properties: {
                            date_range: { 
                                type: "object", 
                                description: "Khoảng thời gian cần xem (quan trọng: dùng startDate và endDate định dạng YYYY-MM-DD)",
                                properties: {
                                    startDate: { type: "string" },
                                    endDate: { type: "string" }
                                }
                            },
                            facility_code: { 
                                type: "string", 
                                description: "Mã cơ sở cần xem (tùy chọn)." 
                            }
                        },
                        required: ["date_range"]
                    }
                }
            }
        ]\2"""
content = fetch_pattern.sub(tools_injection, content)

# 3. Add Tool Parsing logic in stream
stream_pattern = re.compile(r'(let fullAiResponse = "";\s*let buffer = "";\s*const decoder = new TextDecoder\("utf-8"\);\s*)(for await \(const chunk of openRouterResponse\.body\))', re.DOTALL)
tool_vars = r"""\1let toolCallsMap = {};
    let mainToolName = "";
    \2"""
content = stream_pattern.sub(tool_vars, content)

# 4. Handle tool_calls parsing inside the stream loop
parse_pattern = re.compile(r'(const parsed = JSON\.parse\(trimmedLine\.slice\(6\)\);\s*)(const chunkText = parsed\.choices\?\.\[0\]\?\.delta\?\.content \|\| "";)', re.DOTALL)
tool_parse = r"""\1const delta = parsed.choices?.[0]?.delta;
            if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                    if (!toolCallsMap[tc.index]) toolCallsMap[tc.index] = { id: '', name: '', arguments: '' };
                    if (tc.id) toolCallsMap[tc.index].id = tc.id;
                    if (tc.function?.name) {
                        toolCallsMap[tc.index].name = tc.function.name;
                        mainToolName = tc.function.name;
                    }
                    if (tc.function?.arguments) {
                        toolCallsMap[tc.index].arguments += tc.function.arguments;
                    }
                }
            }
            const chunkText = delta?.content || "";"""
content = parse_pattern.sub(tool_parse, content)

# 5. Execute Tool (Pass 2)
done_pattern = re.compile(r'(// Lệnh #4: Dọn dẹp Buffer Cuối Chu kỳ)', re.DOTALL)
pass2_injection = r"""// 3.5. THỰC THI TOOL NẾU CÓ (TWO-PASS STREAMING)
    if (Object.keys(toolCallsMap).length > 0) {
        let finalArgs = null;
        let toolCallId = null;
        for (const index in toolCallsMap) {
            try {
                let rawArgs = toolCallsMap[index].arguments;
                const firstIdx = rawArgs.indexOf('{');
                const lastIdx = rawArgs.lastIndexOf('}');
                if (firstIdx !== -1 && lastIdx !== -1) {
                    rawArgs = rawArgs.substring(firstIdx, lastIdx + 1);
                }
                finalArgs = JSON.parse(rawArgs);
                toolCallId = toolCallsMap[index].id || 'call_1';
                break;
            } catch(e) {}
        }
        
        if (finalArgs && mainToolName === "get_revenue_report") {
            res.write(`data: ${JSON.stringify({ text: "\n\n⏳ *Hệ thống đang truy xuất dữ liệu doanh thu chính xác từ kho lưu trữ, vui lòng đợi...*\n\n" })}\n\n`);
            
            let result = await executeGetRevenueTool(finalArgs, req.user);
            let toolResultStr = typeof result === 'string' ? result : JSON.stringify(result);
            if (toolResultStr.length > 15000) toolResultStr = toolResultStr.substring(0, 15000) + "...";
            
            messagesForAI.push({
                role: "assistant",
                content: fullAiResponse || "",
                tool_calls: [{ id: toolCallId, type: "function", function: { name: mainToolName, arguments: JSON.stringify(finalArgs) } }]
            });
            messagesForAI.push({
                role: "tool",
                tool_call_id: toolCallId,
                name: mainToolName,
                content: toolResultStr
            });

            const response2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${activeAiConfig.apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ model: activeAiConfig.aiModel || "google/gemini-2.5-flash", stream: true, messages: messagesForAI, tools: tools }),
                signal: controller.signal
            });
            
            if (response2.ok) {
                for await (const chunk of response2.body) {
                    const textChunk = decoder.decode(chunk, { stream: true });
                    buffer += textChunk;
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || "";
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed === 'data: [DONE]') continue;
                        if (trimmed.startsWith('data: ')) {
                            try {
                                const parsed = JSON.parse(trimmed.slice(6));
                                const chunkText = parsed.choices?.[0]?.delta?.content || "";
                                if (chunkText) {
                                    fullAiResponse += chunkText;
                                    res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
                                }
                            } catch(e) {}
                        }
                    }
                }
            }
        }
    }

    \1"""
content = done_pattern.sub(pass2_injection, content)

with open('backend/server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch applied successfully.")
