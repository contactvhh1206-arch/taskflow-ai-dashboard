import re

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Patch formatEmbedding in learn-from-chat
old_learn = """        for (const chunk of chunks) {
            const embedding = await generateEmbedding(chunk);
            
            const insertSql = `
                INSERT INTO company_knowledge_base (content, embedding, source_type, metadata)
                VALUES ($1, $2::vector, $3, $4)
            `;
            await pool.query(insertSql, [
                chunk, 
                JSON.stringify(embedding), 
                'CHAT_LEARNING', 
                JSON.stringify({ 
                    department_code: departmentCode, 
                    source: 'Admin_One_Click' 
                })
            ]);
            successCount++;
        }"""

new_learn = """        for (const chunk of chunks) {
            const embedding = await generateEmbedding(chunk);
            
            const formatEmbedding = `[${embedding.join(',')}]`;
            
            const insertSql = `
                INSERT INTO company_knowledge_base (content, embedding, source_type, metadata)
                VALUES ($1, $2::vector, $3, $4)
            `;
            await pool.query(insertSql, [
                chunk, 
                formatEmbedding, 
                'CHAT_LEARNING', 
                JSON.stringify({ 
                    department_code: departmentCode, 
                    source: 'Admin_One_Click' 
                })
            ]);
            successCount++;
        }"""

text = text.replace(old_learn, new_learn)

# 2. Patch finalSystemPrompt in /api/ai/chat
old_prompt = """        const finalSystemPrompt = "B?n l tr? ly ?o AI Advisor thng minh c?a h? th?ng TaskFlow." + String.fromCharCode(10) + 
                                  (ragContextText ? "D? li?u tham kh?o:" + String.fromCharCode(10) + ragContextText : "") + 
                                  systemPromptAddition;"""

new_prompt = """        let finalSystemPrompt = "B?n l tr? ly ?o AI Advisor thng minh c?a h? th?ng TaskFlow." + String.fromCharCode(10) + 
                                  (ragContextText ? "D? li?u tham kh?o:" + String.fromCharCode(10) + ragContextText : "") + 
                                  systemPromptAddition;
                                  
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'VICE_PRESIDENT' && req.user.role !== 'ADMIN') {
            finalSystemPrompt += String.fromCharCode(10) + "LUU Y B?O M?T: B?n ch? du?c tr? l?i cc cu h?i lin quan st su?n d?n nghi?p v? phng ban c?a ngu?i dng. N?u ngu?i dng h?i da, h?i xm, tn t?nh ho?c h?i cc ki?n th?c ngoi cng vi?c, b?n B?T BU?C ph?i tr? v? dng t? kha: [BLOCK_MISCONDUCT]";
        }"""

# Fix regex match since original code has unicode
text = re.sub(r'const finalSystemPrompt = .*?systemPromptAddition;', new_prompt, text, flags=re.DOTALL)


# 3. Patch Interceptor
old_interceptor = """        // K?t thc lu?ng stream an ton
        if (!res.writableEnded) {
            res.write(`data: [DONE]${String.fromCharCode(10)}${String.fromCharCode(10)}`);
            res.end();
        }

        // ==========================================
        // NH?P 4: LUU DB & GHI LOG B?O M?T"""

new_interceptor = """        // ==========================================
        // M?NG L?C CH?NG H?I XAM & GHI V?T ADMIN
        // ==========================================
        let aiResponse = aiReplyContent;
        if (aiResponse.includes('[BLOCK_MISCONDUCT]')) {
            // B m?t b?n Log v? DB cho Admin truy v?t
            await pool.query(`
                INSERT INTO daily_logs (entry_type, user_id, action_details, created_at)
                VALUES ($1, $2, $3, NOW())
            `, ['SECURITY_ALERT', req.user.id, `Nhn vin h?i xm h? th?ng AI. N?i dung: "${userMessage}"`]);

            // Tr? v? l?i c?nh bo nghim kh?c cho Client qua SSE v ng?t k?t n?i
            res.write(`data: ${JSON.stringify({ error: "H? TH?NG C?NH BAO: Cu h?i c?a b?n vi ph?m tiu chu?n nghi?p v? n?i b?. Hnh vi ny d du?c ghi nh?n v g?i v? ti kho?n Admin d? ti?n hnh truy v?t k? lu?t!" })}${String.fromCharCode(10)}${String.fromCharCode(10)}`);
            res.write(`data: [DONE]${String.fromCharCode(10)}${String.fromCharCode(10)}`);
            return res.end();
        }

        // K?t thc lu?ng stream an ton n?u khng vi ph?m
        if (!res.writableEnded) {
            res.write(`data: [DONE]${String.fromCharCode(10)}${String.fromCharCode(10)}`);
            res.end();
        }

        // ==========================================
        // NH?P 4: LUU DB & GHI LOG B?O M?T"""

text = re.sub(r'\s*// K\?t th\?c lu\?ng stream an ton.*?// NH\?P 4: LUU DB & GHI LOG B\?O M\?T', new_interceptor, text, flags=re.DOTALL)

with open('C:/Users/Hoang/Desktop/hub-dubai/server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Security patches applied.")
