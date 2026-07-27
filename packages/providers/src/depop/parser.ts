import type { DepopRawSearchResponse } from "./raw.js";

export class DepopSchemaError extends Error {
  constructor(message = "Depop returned an unsupported search response shape.") {
    super(message);
    this.name = "DepopSchemaError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseDepopSearchResponse(value: unknown): DepopRawSearchResponse {
  if (!isRecord(value) || !Array.isArray(value.products)) {
    throw new DepopSchemaError();
  }

  if (value.meta !== undefined && !isRecord(value.meta)) {
    throw new DepopSchemaError();
  }

  const meta = value.meta as Record<string, unknown> | undefined;
  const nextCursor = meta?.nextCursor;
  const total = meta?.total;

  if (
    (nextCursor !== undefined && typeof nextCursor !== "string") ||
    (total !== undefined &&
      (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0))
  ) {
    throw new DepopSchemaError();
  }

  return {
    products: value.products,
    meta: meta
      ? {
          nextCursor: typeof nextCursor === "string" ? nextCursor : undefined,
          total: typeof total === "number" ? total : undefined,
        }
      : undefined,
  };
}
