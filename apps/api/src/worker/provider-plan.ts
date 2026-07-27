import type { SearchQuery } from "@closetsearch/shared";
import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import type { ProviderRuntime } from "../providers/registry.js";
import { ContractProviderIngestionSource, type ProviderIngestionQuery } from "./provider-source.js";

type ScheduledScope = "active" | "sold";

interface ConfiguredSearch {
  intervalSeconds: number;
  key: string;
  pageSize: number;
  providerIds?: string[];
  scope: ScheduledScope;
  text: string;
}

export interface ProviderIngestionJobPlan {
  intervalSeconds: number;
  jobKey: string;
  payload: {
    ingestionScope: ScheduledScope;
    providerId: string;
    queryKey: string;
    successIntervalSeconds: number;
  };
}

export interface WorkerProviderPlan {
  jobs: ProviderIngestionJobPlan[];
  sources: ContractProviderIngestionSource[];
}

const defaultSearchText = "designer clothing";

function parseBoolean(value: string | undefined, fallback: boolean) {
  switch (value?.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return fallback;
  }
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : fallback;
}

function optionalProviderIds(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (
    !Array.isArray(value) ||
    !value.every(
      (providerId) => typeof providerId === "string" && /^[a-z0-9_-]{1,80}$/i.test(providerId),
    )
  ) {
    throw new Error(
      "Each WORKER_INGESTION_SEARCHES_JSON providerIds value must be an array of provider IDs.",
    );
  }

  return value as string[];
}

