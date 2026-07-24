import { pathToFileURL } from "node:url";

const configuredApiBaseUrl = process.env.CLOSETSEARCH_API_BASE_URL?.trim();
const requireHttps = process.env.CLOSETSEARCH_SMOKE_REQUIRE_HTTPS?.toLowerCase() !== "false";
const expectedProviderIds = new Set(
  (process.env.CLOSETSEARCH_EXPECTED_PROVIDER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

function boundedInteger(raw, fallback, minimum, maximum, name) {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }

  return value;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchJson(apiBaseUrl, timeoutMs, path) {
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

function assertNormalizedListing(listing) {
  assertNoMockListing(listing);
  assert(
    typeof listing?.id === "string" && listing.id.length > 0,
    "A smoke listing is missing its normalized ID.",
  );
  assert(
    typeof listing?.providerId === "string" && listing.providerId.length > 0,
    "A smoke listing is missing its provider ID.",
  );
  assert(
    typeof listing?.providerListingId === "string" && listing.providerListingId.length > 0,
    "A smoke listing is missing its source listing ID.",
  );
  assert(
    typeof listing?.title === "string" && listing.title.trim().length > 0,
    "A smoke listing is missing its title.",
  );
  const destination = new URL(listing?.sourceUrl);
  assert(
    destination.protocol === "https:" || destination.protocol === "http:",
    "A smoke listing has an invalid marketplace URL.",
  );
  assert(
    Number.isSafeInteger(listing?.price?.amountMinor) && listing.price.amountMinor >= 0,
    "A smoke listing is missing an exact non-negative price.",
  );
  assert(/^[A-Z]{3}$/.test(listing?.price?.currency), "A smoke listing has an invalid currency.");
}

export async function main() {
  assert(
    configuredApiBaseUrl,
    "CLOSETSEARCH_API_BASE_URL is required; smoke:test never defaults to a local or mock runtime.",
  );
  const apiBaseUrl = configuredApiBaseUrl.replace(/\/+$/, "");
  const parsedBaseUrl = new URL(apiBaseUrl);
  const timeoutMs = boundedInteger(
    process.env.CLOSETSEARCH_SMOKE_TIMEOUT_MS,
    10_000,
    1_000,
    60_000,
    "CLOSETSEARCH_SMOKE_TIMEOUT_MS",
  );

  if (requireHttps) {
    assert(parsedBaseUrl.protocol === "https:", "Production smoke requires HTTPS.");
  } else {
    assert(
      parsedBaseUrl.protocol === "http:" || parsedBaseUrl.protocol === "https:",
      "Smoke URL must use HTTP or HTTPS.",
    );
  }

  const live = await fetchJson(apiBaseUrl, timeoutMs, "/health/live");
  assert(live?.status === "alive", "Liveness did not report alive.");

  const ready = await fetchJson(apiBaseUrl, timeoutMs, "/health/ready");
  assert(ready?.status === "ready", "Readiness did not report ready.");
  assert(
    ready?.checks?.realProviders === "ready",
    "Readiness did not confirm an active real provider.",
  );

  const providerHealth = await fetchJson(apiBaseUrl, timeoutMs, "/providers/health");
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

  const feed = await fetchJson(apiBaseUrl, timeoutMs, "/feed?pageSize=3");
  assert(Array.isArray(feed?.listings), "Feed response is missing listings.");
  assert(Array.isArray(feed?.providers), "Feed response is missing provider summaries.");
  assert(feed.listings.length > 0, "The production feed returned no real listings.");

  for (const listing of feed.listings) {
    assertNormalizedListing(listing);
  }

  for (const provider of feed.providers) {
    assert(
      provider?.dataOrigin !== "mock" && provider?.providerId !== "mock",
      "Feed provider summary contains mock data.",
    );
  }
  assert(
    feed.providers.some(
      (provider) =>
        provider?.status === "success" &&
        activeRealProviders.some((activeProvider) => activeProvider.id === provider.providerId),
    ),
    "The production feed has no successful active real-provider result.",
  );

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
