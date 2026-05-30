import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace the first payload and fetch block (around line 2431-2506)
old_fetch1 = r"""        const messages = \[
            \{ role: "system", content: finalSystemPrompt \},
            \.\.\.chatHistory,
            \{ role: "user", content: userMessage \}
        \];

        // ==========================================
        // NHáº¬P 3: SSE STREAMING Vá»šI TOOL CALL
        // ==========================================
        res\.setHeader\('Content-Type', 'text/event-stream; charset=utf-8'\); 
        res\.setHeader\('Cache-Control', 'no-cache'\);
        res\.setHeader\('Connection', 'keep-alive'\);
        res\.flushHeaders\(\); 

        const tools = \[(.*?)\];

        const response = await fetch\("https://openrouter\.ai/api/v1/chat/completions", \{.*?\}\);

        if \(!response\.ok\) \{.*?return res\.end\(\);\s*\}"""

new_fetch1 = """        const tools = [\\1];

        // ==========================================
        // BƯỚC 3.1: LẮP RÁP PAYLOAD CHUẨN MỰC
        // ==========================================
        const messagesPayload = [
            { role: 'system', content: finalSystemPrompt },
            ...chatHistory,
            { role: 'user', content: userMessage }
        ];

        const openRouterPayload = {
            model: process.env.AI_MODEL || 'google/gemini-2.5-pro', 
            messages: messagesPayload,
            tools: tools,
            stream: true
        };

        // ==========================================
        // BƯỚC 3.2: MỞ CỔNG SSE GIỮ KẾT NỐI CLIENT (CHỐNG TIMEOUT)
        // ==========================================
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders(); 

        // ==========================================
        // BƯỚC 3.3: GỌI OPENROUTER API & BẮT LỖI TẦNG MẠNG
        // ==========================================
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
                'X-Title': 'TaskFlow AI Dashboard',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(openRouterPayload)
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("🚨 OpenRouter API Error:", response.status, errText);
            res.write(`data: ${JSON.stringify({ error: "Lỗi kết nối từ AI Core. Vui lòng kiểm tra lại cấu hình." })}\\n\\n`);
            return res.end();
        }"""

content = re.sub(old_fetch1, new_fetch1, content, flags=re.DOTALL)

# 2. Remove the `if (isLocalUser)` block completely and promote the `else` streaming block.
# We will match the start of `let aiReplyContent...` down to `if (isLocalUser)`
old_islocal_block = r"""        let aiReplyContent = "";
        let promptTokens = 0; 
        let completionTokens = 0;
        let toolCallId = null;
        let toolCallName = null;
        let toolCallArguments = "";
        let toolCallsMap = \{\}; 
        let mainToolName = "";

        if \(isLocalUser\) \{
            const data = await response\.json\(\);.*?\} else \{
            // ADMIN STREAMING \(Hỗ trợ Node-fetch / async iteration\)
            if \(!response\.body\) \{"""

new_islocal_block = """        let aiReplyContent = "";
        let promptTokens = 0; 
        let completionTokens = 0;
        let toolCallId = null;
        let toolCallName = null;
        let toolCallArguments = "";
        let toolCallsMap = {}; 
        let mainToolName = "";

        if (!response.body) {"""

content = re.sub(old_islocal_block, new_islocal_block, content, flags=re.DOTALL)

# 3. For Lần 2 (after tool execution), also remove `isLocalUser`
old_fetch2 = r"""                const response2 = await fetch\("https://openrouter\.ai/api/v1/chat/completions", \{
                    method: "POST",
                    headers: \{ 
                        "Authorization": `Bearer \$\{process\.env\.OPENROUTER_API_KEY || OPENROUTER_API_KEY\}`, 
                        "Content-Type": "application/json" 
                    \},
                    body: JSON\.stringify\(\{
                        model: "openai/gpt-4o-mini",
                        messages: messages,
                        stream: !isLocalUser,
                        tools: tools,
                        stream_options: !isLocalUser \? \{ include_usage: true \} : undefined
                    \}\)
                \}\);

                if \(!response2\.ok\) \{.*?return res\.end\(\);\s*\}

                if \(isLocalUser\) \{.*?\} else \{
                    if \(!response2\.body\) \{"""

new_fetch2 = """                // Cập nhật messagesPayload cho lần gọi 2
                messagesPayload.push({
                    role: "assistant",
                    content: aiReplyContent || "",
                    tool_calls: mappedToolCallsForHistory
                });
                for (const tc of mappedToolCallsForHistory) {
                    messagesPayload.push({
                        role: "tool",
                        tool_call_id: tc.id,
                        name: tc.function.name,
                        content: toolResultStr
                    });
                }
                
                openRouterPayload.messages = messagesPayload;

                const response2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: { 
                        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`, 
                        "HTTP-Referer": process.env.APP_URL || 'http://localhost:3000',
                        "X-Title": "TaskFlow AI Dashboard",
                        "Content-Type": "application/json" 
                    },
                    body: JSON.stringify(openRouterPayload)
                });

                if (!response2.ok) {
                    const errText2 = await response2.text();
                    console.error("[CRITICAL] Lỗi OpenRouter Lần 2 (Tràn Token):", errText2);
                    if (typeof keepAliveInterval !== 'undefined') clearInterval(keepAliveInterval);
                    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "\\n\\n❌ *Hệ thống: Dữ liệu quá lớn, AI không thể phân tích hết trong một lần. Xin vui lòng tra cứu riêng từng cơ sở.* \\n\\n" } }] })}\\n\\n`);
                    res.write(`data: [DONE]\\n\\n`);
                    return res.end();
                }

                if (!response2.body) {"""

