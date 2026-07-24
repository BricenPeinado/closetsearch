import { pathToFileURL } from "node:url";

const apiBaseUrl = (process.env.CLOSETSEARCH_API_BASE_URL ?? "https://api.example.invalid").replace(
  /\/+$/,
  "",
);
const timeoutMs = boundedInteger(process.env.CLOSETSEARCH_SMOKE_TIMEOUT_MS, 10_000, 1_000, 60_000);
const requireHttps = process.env.CLOSETSEARCH_SMOKE_REQUIRE_HTTPS?.toLowerCase() !== "false";
const expectedProviderIds = new Set(
  (process.env.CLOSETSEARCH_EXPECTED_PROVIDER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

function boundedInteger(raw, fallback, minimum, maximum) {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      accept: "application/json",
    },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}.`);
  }

  return body;
}

function assertNoMockListing(listing) {
  assert(listing?.source?.isMock !== true, "A smoke response contained mock inventory.");
  assert(listing?.source?.dataOrigin !== "mock", "A smoke response identified inventory as mock.");
  assert(
    listing?.providerId !== "mock" && listing?.source?.id !== "mock",
    "A smoke response contained the mock provider.",
  );
}

export async function main() {
  const parsedBaseUrl = new URL(apiBaseUrl);

  if (requireHttps) {
    assert(parsedBaseUrl.protocol === "https:", "Production smoke requires HTTPS.");
  }

  const live = await fetchJson("/health/live");
  assert(live?.status === "alive", "Liveness did not report alive.");

  const ready = await fetchJson("/health/ready");
  assert(ready?.status === "ready", "Readiness did not report ready.");
  assert(
    ready?.checks?.realProviders === "ready",
    "Readiness did not confirm an active real provider.",
  );

  const providerHealth = await fetchJson("/providers/health");
  assert(providerHealth?.providerRuntimeMode === "real", "Provider runtime is not in real mode.");
  assert(providerHealth?.allowMockFallback === false, "Mock provider fallback is enabled.");
  assert(Array.isArray(providerHealth?.providers), "Provider health is malformed.");

  const activeRealProviders = providerHealth.providers.filter(
    (provider) => provider?.active === true && provider?.providerMode === "real",
  );
  const activeMocks = providerHealth.providers.filter(
    (provider) =>
      provider?.active === true &&
      (provider?.providerMode === "mock" || provider?.mode === "fixture"),
  );

  assert(activeRealProviders.length > 0, "No real provider is active.");
  assert(activeMocks.length === 0, "A mock/fixture provider is active.");

  for (const providerId of expectedProviderIds) {
    assert(
      activeRealProviders.some((provider) => provider?.id === providerId),
      `Expected real provider ${providerId} is not active.`,
    );
  }

  const feed = await fetchJson("/feed?pageSize=3");
  assert(Array.isArray(feed?.listings), "Feed response is missing listings.");
  assert(Array.isArray(feed?.providers), "Feed response is missing provider summaries.");

  for (const listing of feed.listings) {
    assertNoMockListing(listing);
  }

  for (const provider of feed.providers) {
    assert(
      provider?.dataOrigin !== "mock" && provider?.providerId !== "mock",
      "Feed provider summary contains mock data.",
    );
  }

  process.stdout.write(
    `${JSON.stringify({
      activeRealProviderIds: activeRealProviders.map((provider) => provider.id),
      event: "production_smoke_passed",
      listingCount: feed.listings.length,
    })}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        event: "production_smoke_failed",
        message: error instanceof Error ? error.message : "Unknown smoke failure.",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
