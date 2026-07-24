import { randomUUID } from "node:crypto";
import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import {
  LostJobLeaseError,
  type WorkerJob,
} from "../db/postgres/repositories/jobs.js";
import type { Clock } from "../db/postgres/types.js";
import { systemClock } from "../db/postgres/types.js";
import {
  WorkerJobError,
  type WorkerJobHandler,
} from "./types.js";

export interface WorkerRuntimeOptions {
  clock?: Clock;
  concurrency?: number;
  leaseDurationMs?: number;
  logger?: (event: Record<string, unknown>) => void;
  pollIntervalMs?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  workerId?: string;
}

function abortableDelay(delayMs: number, signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 2_000);
  }

  return "Unknown worker failure.";
}

export class WorkerRuntime {
  private readonly clock: Clock;
  private readonly concurrency: number;
  private readonly leaseDurationMs: number;
  private readonly logger: (event: Record<string, unknown>) => void;
  private readonly pollIntervalMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly workerId: string;

  constructor(
    private readonly dataPlane: PostgresDataPlane,
    private readonly handlers: ReadonlyMap<string, WorkerJobHandler>,
    options: WorkerRuntimeOptions = {},
  ) {
    this.clock = options.clock ?? systemClock;
    this.concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 32));
    this.leaseDurationMs = Math.max(
      5_000,
      Math.min(options.leaseDurationMs ?? 60_000, 900_000),
    );
    this.logger = options.logger ?? (() => undefined);
    this.pollIntervalMs = Math.max(
      100,
      Math.min(options.pollIntervalMs ?? 2_000, 60_000),
    );
    this.retryBaseDelayMs = Math.max(
      100,
      options.retryBaseDelayMs ?? 1_000,
    );
    this.retryMaxDelayMs = Math.max(
      this.retryBaseDelayMs,
      options.retryMaxDelayMs ?? 300_000,
    );
    this.workerId = options.workerId ?? `worker-${randomUUID()}`;
  }

  private leaseExpiry() {
    return new Date(this.clock.now().getTime() + this.leaseDurationMs);
  }

  private retryAt(job: WorkerJob) {
    const delay = Math.min(
      this.retryMaxDelayMs,
      this.retryBaseDelayMs * 2 ** Math.max(0, job.attemptCount - 1),
    );
    return new Date(this.clock.now().getTime() + delay);
  }

  private async execute(job: WorkerJob, parentSignal?: AbortSignal) {
    if (!job.leaseToken) {
      return;
    }

    const controller = new AbortController();
    const forwardAbort = () =>
      controller.abort(parentSignal?.reason ?? new Error("Worker stopping."));
    parentSignal?.addEventListener("abort", forwardAbort, { once: true });
    let leaseLost = false;
    let heartbeatRunning = false;
    const heartbeat = setInterval(() => {
      if (heartbeatRunning || controller.signal.aborted) {
        return;
      }

      heartbeatRunning = true;
      void this.dataPlane.jobs
        .renewLease(job.id, job.leaseToken as string, this.leaseExpiry())
        .then((renewed) => {
          if (!renewed) {
            leaseLost = true;
            controller.abort(new LostJobLeaseError(job.id));
          }
        })
        .catch(() => {
          leaseLost = true;
          controller.abort(new LostJobLeaseError(job.id));
        })
        .finally(() => {
          heartbeatRunning = false;
        });
    }, Math.max(1_000, Math.floor(this.leaseDurationMs / 3)));
    heartbeat.unref();

    try {
      const handler = this.handlers.get(job.jobType);

      if (!handler) {
        throw new WorkerJobError(
          `No worker handler is registered for ${job.jobType}.`,
          "handler_not_registered",
          true,
        );
      }

      const result = await handler({
        checkpoint: async (checkpoint) => {
          await this.dataPlane.jobs.checkpoint(
            job.id,
            job.leaseToken as string,
            checkpoint,
            this.leaseExpiry(),
          );
          job.checkpoint = checkpoint;
        },
        dataPlane: this.dataPlane,
        job,
        signal: controller.signal,
      });

      if (leaseLost) {
        throw new LostJobLeaseError(job.id);
      }

      await this.dataPlane.jobs.complete(job, {
        checkpoint: result?.checkpoint,
        completedAt: this.clock.now(),
        nextRunAt: result?.nextRunAt,
      });
      this.logger({
        event: "worker_job_succeeded",
        jobId: job.id,
        jobType: job.jobType,
        workerId: this.workerId,
      });
    } catch (error) {
      if (error instanceof LostJobLeaseError || leaseLost) {
        this.logger({
          event: "worker_job_lease_lost",
          jobId: job.id,
          jobType: job.jobType,
          workerId: this.workerId,
        });
        return;
      }

      const jobError =
        error instanceof WorkerJobError
          ? error
          : new WorkerJobError(
              safeErrorMessage(error),
              "job_handler_failed",
              false,
            );
      await this.dataPlane.jobs.fail(job, {
        errorCode: jobError.code,
        errorMessage: jobError.message,
        failedAt: this.clock.now(),
        retryAt: this.retryAt(job),
        terminal: jobError.terminal,
      });
      this.logger({
        errorCode: jobError.code,
        event: "worker_job_failed",
        jobId: job.id,
        jobType: job.jobType,
        terminal: jobError.terminal,
        workerId: this.workerId,
      });
    } finally {
      clearInterval(heartbeat);
      parentSignal?.removeEventListener("abort", forwardAbort);
    }
  }

  async runOnce(signal?: AbortSignal) {
    const jobs: WorkerJob[] = [];

    for (let index = 0; index < this.concurrency; index += 1) {
      if (signal?.aborted) {
        break;
      }

      const now = this.clock.now();
      const job = await this.dataPlane.jobs.claimNext({
        leaseExpiresAt: new Date(now.getTime() + this.leaseDurationMs),
        now,
        workerId: this.workerId,
      });

      if (!job) {
        break;
      }

      jobs.push(job);
    }

    await Promise.all(jobs.map((job) => this.execute(job, signal)));
    return jobs.length;
  }

  async runUntilStopped(signal: AbortSignal) {
    this.logger({
      concurrency: this.concurrency,
      event: "worker_started",
      workerId: this.workerId,
    });

    while (!signal.aborted) {
      const processed = await this.runOnce(signal);

      if (processed === 0) {
        await abortableDelay(this.pollIntervalMs, signal);
      }
    }

    this.logger({
      event: "worker_stopped",
      workerId: this.workerId,
    });
  }
}
