import type { MercariJpRawSearchResponse } from "./raw.js";

export class MercariJpSchemaError extends Error {
  constructor(message = "Mercari Japan returned an unsupported search response shape.") {
    super(message);
    this.name = "MercariJpSchemaError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseMercariJpSearchResponse(value: unknown): MercariJpRawSearchResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new MercariJpSchemaError();
  }
  if (
    (value.nextPageToken !== undefined && typeof value.nextPageToken !== "string") ||
    (value.total !== undefined &&
      (typeof value.total !== "number" || !Number.isSafeInteger(value.total) || value.total < 0))
  ) {
    throw new MercariJpSchemaError();
  }
  return {
    items: value.items,
    nextPageToken: typeof value.nextPageToken === "string" ? value.nextPageToken : undefined,
    total: typeof value.total === "number" ? value.total : undefined,
  };
}
