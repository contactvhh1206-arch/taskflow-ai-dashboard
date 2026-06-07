const { TextDecoder } = require('util');

async function test() {
    const chunkBuffer = Buffer.from('data: {"content": "hello"}\n\ndata: {"content": "world"}\n\n');
    let streamBuffer = ""; 
    const decoder = new TextDecoder("utf-8");
    
    streamBuffer += decoder.decode(chunkBuffer, { stream: true }).replace(/\r\n/g, '\n');
    let boundaryIndex;
    
    while ((boundaryIndex = streamBuffer.indexOf('\n\n')) !== -1) {
        const completeEvent = streamBuffer.slice(0, boundaryIndex).trim();
        streamBuffer = streamBuffer.slice(boundaryIndex + 2);
        console.log("Found event:", completeEvent);
    }
}
test();
