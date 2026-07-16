import type { ProviderFailureCode } from "../types";
import { validateGrailedAlgoliaCredentials } from "./algolia";
import type { GrailedHttpClient } from "./http-client";
import { buildGrailedSearchUrl } from "./search-url";

export interface GrailedAlgoliaCredentials {
  apiKey: string;
  appId: string;
}

export interface GrailedCredentialCacheEntry extends GrailedAlgoliaCredentials {
  expiresAt: number;
}

export interface GrailedCredentialCache {
  clear(): void;
  get(): GrailedAlgoliaCredentials | undefined;
  set(credentials: GrailedAlgoliaCredentials): GrailedAlgoliaCredentials;
}

export class GrailedCredentialResolutionError extends Error {
  code: ProviderFailureCode;
  retryable: boolean;
  stages: string[];

  constructor(
    code: ProviderFailureCode,
    message: string,
    options: {
      retryable?: boolean;
      stages?: string[];
    } = {},
  ) {
    super(message);
    this.name = "GrailedCredentialResolutionError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.stages = options.stages ?? [];
  }
}

const publicConfigAssignmentPattern = /window\.PUBLIC_CONFIG\s*=\s*/i;
const scriptSourcePattern = /<script\b[^>]*\bsrc=(['"])(.*?)\1[^>]*>/gi;
const nextDataPattern =
  /<script\b[^>]*\bid=(['"])__NEXT_DATA__\1[^>]*>([\s\S]*?)<\/script>/gi;
const maxScriptBundlesToInspect = 20;
const maxBundleCandidatesPerScript = 8;
const configAssignments = [
  {
    sourceLabel: "PUBLIC_CONFIG",
    pattern: /window\.PUBLIC_CONFIG\s*=\s*/i,
  },
  {
    sourceLabel: "__PUBLIC_CONFIG__",
    pattern: /window\.__PUBLIC_CONFIG__\s*=\s*/i,
  },
  {
    sourceLabel: "__INITIAL_STATE__",
    pattern: /window\.__INITIAL_STATE__\s*=\s*/i,
  },
  {
    sourceLabel: "__PRELOADED_STATE__",
    pattern: /window\.__PRELOADED_STATE__\s*=\s*/i,
  },
] as const;
const appIdFieldNames = [
  "appId",
  "applicationId",
  "applicationID",
  "ALGOLIA_APP_ID",
] as const;
const apiKeyFieldNames = ["apiKey", "ALGOLIA_API_KEY"] as const;
const bundleAppIdPattern =
  /(?:["']?(?:appId|applicationID|applicationId|ALGOLIA_APP_ID)["']?\s*[:=]\s*["']([^"'\\\s]{3,})["'])/g;
const bundleApiKeyPattern =
  /(?:["']?(?:apiKey|ALGOLIA_API_KEY)["']?\s*[:=]\s*["']([^"'\\\s]{6,})["'])/g;
const bundleIndexPatterns = ["Listing_production", "Listing_sold_production"];

interface GrailedCredentialCandidate extends GrailedAlgoliaCredentials {
  detail?: string;
  source: string;
}

interface ValidationResultAccepted {
  kind: "accepted";
  credentials: GrailedAlgoliaCredentials;
}

interface ValidationResultOther {
  kind: "rate_limited" | "rejected" | "unavailable";
  status?: number;
}

type ValidationResult = ValidationResultAccepted | ValidationResultOther;

interface GrailedCredentialResolutionState {
  sawCredentialFailure: boolean;
  sawUnavailable: boolean;
  stages: string[];
}

interface GrailedCredentialResolutionOptions {
  baseUrl: string;
  cache: GrailedCredentialCache;
  client: GrailedHttpClient;
  queryText?: string;
}

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function maskSecret(value: string) {
  const trimmed = value.trim();

  if (trimmed.length <= 8) {
    return trimmed.length <= 4
      ? "*".repeat(trimmed.length)
      : `${trimmed.slice(0, 2)}...${trimmed.slice(-2)}`;
  }

  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function logCredentialCandidate(event: string, candidate: GrailedCredentialCandidate) {
  console.info("Grailed Algolia credential candidate", {
    event,
    source: candidate.source,
    detail: candidate.detail,
    appId: maskSecret(candidate.appId),
    apiKey: maskSecret(candidate.apiKey),
  });
}

function addStage(
  state: GrailedCredentialResolutionState,
  stage: string,
  options: {
    credentialFailure?: boolean;
    unavailable?: boolean;
  } = {},
) {
  if (!state.stages.includes(stage)) {
    state.stages.push(stage);
  }

  if (options.credentialFailure) {
    state.sawCredentialFailure = true;
  }

  if (options.unavailable) {
    state.sawUnavailable = true;
  }
}

function findBalancedJsonObject(source: string, startIndex: number) {
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (character === "\\") {
      escapeNext = true;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  throw new Error(
    "Grailed PUBLIC_CONFIG markup was found, but the JSON object did not close cleanly.",
  );
}

function extractAssignedJsonObject(
  html: string,
  assignmentPattern: RegExp,
  missingMessage: string,
  missingObjectMessage: string,
) {
  const assignmentMatch = html.match(assignmentPattern);

  if (!assignmentMatch || assignmentMatch.index === undefined) {
    throw new Error(missingMessage);
  }

  const objectStartIndex = html.indexOf(
    "{",
    assignmentMatch.index + assignmentMatch[0].length,
  );

  if (objectStartIndex === -1) {
    throw new Error(missingObjectMessage);
  }

  return findBalancedJsonObject(html, objectStartIndex);
}

function getStringField(
  record: Record<string, unknown>,
  fieldNames: readonly string[],
) {
  for (const fieldName of fieldNames) {
    const value = toTrimmedString(record[fieldName]);

    if (value) {
      return value;
    }
  }

  return "";
}

function dedupeCandidates(candidates: GrailedCredentialCandidate[]) {
  const deduped = new Map<string, GrailedCredentialCandidate>();

  for (const candidate of candidates) {
    const key = [candidate.source, candidate.appId, candidate.apiKey].join("::");

    if (!deduped.has(key)) {
      deduped.set(key, candidate);
    }
  }

  return Array.from(deduped.values());
}

function extractCredentialPairFromRecord(
  record: Record<string, unknown>,
): GrailedAlgoliaCredentials | undefined {
  const directAppId = getStringField(record, appIdFieldNames);
  const directApiKey = getStringField(record, apiKeyFieldNames);

  if (directAppId && directApiKey) {
    return {
      appId: directAppId,
      apiKey: directApiKey,
    };
  }

  const algolia = asRecord(record.algolia);

  if (!algolia) {
    return undefined;
  }

  const appId = getStringField(algolia, appIdFieldNames);
  const apiKey = getStringField(algolia, apiKeyFieldNames);

  if (!appId || !apiKey) {
    return undefined;
  }

  return {
    appId,
    apiKey,
  };
}

function collectCredentialCandidatesFromJsonValue(
  value: unknown,
  source: string,
): GrailedCredentialCandidate[] {
  const candidates: GrailedCredentialCandidate[] = [];
  const visited = new Set<object>();

  function visit(node: unknown, path: string[]) {
    if (Array.isArray(node)) {
      for (const [index, entry] of node.entries()) {
        visit(entry, [...path, String(index)]);
      }

      return;
    }

    const record = asRecord(node);

    if (!record) {
      return;
    }

    if (visited.has(record)) {
      return;
    }

    visited.add(record);

    const credentials = extractCredentialPairFromRecord(record);

    if (credentials) {
      candidates.push({
        ...credentials,
        source,
        detail: path.join("."),
      });
    }

    for (const [key, entry] of Object.entries(record)) {
      visit(entry, [...path, key]);
    }
  }

  visit(value, []);
  return dedupeCandidates(candidates);
}

function collectInlineJsonBlocks(html: string) {
  const jsonBlocks: Array<{ json: string; label: string }> = [];

  nextDataPattern.lastIndex = 0;

  for (const configAssignment of configAssignments) {
    try {
      const json = extractAssignedJsonObject(
        html,
        configAssignment.pattern,
        `${configAssignment.sourceLabel} was not found.`,
        `${configAssignment.sourceLabel} was found, but no JSON object start token was present.`,
      );

      jsonBlocks.push({
        json,
        label: configAssignment.sourceLabel,
      });
    } catch {
      continue;
    }
  }

  for (const match of html.matchAll(nextDataPattern)) {
    const json = toTrimmedString(match[2]);

    if (json) {
      jsonBlocks.push({
        json,
        label: "__NEXT_DATA__",
      });
    }
  }

  return jsonBlocks;
}

function collectInlineCredentialCandidates(
  html: string,
  source: string,
): GrailedCredentialCandidate[] {
  const candidates: GrailedCredentialCandidate[] = [];

  for (const jsonBlock of collectInlineJsonBlocks(html)) {
    try {
      const parsedValue = JSON.parse(jsonBlock.json) as unknown;
      candidates.push(
        ...collectCredentialCandidatesFromJsonValue(parsedValue, source).map(
          (candidate) => ({
            ...candidate,
            detail: candidate.detail
              ? `${jsonBlock.label}:${candidate.detail}`
              : jsonBlock.label,
          }),
        ),
      );
    } catch {
      continue;
    }
  }

  return dedupeCandidates(candidates);
}

function extractScriptUrls(html: string, baseUrl: string) {
  const urls = new Set<string>();
  let match: RegExpExecArray | null;
  const baseOrigin = new URL(baseUrl).origin;

  scriptSourcePattern.lastIndex = 0;

  while ((match = scriptSourcePattern.exec(html)) !== null) {
    const rawUrl = toTrimmedString(match[2]);

    if (!rawUrl) {
      continue;
    }

    try {
      const normalizedUrl = new URL(rawUrl, baseUrl).toString();
      urls.add(normalizedUrl);
    } catch {
      continue;
    }
  }

  return Array.from(urls)
    .sort((left, right) => {
      const leftSameOrigin = left.startsWith(baseOrigin) ? 0 : 1;
      const rightSameOrigin = right.startsWith(baseOrigin) ? 0 : 1;
      return leftSameOrigin - rightSameOrigin;
    })
    .slice(0, maxScriptBundlesToInspect);
}

function collectRegexMatches(pattern: RegExp, source: string) {
  const matches: Array<{ index: number; value: string }> = [];
  let match: RegExpExecArray | null;

  pattern.lastIndex = 0;

  while ((match = pattern.exec(source)) !== null) {
    const value = toTrimmedString(match[1]);

    if (!value || match.index === undefined) {
      continue;
    }

    matches.push({
      index: match.index,
      value,
    });
  }

  return matches;
}

function scoreBundleCandidate(
  appIdMatch: { index: number; value: string },
  apiKeyMatch: { index: number; value: string },
  indexPositions: number[],
) {
  const pairDistance = Math.abs(appIdMatch.index - apiKeyMatch.index);
  const closestIndexDistance =
    indexPositions.length === 0
      ? Number.MAX_SAFE_INTEGER
      : Math.min(
          ...indexPositions.map((indexPosition) =>
            Math.min(
              Math.abs(indexPosition - appIdMatch.index),
              Math.abs(indexPosition - apiKeyMatch.index),
            ),
          ),
        );

  return (
    (indexPositions.length === 0 ? 0 : 1_000_000 - Math.min(closestIndexDistance, 1_000_000)) +
    (1_000_000 - Math.min(pairDistance, 1_000_000))
  );
}

function collectScriptBundleCredentialCandidates(
  scriptText: string,
  source: string,
  detail: string,
): GrailedCredentialCandidate[] {
  const appIdMatches = collectRegexMatches(bundleAppIdPattern, scriptText);
  const apiKeyMatches = collectRegexMatches(bundleApiKeyPattern, scriptText);
  const indexPositions = bundleIndexPatterns
    .map((indexName) => scriptText.indexOf(indexName))
    .filter((index) => index >= 0);

  if (appIdMatches.length === 0 || apiKeyMatches.length === 0) {
    return [];
  }

  const rankedCandidates = appIdMatches.flatMap((appIdMatch) => {
    const nearestApiKeyMatch = [...apiKeyMatches].sort(
      (left, right) =>
        Math.abs(left.index - appIdMatch.index) -
        Math.abs(right.index - appIdMatch.index),
    )[0];

    if (!nearestApiKeyMatch) {
      return [];
    }

    return [
      {
        appId: appIdMatch.value,
        apiKey: nearestApiKeyMatch.value,
        detail,
        score: scoreBundleCandidate(appIdMatch, nearestApiKeyMatch, indexPositions),
        source,
      },
    ];
  });

  return dedupeCandidates(
    rankedCandidates
      .sort((left, right) => right.score - left.score)
      .slice(0, maxBundleCandidatesPerScript)
      .map(({ score: _score, ...candidate }) => candidate),
  );
}

function buildFailureMessage(stages: string[]) {
  const summary = stages.length > 0 ? stages.join("; ") : "unavailable";
  return `Grailed Algolia credential discovery failed: ${summary}.`;
}

async function validateCandidate(
  candidate: GrailedCredentialCandidate,
  options: GrailedCredentialResolutionOptions,
): Promise<ValidationResult> {
  logCredentialCandidate("validating", candidate);

  try {
    const response = await validateGrailedAlgoliaCredentials(options.client, {
      baseUrl: options.baseUrl,
      credentials: candidate,
      queryText: options.queryText,
    });

    if (response.ok) {
      logCredentialCandidate("accepted", candidate);
      return {
        kind: "accepted",
        credentials: options.cache.set({
          appId: candidate.appId,
          apiKey: candidate.apiKey,
        }),
      };
    }

    if (response.status === 401 || response.status === 403) {
      console.warn("Grailed Algolia credential candidate rejected", {
        source: candidate.source,
        detail: candidate.detail,
        appId: maskSecret(candidate.appId),
        apiKey: maskSecret(candidate.apiKey),
        status: response.status,
      });
      return {
        kind: "rejected",
        status: response.status,
      };
    }

    if (response.status === 429) {
      console.warn("Grailed Algolia credential validation rate limited", {
        source: candidate.source,
        detail: candidate.detail,
        status: response.status,
      });
      return {
        kind: "rate_limited",
        status: response.status,
      };
    }

    console.warn("Grailed Algolia credential validation unavailable", {
      source: candidate.source,
      detail: candidate.detail,
      status: response.status,
    });
    return {
      kind: "unavailable",
      status: response.status,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    console.warn("Grailed Algolia credential validation errored", {
      source: candidate.source,
      detail: candidate.detail,
      message: error instanceof Error ? error.message : "unknown error",
    });

    return {
      kind: "unavailable",
    };
  }
}

async function tryValidatedCandidates(
  candidates: GrailedCredentialCandidate[],
  options: GrailedCredentialResolutionOptions,
  state: GrailedCredentialResolutionState,
  failureStage: string,
) {
  if (candidates.length === 0) {
    return undefined;
  }

  let sawUnavailable = false;

  for (const candidate of candidates) {
    const result = await validateCandidate(candidate, options);

    if (result.kind === "accepted") {
      return result.credentials;
    }

    if (result.kind === "rate_limited") {
      addStage(state, "rate limited", { unavailable: true });
      throw new GrailedCredentialResolutionError(
        "rate_limited",
        buildFailureMessage(state.stages),
        {
          retryable: true,
          stages: [...state.stages],
        },
      );
    }

    if (result.kind === "unavailable") {
      sawUnavailable = true;
    }
  }

  addStage(state, failureStage, {
    credentialFailure: true,
    unavailable: sawUnavailable,
  });
  return undefined;
}

async function fetchHtmlDocument(
  url: string,
  stageLabel: string,
  options: GrailedCredentialResolutionOptions,
  state: GrailedCredentialResolutionState,
) {
  try {
    const response = await options.client.getHtml(url);

    if (response.status === 429) {
      addStage(state, "rate limited", { unavailable: true });
      throw new GrailedCredentialResolutionError(
        "rate_limited",
        buildFailureMessage(state.stages),
        {
          retryable: true,
          stages: [...state.stages],
        },
      );
    }

    if (!response.ok) {
      addStage(state, `${stageLabel}: unavailable`, { unavailable: true });
      return undefined;
    }

    return response.body;
  } catch (error) {
    if (error instanceof GrailedCredentialResolutionError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    addStage(state, `${stageLabel}: unavailable`, { unavailable: true });
    return undefined;
  }
}

async function resolveFromScriptBundles(
  html: string,
  source: string,
  options: GrailedCredentialResolutionOptions,
  state: GrailedCredentialResolutionState,
) {
  const scriptUrls = extractScriptUrls(html, options.baseUrl);

  if (scriptUrls.length === 0) {
    addStage(state, `${source}: no usable script bundle credentials found`, {
      credentialFailure: true,
    });
    return undefined;
  }

  let discoveredAnyCandidates = false;
  let sawUnavailable = false;

  for (const scriptUrl of scriptUrls) {
    let response;

    try {
      response = await options.client.getText(scriptUrl);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }

      sawUnavailable = true;
      continue;
    }

    if (response.status === 429) {
      addStage(state, "rate limited", { unavailable: true });
      throw new GrailedCredentialResolutionError(
        "rate_limited",
        buildFailureMessage(state.stages),
        {
          retryable: true,
          stages: [...state.stages],
        },
      );
    }

    if (!response.ok) {
      sawUnavailable = true;
      continue;
    }

    const detail = (() => {
      try {
        return new URL(scriptUrl).pathname;
      } catch {
        return scriptUrl;
      }
    })();
    const candidates = collectScriptBundleCredentialCandidates(
      response.body,
      source,
      detail,
    );

    if (candidates.length === 0) {
      continue;
    }

    discoveredAnyCandidates = true;
    const credentials = await tryValidatedCandidates(
      candidates,
      options,
      state,
      `${source}: validation failed`,
    );

    if (credentials) {
      return credentials;
    }
  }

  if (discoveredAnyCandidates) {
    addStage(state, `${source}: validation failed`, {
      credentialFailure: true,
      unavailable: sawUnavailable,
    });
    return undefined;
  }

  addStage(state, `${source}: no usable script bundle credentials found`, {
    credentialFailure: true,
    unavailable: sawUnavailable,
  });
  return undefined;
}

async function resolveFromHtmlDocument(
  html: string,
  pageLabel: "homepage" | "search",
  options: GrailedCredentialResolutionOptions,
  state: GrailedCredentialResolutionState,
) {
  const inlineSource = `${pageLabel}-inline`;
  const inlineCandidates = collectInlineCredentialCandidates(html, inlineSource);

  if (inlineCandidates.length === 0) {
    addStage(state, `${inlineSource}: no inline config found`, {
      credentialFailure: true,
    });
  } else {
    const credentials = await tryValidatedCandidates(
      inlineCandidates,
      options,
      state,
      `${inlineSource}: validation failed`,
    );

    if (credentials) {
      return credentials;
    }
  }

  return resolveFromScriptBundles(
    html,
    `${pageLabel}-script`,
    options,
    state,
  );
}

export function extractGrailedPublicConfigJson(html: string) {
  return extractAssignedJsonObject(
    html,
    publicConfigAssignmentPattern,
    "Grailed PUBLIC_CONFIG was not found in the fetched HTML document.",
    "Grailed PUBLIC_CONFIG was found, but no JSON object start token was present.",
  );
}

export function extractGrailedAlgoliaCredentials(
  html: string,
): GrailedAlgoliaCredentials {
  const publicConfigJson = extractGrailedPublicConfigJson(html);
  const parsedValue = JSON.parse(publicConfigJson) as Record<string, unknown>;
  const algolia =
    parsedValue.algolia && typeof parsedValue.algolia === "object"
      ? (parsedValue.algolia as Record<string, unknown>)
      : undefined;

  if (!algolia) {
    throw new Error(
      "Grailed PUBLIC_CONFIG no longer contains an algolia configuration object.",
    );
  }

  const appId = toTrimmedString(algolia.appId);
  const apiKey = toTrimmedString(algolia.apiKey);

  if (!appId) {
    throw new Error("Grailed PUBLIC_CONFIG.algolia.appId was missing or empty.");
  }

  if (!apiKey) {
    throw new Error(
      "Grailed PUBLIC_CONFIG.algolia.apiKey was missing or empty.",
    );
  }

  return {
    appId,
    apiKey,
  };
}

export async function resolveGrailedAlgoliaCredentials(
  options: GrailedCredentialResolutionOptions,
): Promise<GrailedAlgoliaCredentials> {
  const state: GrailedCredentialResolutionState = {
    sawCredentialFailure: false,
    sawUnavailable: false,
    stages: [],
  };
  const cachedCredentials = options.cache.get();

  if (!cachedCredentials) {
    addStage(state, "cache miss");
  } else {
    const cacheCandidate: GrailedCredentialCandidate = {
      ...cachedCredentials,
      source: "cache",
    };
    const validationResult = await validateCandidate(cacheCandidate, options);

    if (validationResult.kind === "accepted") {
      return validationResult.credentials;
    }

    options.cache.clear();

    if (validationResult.kind === "rate_limited") {
      addStage(state, "rate limited", { unavailable: true });
      throw new GrailedCredentialResolutionError(
        "rate_limited",
        buildFailureMessage(state.stages),
        {
          retryable: true,
          stages: [...state.stages],
        },
      );
    }

    addStage(state, "cache: validation failed", {
      credentialFailure: true,
      unavailable: validationResult.kind === "unavailable",
    });
  }

  const homepageHtml = await fetchHtmlDocument(
    options.baseUrl,
    "homepage",
    options,
    state,
  );

  if (homepageHtml) {
    const homepageCredentials = await resolveFromHtmlDocument(
      homepageHtml,
      "homepage",
      options,
      state,
    );

    if (homepageCredentials) {
      return homepageCredentials;
    }
  }

  const trimmedQueryText = toTrimmedString(options.queryText);

  if (trimmedQueryText) {
    const searchPageUrl = buildGrailedSearchUrl({
      baseUrl: options.baseUrl,
      query: {
        text: trimmedQueryText,
      },
    });
    const searchPageHtml = await fetchHtmlDocument(
      searchPageUrl,
      "search",
      options,
      state,
    );

    if (searchPageHtml) {
      const searchCredentials = await resolveFromHtmlDocument(
        searchPageHtml,
        "search",
        options,
        state,
      );

      if (searchCredentials) {
        return searchCredentials;
      }
    }
  }

  const code: ProviderFailureCode = state.sawCredentialFailure
    ? "missing_credentials"
    : state.sawUnavailable
      ? "unavailable"
      : "missing_credentials";
  const stages = state.stages.length > 0 ? [...state.stages] : ["unavailable"];

  console.error("Grailed Algolia credential discovery failed", {
    code,
    stages,
  });

  throw new GrailedCredentialResolutionError(
    code,
    buildFailureMessage(stages),
    {
      stages,
    },
  );
}

export function createGrailedCredentialCache(
  ttlMs: number,
  nowImpl: () => number = () => Date.now(),
): GrailedCredentialCache {
  let cachedEntry: GrailedCredentialCacheEntry | undefined;

  return {
    clear() {
      cachedEntry = undefined;
    },
    get() {
      if (!cachedEntry) {
        return undefined;
      }

      if (cachedEntry.expiresAt <= nowImpl()) {
        cachedEntry = undefined;
        return undefined;
      }

      return {
        appId: cachedEntry.appId,
        apiKey: cachedEntry.apiKey,
      };
    },
    set(credentials) {
      cachedEntry = {
        ...credentials,
        expiresAt: nowImpl() + ttlMs,
      };

      return {
        appId: cachedEntry.appId,
        apiKey: cachedEntry.apiKey,
      };
    },
  };
}