# First, I need to remove the push messages logic that was right above fetch2
# because I moved it into new_fetch2 logic.
# Wait, let's check what was before response2 fetch:
# "messages.push({ role: 'assistant', ... })"
# I will use replace on the entire block.
old_block_around_fetch2 = r"""                messages\.push\(\{
                    role: "assistant",
                    content: aiReplyContent \|\| "",
                    tool_calls: mappedToolCallsForHistory
                \}\);
                
                // Trả lời kết quả cho TẤT CẢ các tool call id mà AI yêu cầu
                for \(const tc of mappedToolCallsForHistory\) \{
                    messages\.push\(\{
                        role: "tool",
                        tool_call_id: tc\.id,
                        name: tc\.function\.name,
                        content: toolResultStr
                    \}\);
                \}
            \} catch \(dbError\) \{
                console\.error\("\[CRITICAL\] Lỗi chạy Tool DB:", dbError\);
                res\.write\(`data: \$\{JSON\.stringify\(\{ choices: \[\{ delta: \{ content: "\\n\\n❌ \*Hệ thống: Lỗi nội bộ khi truy xuất dữ liệu từ CSDL\.\*" \}, finish_reason: "stop" \}\] \}\)\}\\n\\n`\);
                res\.write\(`data: \[DONE\]\\n\\n`\);
                return res\.end\(\);
            \} finally \{
                clearInterval\(keepAliveInterval\);
            \}

                const response2 = await fetch\("https://openrouter\.ai/api/v1/chat/completions", \{
                    method: "POST",
                    headers: \{ 
                        "Authorization": `Bearer \$\{process\.env\.OPENROUTER_API_KEY \|\| OPENROUTER_API_KEY\}`, 
                        "Content-Type": "application/json" 
                    \},
                    body: JSON\.stringify\(\{
                        model: "openai/gpt-4o-mini",
                        messages: messages,
                        stream: !isLocalUser,
                        tools: tools,
                        stream_options: !isLocalUser \? \{ include_usage: true \} : undefined
                    \}\)
                \}\);

                if \(!response2\.ok\) \{.*?return res\.end\(\);\s*\}

                if \(isLocalUser\) \{.*?\} else \{
                    if \(!response2\.body\) \{"""

new_block_around_fetch2 = """            } catch (dbError) {
                console.error("[CRITICAL] Lỗi chạy Tool DB:", dbError);
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "\\n\\n❌ *Hệ thống: Lỗi nội bộ khi truy xuất dữ liệu từ CSDL.*" }, finish_reason: "stop" }] })}\\n\\n`);
                res.write(`data: [DONE]\\n\\n`);
                return res.end();
            } finally {
                clearInterval(keepAliveInterval);
            }

                // Cập nhật messagesPayload cho lần gọi 2
                messagesPayload.push({
                    role: "assistant",
                    content: aiReplyContent || "",
                    tool_calls: mappedToolCallsForHistory
                });
                for (const tc of mappedToolCallsForHistory) {
                    messagesPayload.push({
                        role: "tool",
                        tool_call_id: tc.id,
                        name: tc.function.name,
                        content: toolResultStr
                    });
                }
                
                openRouterPayload.messages = messagesPayload;

                const response2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: { 
                        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`, 
                        "HTTP-Referer": process.env.APP_URL || 'http://localhost:3000',
                        "X-Title": "TaskFlow AI Dashboard",
                        "Content-Type": "application/json" 
                    },
                    body: JSON.stringify(openRouterPayload)
                });

                if (!response2.ok) {
                    const errText2 = await response2.text();
                    console.error("[CRITICAL] Lỗi OpenRouter Lần 2 (Tràn Token):", errText2);
                    if (typeof keepAliveInterval !== 'undefined') clearInterval(keepAliveInterval);
                    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "\\n\\n❌ *Hệ thống: Dữ liệu quá lớn, AI không thể phân tích hết trong một lần. Xin vui lòng tra cứu riêng từng cơ sở.* \\n\\n" } }] })}\\n\\n`);
                    res.write(`data: [DONE]\\n\\n`);
                    return res.end();
                }

                if (!response2.body) {"""

content = re.sub(old_block_around_fetch2, new_block_around_fetch2, content, flags=re.DOTALL)

# Delete the extra closing braces for the `else` block we removed
# Look for:
#                                 } catch (e) {}
#                             }
#                         }
#                     }
#                 }
#             } // closes if (Object.keys(toolCallsMap).length > 0)
old_end_of_block = r"""                                \} catch \(e\) \{\}
                            \}
                        \}
                    \}
                \}
            \} // closes if \(Object\.keys\(toolCallsMap\)\.length > 0\)"""

new_end_of_block = """                                } catch (e) {}
                            }
                        }
                    }
            } // closes if (Object.keys(toolCallsMap).length > 0)"""

content = re.sub(old_end_of_block, new_end_of_block, content, flags=re.DOTALL)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Refactored streaming architecture successfully!")
