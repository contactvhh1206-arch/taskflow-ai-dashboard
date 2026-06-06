require('dotenv').config();
const fetch = require('node-fetch');

async function test() {
    console.log("Key:", process.env.OPENROUTER_API_KEY.substring(0, 10));
    const response2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "google/gemini-3.1-pro-preview",
            stream: true,
            messages: [
                { role: "user", content: "hello" },
                { role: "assistant", content: "Đang lấy dữ liệu..." },
                { role: "user", content: "[DỮ LIỆU TỪ HỆ THỐNG]: abc" },
                { role: "user", content: "[HƯỚNG DẪN TỪ BAN QUẢN TRỊ]: def" }
            ]
        })
    });
    console.log("Status:", response2.status);
    
    try {
        const reader = response2.body;
        for await (const chunk of reader) {
            console.log("Chunk:", chunk.toString());
        }
    } catch (e) {
        console.error("Stream Error:", e.message);
    }
}
test();
