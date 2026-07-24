import { afterEach, describe, expect, it, vi } from "vitest";
import { logInfo } from "./logger.js";

describe("structured logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts sensitive keys recursively", () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value) => {
      output.push(String(value));
    });

    logInfo("redaction test", {
      nested: {
        apiKey: "marketplace-secret",
        safe: "visible",
      },
      password: "user-secret",
      sessionToken: "session-secret",
    });

    expect(output).toHaveLength(1);
    expect(output[0]).toContain("visible");
    expect(output[0]).not.toContain("marketplace-secret");
    expect(output[0]).not.toContain("user-secret");
    expect(output[0]).not.toContain("session-secret");
    expect(output[0]).toContain("[REDACTED]");
  });
});
