import type { ListingObservationInput } from "../db/postgres/model.js";
import type { ProviderHealthState } from "../db/postgres/repositories/providers.js";
import {
  WorkerJobError,
  type WorkerJobHandler,
} from "./types.js";

export interface ProviderIngestionRequest {
  continuationCursor?: unknown;
  ingestionScope: "active" | "refresh" | "sold" | "watchlist";
  queryKey: string;
  signal: AbortSignal;
}

export interface ProviderIngestionPage {
  continuationCursor?: unknown;
  health?: {
    circuitOpenUntil?: Date;
    latencyMs?: number;
    metadata?: Record<string, unknown>;
    rateLimitedUntil?: Date;
    state: ProviderHealthState;
  };
  listings: ListingObservationInput[];
}

export interface ProviderIngestionSource {
  readonly providerId: string;
  fetchPage(request: ProviderIngestionRequest): Promise<ProviderIngestionPage>;
}

interface IngestionJobPayload {
  ingestionScope: ProviderIngestionRequest["ingestionScope"];
  providerId: string;
  queryKey: string;
  successIntervalSeconds?: number;
}

function parsePayload(payload: Record<string, unknown>): IngestionJobPayload {
  const providerId =
    typeof payload.providerId === "string" ? payload.providerId.trim() : "";
  const queryKey =
    typeof payload.queryKey === "string" ? payload.queryKey.trim() : "";
  const ingestionScope = payload.ingestionScope;

  if (
    !providerId ||
    !queryKey ||
    (ingestionScope !== "active" &&
      ingestionScope !== "refresh" &&
      ingestionScope !== "sold" &&
      ingestionScope !== "watchlist")
  ) {
    throw new WorkerJobError(
      "Provider ingestion job payload is invalid.",
      "invalid_ingestion_payload",
      true,
    );
  }

  const successIntervalSeconds =
    typeof payload.successIntervalSeconds === "number" &&
    Number.isSafeInteger(payload.successIntervalSeconds) &&
    payload.successIntervalSeconds > 0
      ? payload.successIntervalSeconds
      : undefined;

  return {
    ingestionScope,
    providerId,
    queryKey,
    successIntervalSeconds,
  };
}

export function createProviderIngestionHandler(
  sources: readonly ProviderIngestionSource[],
  now: () => Date = () => new Date(),
): WorkerJobHandler {
  const sourcesById = new Map(
    sources.map((source) => [source.providerId, source]),
  );

  return async ({ checkpoint, dataPlane, job, signal }) => {
    const payload = parsePayload(job.payload);
    const source = sourcesById.get(payload.providerId);

    if (!source) {
      throw new WorkerJobError(
        `Provider ${payload.providerId} is not registered in this worker.`,
        "provider_not_registered",
        true,
      );
    }

    const durableCheckpoint =
      await dataPlane.jobs.getIngestionCheckpoint(
        payload.providerId,
        payload.ingestionScope,
        payload.queryKey,
      );
    const startedAt = now();

    try {
      const page = await source.fetchPage({
        continuationCursor: durableCheckpoint?.continuationCursor,
        ingestionScope: payload.ingestionScope,
        queryKey: payload.queryKey,
        signal,
      });

      for (const listing of page.listings) {
        if (listing.providerId !== payload.providerId) {
          throw new WorkerJobError(
            `Provider ${payload.providerId} returned a listing owned by ${listing.providerId}.`,
            "provider_identity_mismatch",
            true,
          );
        }

        const persisted = await dataPlane.listings.upsertObservation(listing);

        if (persisted.persisted && !persisted.duplicate) {
          await dataPlane.alerts.matchListing(
            persisted.listingId,
            listing.observedAt,
          );
        }
      }

      const completedAt = now();
      const nextRunAt =
        page.continuationCursor !== undefined
          ? completedAt
          : new Date(
              completedAt.getTime() +
                (payload.successIntervalSeconds ??
                  job.scheduleIntervalSeconds ??
                  3_600) *
                  1_000,
            );
      const savedCheckpoint = await dataPlane.jobs.saveIngestionCheckpoint({
        continuationCursor: page.continuationCursor,
        expectedVersion: durableCheckpoint?.version ?? 0n,
        ingestionScope: payload.ingestionScope,
        lastSuccessAt: completedAt,
        nextRunAt,
        providerId: payload.providerId,
        queryKey: payload.queryKey,
      });
      const workerCheckpoint = {
        checkpointVersion: savedCheckpoint?.version.toString() ?? "0",
        continuationCursor: page.continuationCursor,
        lastSuccessAt: completedAt.toISOString(),
        processedListings: page.listings.length,
      };
      await checkpoint(workerCheckpoint);
      await dataPlane.providers.recordHealth({
        checkedAt: completedAt,
        circuitOpenUntil: page.health?.circuitOpenUntil,
        latencyMs:
          page.health?.latencyMs ??
          Math.max(0, completedAt.getTime() - startedAt.getTime()),
        metadata: page.health?.metadata,
        providerId: payload.providerId,
        rateLimitedUntil: page.health?.rateLimitedUntil,
        state: page.health?.state ?? "healthy",
      });

      return {
        checkpoint: workerCheckpoint,
        nextRunAt,
      };
    } catch (error) {
      const failedAt = now();
      const jobError =
        error instanceof WorkerJobError
          ? error
          : new WorkerJobError(
              error instanceof Error
                ? error.message
                : "Provider ingestion failed.",
              "provider_ingestion_failed",
            );
      const retryDelayMs = Math.max(
        60_000,
        Math.min(jobError.retryAfterMs ?? 60_000, 86_400_000),
      );

      await dataPlane.jobs.recordIngestionFailure({
        errorCode: jobError.code,
        errorMessage: jobError.message,
        failedAt,
        ingestionScope: payload.ingestionScope,
        nextRunAt: new Date(failedAt.getTime() + retryDelayMs),
        providerId: payload.providerId,
        queryKey: payload.queryKey,
      });
      await dataPlane.providers.recordHealth({
        checkedAt: failedAt,
        circuitOpenUntil:
          jobError.code === "provider_circuit_open"
            ? new Date(failedAt.getTime() + retryDelayMs)
            : undefined,
        errorCode: jobError.code,
        providerId: payload.providerId,
        rateLimitedUntil:
          jobError.code === "provider_rate_limited"
            ? new Date(failedAt.getTime() + retryDelayMs)
            : undefined,
        state: "degraded",
      });
      throw jobError;
    }
  };
}
