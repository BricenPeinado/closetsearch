import type { WorkerJobHandler } from "./types.js";
import { WorkerJobError } from "./types.js";

function numericPayload(payload: Record<string, unknown>, key: string, fallback: number) {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function createCoreWorkerHandlers(now: () => Date = () => new Date()) {
  const handlers = new Map<string, WorkerJobHandler>();

  handlers.set("engagement.rollup_day", async ({ dataPlane, job }) => {
    const configuredDay =
      typeof job.payload.day === "string"
        ? new Date(`${job.payload.day}T00:00:00.000Z`)
        : new Date(now().getTime() - 86_400_000);

    if (Number.isNaN(configuredDay.getTime())) {
      throw new WorkerJobError("Engagement rollup day is invalid.", "invalid_rollup_day", true);
    }

    const records = await dataPlane.engagement.rollupDay(configuredDay);
    return {
      checkpoint: {
        day: configuredDay.toISOString().slice(0, 10),
        records,
      },
    };
  });

  handlers.set("listings.mark_stale", async ({ dataPlane, job }) => {
    const ageSeconds = Math.max(60, numericPayload(job.payload, "ageSeconds", 86_400));
    const limit = Math.max(1, Math.min(5_000, numericPayload(job.payload, "limit", 500)));
    const occurredAt = now();
    const cutoff = new Date(occurredAt.getTime() - ageSeconds * 1_000);
    const records = await dataPlane.listings.markStale(cutoff, occurredAt, limit);

    return {
      checkpoint: {
        cutoff: cutoff.toISOString(),
        records,
      },
    };
  });

  return handlers;
}
