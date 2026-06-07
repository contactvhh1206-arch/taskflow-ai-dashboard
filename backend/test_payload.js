const fs = require('fs');

async function testOpenRouter() {
    const messages = [
      { role: "system", content: "Bạn là AI Agent của TaskFlow..." },
      { role: "user", content: "hi" },
      { role: "assistant", content: "Xin chào! Có điều gì tôi có thể giúp bạn không ạ?" },
      { role: "user", content: "doanh thu tháng 5" }
    ];

    const llmPayload = {
        model: "openai/gpt-3.5-turbo",
        messages: messages,
        stream: true,
        max_tokens: 2000
    };

    console.log("Testing OpenRouter with payload...", JSON.stringify(llmPayload, null, 2));
}
testOpenRouter();
