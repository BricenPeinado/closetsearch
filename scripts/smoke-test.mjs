import { pathToFileURL } from "node:url";

const apiBaseUrl = process.env.CLOSETSEARCH_API_BASE_URL ?? "http://127.0.0.1:4000";
const timeoutMs = Number.parseInt(process.env.CLOSETSEARCH_SMOKE_TIMEOUT_MS ?? "5000", 10);

async function fetchJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      accept: "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  const body = await response.json().catch(() => null);

  return {
    body,
    ok: response.ok,
    status: response.status,
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runCheck(name, path, validator) {
  const result = await fetchJson(path);

  if (!result.ok) {
    throw new Error(`${name} failed with status ${result.status}.`);
  }

  validator(result.body);
  console.log(`PASS ${name}`);
}

function assertProviderHealth(body) {
  assert(typeof body?.providerRuntimeMode === "string", "Provider health is missing runtime mode.");
  assert(Array.isArray(body?.providers), "Provider health is missing providers.");
  assert(
    !JSON.stringify(body).includes("contact:team.com"),
    "Provider health should not echo raw provider credential-like values.",
  );
}

export async function main() {
  console.log(`Running launch candidate smoke checks against ${apiBaseUrl}`);

  await runCheck("api-health", "/health", (body) => {
    assert(body?.service === "closetsearch-api", "Health response is missing service.");
    assert(body?.status === "ok", "Health response did not report ok status.");
    assert(typeof body?.timestamp === "string", "Health response is missing a timestamp.");
  });

  await runCheck("provider-health", "/providers/health", assertProviderHealth);

  await runCheck("feed-surface", "/feed?pageSize=1", (body) => {
    assert(Array.isArray(body?.listings), "Feed response is missing listings.");
    assert(
      body?.pagination && typeof body.pagination.page === "number",
      "Feed response is missing pagination.",
    );
    assert(Array.isArray(body?.providers), "Feed response is missing provider summaries.");
  });

  await runCheck("brand-directory", "/brands", (body) => {
    assert(Array.isArray(body?.brands), "Brand directory response is missing brands.");
  });

  await runCheck("search-surface", "/search?q=kapital&pageSize=1", (body) => {
    assert(Array.isArray(body?.listings), "Search response is missing listings.");
    assert(
      body?.pagination && typeof body.pagination.page === "number",
      "Search response is missing pagination.",
    );
    assert(Array.isArray(body?.providers), "Search response is missing provider summaries.");
  });

  await runCheck("analytics-overview", "/analytics/overview", (body) => {
    assert(typeof body?.locked === "boolean", "Analytics overview is missing locked state.");
    assert(
      typeof body?.message === "string" || typeof body?.overview === "object",
      "Analytics overview should return a locked message or overview data.",
    );
  });

  console.log("Launch candidate smoke checks completed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      `FAIL launch candidate smoke test: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    process.exitCode = 1;
  });
}
