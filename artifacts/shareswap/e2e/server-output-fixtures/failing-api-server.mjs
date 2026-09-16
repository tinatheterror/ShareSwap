import { createServer } from "node:http";

console.error("error: startup database relation does not exist");

createServer((request, response) => {
  if (request.url === "/trigger") {
    console.error("error: request database column does not exist");
  }
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("ok");
}).listen(4191, "127.0.0.1");