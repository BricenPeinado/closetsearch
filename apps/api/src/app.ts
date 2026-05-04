import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";

function sendJson(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: Record<string, unknown>,
) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

export function handleRequest(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
) {
  const method = request.method ?? "GET";
  const requestUrl = new URL(request.url ?? "/", "http://localhost");

  if (method === "GET" && requestUrl.pathname === "/health") {
    sendJson(response, 200, {
      service: "closetsearch-api",
      status: "ok",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  sendJson(response, 404, {
    error: "not_found",
    message: "Route not found in the Milestone 2 API shell.",
  });
}

export function createApp() {
  return createServer(handleRequest);
}
