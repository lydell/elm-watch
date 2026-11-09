// A pretend backend. In a real project, this could be written in any language.
import * as http from "node:http";

const PORT = 9000;

const server = http.createServer((request, response) => {
  console.log(request.method, request.url);
  if (request.url === "/api/time") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ time: new Date().toLocaleTimeString() }));
  } else {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Backend listening on http://127.0.0.1:${PORT}`);
});
