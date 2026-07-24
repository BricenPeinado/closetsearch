import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import type { WorkerJob } from "../db/postgres/repositories/jobs.js";

export interface WorkerJobResult {
  checkpoint?: unknown;
  nextRunAt?: Date;
}

export interface WorkerJobContext {
  checkpoint(value: unknown): Promise<void>;
  dataPlane: PostgresDataPlane;
  job: WorkerJob;
  signal: AbortSignal;
}

export type WorkerJobHandler = (
  context: WorkerJobContext,
) => Promise<WorkerJobResult | void>;

export class WorkerJobError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly terminal = false,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "WorkerJobError";
  }
}
