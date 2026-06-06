const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    setTimeout(() => {
        res.write('data: {"choices":[{"delta":{"content":"test"}}]}\n\n');
        res.end();
    }, 1000);
});

server.listen(3000, async () => {
    try {
        const response = await fetch('http://localhost:3000');
        console.log("Fetch OK");
        for await (const chunk of response.body) {
            console.log("Chunk type:", typeof chunk, Buffer.isBuffer(chunk));
            console.log("Chunk:", chunk.toString());
        }
    } catch (e) {
        console.error("Error:", e);
    } finally {
        server.close();
    }
});
