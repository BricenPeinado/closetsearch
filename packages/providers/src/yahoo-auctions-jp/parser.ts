import type { YahooAuctionsJpRawSearchResponse } from "./raw.js";

export class YahooAuctionsJpSchemaError extends Error {
  constructor(message = "Yahoo! Auctions Japan returned an unsupported search response shape.") {
    super(message);
    this.name = "YahooAuctionsJpSchemaError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseYahooAuctionsJpSearchResponse(
  value: unknown,
): YahooAuctionsJpRawSearchResponse {
  if (!isRecord(value) || !Array.isArray(value.listings)) {
    throw new YahooAuctionsJpSchemaError();
  }
  if (value.pagination !== undefined && !isRecord(value.pagination)) {
    throw new YahooAuctionsJpSchemaError();
  }

  const pagination = value.pagination as Record<string, unknown> | undefined;
  const nextPage = pagination?.nextPage;
  const total = pagination?.total;
  if (
    (nextPage !== undefined &&
      (typeof nextPage !== "number" || !Number.isSafeInteger(nextPage) || nextPage < 1)) ||
    (total !== undefined &&
      (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0))
  ) {
    throw new YahooAuctionsJpSchemaError();
  }

  return {
    listings: value.listings,
    pagination: pagination
      ? {
          nextPage: typeof nextPage === "number" ? nextPage : undefined,
          total: typeof total === "number" ? total : undefined,
        }
      : undefined,
  };
}
