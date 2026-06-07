const fetch = require('node-fetch'); // Let's see if node-fetch is used
// wait, native fetch
async function test() {
  const res = new Response('hello\nworld');
  for await (const chunk of res.body) {
    console.log("Type:", chunk.constructor.name);
    console.log("toString():", chunk.toString());
    console.log("Buffer.from:", Buffer.from(chunk).toString());
  }
}
test();
