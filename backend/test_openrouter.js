const fetch = require('node-fetch');

async function run() {
    const messages = [
        { role: "system", content: "You are an AI." },
        { role: "user", content: "doanh thu tháng 5" },
        { role: "assistant", content: "Dữ liệu doanh thu trong tháng 5 không được cung cấp." },
        { role: "user", content: "vậy ngày 1 và 2 tháng 6" }
    ];
    
    console.log("Starting fetch...");
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "openai/gpt-3.5-turbo",
            messages: messages,
            stream: true,
            max_tokens: 2000
        })
    });
    console.log("Status:", res.status);
    if (!res.ok) {
        console.log("Error:", await res.text());
        return;
    }
    const decoder = new TextDecoder("utf-8");
    for await (const chunk of res.body) {
        console.log("Chunk:", decoder.decode(chunk));
    }
}
run();