function parseConfiguredSearches(env: Record<string, string | undefined>): ConfiguredSearch[] {
  const raw = env.WORKER_INGESTION_SEARCHES_JSON?.trim();

  if (!raw) {
    const text = env.WORKER_DEFAULT_INGESTION_QUERY?.trim() || defaultSearchText;

    return [
      {
        intervalSeconds: boundedInteger(
          Number(env.WORKER_ACTIVE_INGESTION_INTERVAL_SECONDS),
          900,
          60,
          604_800,
        ),
        key: "default",
        pageSize: boundedInteger(Number(env.WORKER_INGESTION_PAGE_SIZE), 50, 1, 200),
        scope: "active",
        text,
      },
      {
        intervalSeconds: boundedInteger(
          Number(env.WORKER_SOLD_INGESTION_INTERVAL_SECONDS),
          3_600,
          60,
          604_800,
        ),
        key: "default",
        pageSize: boundedInteger(Number(env.WORKER_INGESTION_PAGE_SIZE), 50, 1, 200),
        scope: "sold",
        text,
      },
    ];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("WORKER_INGESTION_SEARCHES_JSON must be valid JSON.");
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100) {
    throw new Error(
      "WORKER_INGESTION_SEARCHES_JSON must contain 1 through 100 search definitions.",
    );
  }

  const seenKeys = new Set<string>();

  return parsed.map((value, index): ConfiguredSearch => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Worker ingestion search at index ${index} must be an object.`);
    }

    const record = value as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key.trim().toLowerCase() : "";
    const text = typeof record.text === "string" ? record.text.trim() : "";
    const scope = record.scope;

    if (
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(key) ||
      text.length > 500 ||
      (scope !== "active" && scope !== "sold")
    ) {
      throw new Error(
        `Worker ingestion search at index ${index} has an invalid key, text, or scope.`,
      );
    }

    const compoundKey = `${scope}:${key}`;

    if (seenKeys.has(compoundKey)) {
      throw new Error(`Worker ingestion search ${compoundKey} is duplicated.`);
    }

    seenKeys.add(compoundKey);

    return {
      intervalSeconds: boundedInteger(
        record.intervalSeconds,
        scope === "active" ? 900 : 3_600,
        60,
        604_800,
      ),
      key,
      pageSize: boundedInteger(record.pageSize, 50, 1, 200),
      providerIds: optionalProviderIds(record.providerIds),
      scope,
      text,
    };
  });
}

function supportsScope(
  provider: ProviderRuntime["activeProviders"][number]["provider"],
  scope: ScheduledScope,
) {
  return scope === "sold"
    ? provider.capabilities?.supportsSoldListings === true
    : provider.capabilities?.supportsActiveListings !== false;
}

function configuredResultCap(runtime: ProviderRuntime, providerId: string) {
  const providerConfig =
    providerId === "depop"
      ? runtime.config.providers.depop
      : providerId === "ebay"
        ? runtime.config.providers.ebay
        : providerId === "grailed"
          ? runtime.config.providers.grailed
          : providerId === "mercari-jp"
            ? runtime.config.providers.mercariJp
            : providerId === "yahoo-auctions-jp"
              ? runtime.config.providers.yahooAuctionsJp
              : undefined;
  const configuredMaximum = providerConfig?.maxResultsPerSearch;

  return typeof configuredMaximum === "number" &&
    Number.isSafeInteger(configuredMaximum) &&
    configuredMaximum >= 1
    ? Math.min(200, configuredMaximum)
    : undefined;
}

export function createWorkerProviderPlan(
  runtime: ProviderRuntime,
  env: Record<string, string | undefined> = process.env,
): WorkerProviderPlan {
  if (!parseBoolean(env.WORKER_PROVIDER_INGESTION_ENABLED, true)) {
    return { jobs: [], sources: [] };
  }

  const searches = parseConfiguredSearches(env);
  const jobs: ProviderIngestionJobPlan[] = [];
  const sources: ContractProviderIngestionSource[] = [];

  for (const registration of runtime.activeProviders) {
    const provider = registration.provider;
    const resultCap = configuredResultCap(runtime, provider.id);

    if (
      registration.mode !== "real" ||
      provider.isMock === true ||
      provider.dataOrigin === "mock" ||
      provider.capabilities?.dataOrigin === "mock"
    ) {
      continue;
    }

    const providerQueries: ProviderIngestionQuery[] = [];

    for (const search of searches) {
      if (
        !supportsScope(provider, search.scope) ||
        (search.providerIds && !search.providerIds.includes(provider.id))
      ) {
        continue;
      }

      const queryKey = `${search.scope}:${search.key}`;
      const query: SearchQuery = {
        marketScope: search.scope,
        sort: "newest",
        text: search.text,
      };
      providerQueries.push({
        key: queryKey,
        pageSize: resultCap === undefined ? search.pageSize : Math.min(search.pageSize, resultCap),
        query,
      });
      jobs.push({
        intervalSeconds: search.intervalSeconds,
        jobKey: `provider.ingest:${provider.id}:${queryKey}`,
        payload: {
          ingestionScope: search.scope,
          providerId: provider.id,
          queryKey,
          successIntervalSeconds: search.intervalSeconds,
        },
      });
    }

    if (providerQueries.length > 0) {
      sources.push(new ContractProviderIngestionSource(provider, providerQueries));
    }
  }

  return { jobs, sources };
}

export async function seedWorkerJobs(
  dataPlane: PostgresDataPlane,
  providerPlan: WorkerProviderPlan,
  now = new Date(),
) {
  const coreJobs = [
    {
      intervalSeconds: 15,
      jobKey: "alerts.deliver_due",
      jobType: "alerts.deliver_due",
      payload: {
        limit: 25,
      },
    },
    {
      intervalSeconds: 3_600,
      jobKey: "listings.mark_stale",
      jobType: "listings.mark_stale",
      payload: {
        ageSeconds: 86_400,
        limit: 500,
      },
    },
    {
      intervalSeconds: 86_400,
      jobKey: "engagement.rollup_day",
      jobType: "engagement.rollup_day",
      payload: {},
    },
  ];

  for (const job of coreJobs) {
    await dataPlane.jobs.enqueue({
      jobKey: job.jobKey,
      jobType: job.jobType,
      payload: job.payload,
      runAfter: now,
      scheduleIntervalSeconds: job.intervalSeconds,
    });
  }

  for (const job of providerPlan.jobs) {
    await dataPlane.jobs.enqueue({
      jobKey: job.jobKey,
      jobType: "provider.ingest",
      payload: job.payload,
      runAfter: now,
      scheduleIntervalSeconds: job.intervalSeconds,
    });
  }

  return {
    coreJobCount: coreJobs.length,
    providerJobCount: providerPlan.jobs.length,
  };
}
