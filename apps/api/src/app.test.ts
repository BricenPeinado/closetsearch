import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { handleRequest } from "./app.js";

function createResponseRecorder() {
  let statusCode = 0;
  let headers: Record<string, string> = {};
  let body = "";

  const response = {
    end(chunk?: string) {
      body = chunk ?? "";
      return response;
    },
    writeHead(code: number, nextHeaders: Record<string, string>) {
      statusCode = code;
      headers = nextHeaders;
      return response;
    },
  } as unknown as ServerResponse<IncomingMessage>;

  return {
    response,
    snapshot: () => ({
      body,
      headers,
      statusCode,
    }),
  };
}

describe("handleRequest", () => {
  it("returns a healthy JSON response from /health", () => {
    const request = {
      method: "GET",
      url: "/health",
    } as IncomingMessage;

    const recorder = createResponseRecorder();

    handleRequest(request, recorder.response);

    expect(recorder.snapshot()).toMatchObject({
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      statusCode: 200,
    });

    expect(JSON.parse(recorder.snapshot().body)).toMatchObject({
      service: "closetsearch-api",
      status: "ok",
    });
  });
});
