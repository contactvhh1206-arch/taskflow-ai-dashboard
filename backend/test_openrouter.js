const fetch = require('node-fetch');

async function test() {
    const messages = [
        { role: 'user', content: 'doanh thu tháng 5' },
        { 
            role: 'assistant', 
            content: '', 
            tool_calls: [{
                id: 'call_123',
                type: 'function',
                function: {
                    name: 'fetch_financial_reports',
                    arguments: '{}'
                }
            }]
        },
        {
            role: 'tool',
            tool_call_id: 'call_123',
            content: '[Cơ sở: DUBAI 41] Ngày: 2026-05-31 - Doanh thu: 1000'
        }
    ];

    const aiService = require('./src/services/aiService');

    const llmStreamPayload = {
        model: "google/gemini-3.1-pro-preview",
        messages: messages,
        tools: aiService.AI_TOOLS,
        stream: true,
        max_tokens: 4096
    };

    console.log("Sending payload...");
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(llmStreamPayload)
    });

    console.log("Status:", response.status);
    if (!response.ok) {
        console.log("Error:", await response.text());
        return;
    }

    const reader = response.body;
    reader.on('data', chunk => {
        console.log("CHUNK:", chunk.toString());
    });
    reader.on('end', () => {
        console.log("END");
    });
}

test();
