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

const publicConfigAssignmentPattern = /window\.PUBLIC_CONFIG\s*=\s*/i;

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

export function extractGrailedPublicConfigJson(html: string) {
  const assignmentMatch = html.match(publicConfigAssignmentPattern);

  if (!assignmentMatch || assignmentMatch.index === undefined) {
    throw new Error(
      "Grailed PUBLIC_CONFIG was not found in the fetched HTML document.",
    );
  }

  const objectStartIndex = html.indexOf(
    "{",
    assignmentMatch.index + assignmentMatch[0].length,
  );

  if (objectStartIndex === -1) {
    throw new Error(
      "Grailed PUBLIC_CONFIG was found, but no JSON object start token was present.",
    );
  }

  return findBalancedJsonObject(html, objectStartIndex);
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
