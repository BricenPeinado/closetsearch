const tokenStopWords = new Set([
  "and",
  "for",
  "from",
  "new",
  "the",
  "this",
  "with",
]);

export function normalizeToken(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

export function tokenize(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !tokenStopWords.has(token)),
    ),
  ).sort();
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

export function stableFingerprint(value: unknown) {
  const text = stableStringify(value);
  let hash = 2_166_136_261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function seededUnitInterval(seed: number, key: string) {
  const fingerprint = stableFingerprint([seed, key]);
  return Number.parseInt(fingerprint, 16) / 0xffff_ffff;
}

export function roundMetric(value: number, digits = 6) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(digits));
}

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function mean(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function quantile(values: number[], probability: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const position = clamp(probability, 0, 1) * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const fraction = position - lowerIndex;
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;

  return lower + (upper - lower) * fraction;
}

export function median(values: number[]) {
  return quantile(values, 0.5);
}

export function toTimestamp(value: string, fieldName: string) {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    throw new Error(`${fieldName} must be a valid ISO timestamp; received ${value}.`);
  }

  return timestamp;
}

export function daysBetween(earlier: string, later: string) {
  return Math.max(0, toTimestamp(later, "later") - toTimestamp(earlier, "earlier")) / 86_400_000;
}

export function countDistribution(values: string[]) {
  const counts = new Map<string, number>();

  for (const value of values) {
    const normalized = normalizeToken(value) || "unknown";
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  const denominator = Math.max(values.length, 1);
  return Object.fromEntries(
    Array.from(counts.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, count]) => [key, count / denominator]),
  );
}

export function totalVariationDistance(
  baseline: Record<string, number>,
  current: Record<string, number>,
) {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  let distance = 0;

  for (const key of keys) {
    distance += Math.abs((baseline[key] ?? 0) - (current[key] ?? 0));
  }

  return distance / 2;
}
