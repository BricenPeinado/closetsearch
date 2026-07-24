import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { PostgresDatabase } from "../database.js";

export type WorkerJobStatus =
  | "dead_letter"
  | "paused"
  | "queued"
  | "retry_wait"
  | "running"
  | "succeeded";

export interface WorkerJob {
  attemptCount: number;
  checkpoint?: unknown;
  consecutiveFailures: number;
  enabled: boolean;
  id: string;
  jobKey: string;
  jobType: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  leaseExpiresAt?: Date;
  leaseOwner?: string;
  leaseToken?: string;
  maxAttempts: number;
  payload: Record<string, unknown>;
  priority: number;
  runAfter: Date;
  scheduleIntervalSeconds?: number;
  status: WorkerJobStatus;
}

interface WorkerJobRow extends QueryResultRow {
  id: string;
  job_key: string;
  job_type: string;
  payload: Record<string, unknown> | string;
  checkpoint: unknown;
  status: WorkerJobStatus;
  enabled: boolean;
  priority: number;
  run_after: Date | string;
  schedule_interval_seconds: number | null;
  attempt_count: number;
  consecutive_failures: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  last_error_code: string | null;
  last_error_message: string | null;
}

interface IngestionCheckpointRow extends QueryResultRow {
  id: string;
  provider_id: string;
  ingestion_scope: "active" | "refresh" | "sold" | "watchlist";
  query_key: string;
  continuation_cursor: unknown;
  checkpoint_version: string | number | bigint;
  last_success_at: Date | string | null;
  next_run_at: Date | string;
  consecutive_failures: number;
}

export interface IngestionCheckpoint {
  consecutiveFailures: number;
  continuationCursor?: unknown;
  id: string;
  ingestionScope: "active" | "refresh" | "sold" | "watchlist";
  lastSuccessAt?: Date;
  nextRunAt: Date;
  providerId: string;
  queryKey: string;
  version: bigint;
}

export class LostJobLeaseError extends Error {
  constructor(jobId: string) {
    super(`Worker lease for job ${jobId} is no longer valid.`);
    this.name = "LostJobLeaseError";
  }
}

function parseJsonObject(value: Record<string, unknown> | string) {
  if (typeof value === "string") {
    return JSON.parse(value) as Record<string, unknown>;
  }

  return value;
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function mapWorkerJob(row: WorkerJobRow): WorkerJob {
  return {
    attemptCount: Number(row.attempt_count),
    checkpoint: row.checkpoint ?? undefined,
    consecutiveFailures: Number(row.consecutive_failures),
    enabled: row.enabled,
    id: row.id,
    jobKey: row.job_key,
    jobType: row.job_type,
    lastErrorCode: row.last_error_code ?? undefined,
    lastErrorMessage: row.last_error_message ?? undefined,
    leaseExpiresAt: row.lease_expires_at
      ? toDate(row.lease_expires_at)
      : undefined,
    leaseOwner: row.lease_owner ?? undefined,
    leaseToken: row.lease_token ?? undefined,
    maxAttempts: Number(row.max_attempts),
    payload: parseJsonObject(row.payload),
    priority: Number(row.priority),
    runAfter: toDate(row.run_after),
    scheduleIntervalSeconds:
      row.schedule_interval_seconds === null
        ? undefined
        : Number(row.schedule_interval_seconds),
    status: row.status,
  };
}

function selectWorkerJobColumns(prefix = "") {
  return `
    ${prefix}id,
    ${prefix}job_key,
    ${prefix}job_type,
    ${prefix}payload,
    ${prefix}checkpoint,
    ${prefix}status,
    ${prefix}enabled,
    ${prefix}priority,
    ${prefix}run_after,
    ${prefix}schedule_interval_seconds,
    ${prefix}attempt_count,
    ${prefix}consecutive_failures,
    ${prefix}max_attempts,
    ${prefix}lease_owner,
    ${prefix}lease_token,
    ${prefix}lease_expires_at,
    ${prefix}last_error_code,
    ${prefix}last_error_message
  `;
}

export interface EnqueueJobInput {
  enabled?: boolean;
  id?: string;
  jobKey: string;
  jobType: string;
  maxAttempts?: number;
  payload?: Record<string, unknown>;
  priority?: number;
  runAfter: Date;
  scheduleIntervalSeconds?: number;
}

export interface ClaimJobInput {
  leaseExpiresAt: Date;
  now: Date;
  workerId: string;
}

export interface JobRepositoryOptions {
  supportsSkipLocked?: boolean;
}

export class JobRepository {
  private readonly supportsSkipLocked: boolean;

  constructor(
    private readonly database: PostgresDatabase,
    options: JobRepositoryOptions = {},
  ) {
    this.supportsSkipLocked = options.supportsSkipLocked ?? true;
  }

  async enqueue(input: EnqueueJobInput) {
    const result = await this.database.query<WorkerJobRow>(
      `INSERT INTO worker_jobs (
         id,
         job_key,
         job_type,
         payload,
         status,
         enabled,
         priority,
         run_after,
         schedule_interval_seconds,
         max_attempts
       ) VALUES (
         $1, $2, $3, $4::jsonb, 'queued', $5, $6, $7, $8, $9
       )
       ON CONFLICT (job_key) DO UPDATE SET
         job_type = EXCLUDED.job_type,
         payload = EXCLUDED.payload,
         enabled = EXCLUDED.enabled,
         priority = EXCLUDED.priority,
         run_after = CASE
           WHEN EXCLUDED.run_after < worker_jobs.run_after
             THEN EXCLUDED.run_after
           ELSE worker_jobs.run_after
         END,
         schedule_interval_seconds = EXCLUDED.schedule_interval_seconds,
         max_attempts = EXCLUDED.max_attempts,
         status = CASE
           WHEN worker_jobs.status IN ('paused', 'dead_letter')
             THEN worker_jobs.status
           ELSE 'queued'
         END,
         updated_at = CURRENT_TIMESTAMP
       RETURNING ${selectWorkerJobColumns()}`,
      [
        input.id ?? randomUUID(),
        input.jobKey,
        input.jobType,
        JSON.stringify(input.payload ?? {}),
        input.enabled ?? true,
        input.priority ?? 0,
        input.runAfter,
        input.scheduleIntervalSeconds ?? null,
        input.maxAttempts ?? 10,
      ],
    );

    return mapWorkerJob(result.rows[0]);
  }

  async claimNext(input: ClaimJobInput) {
    return this.database.withTransaction(async (client) => {
      const lockClause = this.supportsSkipLocked
        ? "FOR UPDATE SKIP LOCKED"
        : "";

      const expiredRuns = await client.query<{
        job_id: string;
        lease_token: string;
      }>(
        `SELECT r.job_id, r.lease_token
         FROM worker_job_runs r
         JOIN worker_jobs j
           ON j.id = r.job_id
          AND j.lease_token = r.lease_token
         WHERE r.status = 'running'
           AND j.lease_expires_at <= $1`,
        [input.now],
      );

      for (const expiredRun of expiredRuns.rows) {
        await client.query(
          `UPDATE worker_job_runs
           SET status = 'abandoned',
               finished_at = $3,
               error_code = 'lease_expired',
               error_message = 'The worker lease expired before completion.'
           WHERE job_id = $1
             AND lease_token = $2
             AND status = 'running'`,
          [expiredRun.job_id, expiredRun.lease_token, input.now],
        );
      }

      const leaseToken = randomUUID();
      const runId = randomUUID();
      const claimedResult = await client.query<WorkerJobRow>(
        `UPDATE worker_jobs
         SET status = 'running',
             lease_owner = $2,
             lease_token = $3,
             lease_expires_at = $4,
             attempt_count = attempt_count + 1,
             last_started_at = $1,
             last_error_code = NULL,
             last_error_message = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = (
           SELECT id
           FROM worker_jobs
           WHERE enabled = TRUE
             AND run_after <= $1
             AND (
               status IN ('queued', 'retry_wait')
               OR (
                 status = 'running'
                 AND lease_expires_at IS NOT NULL
                 AND lease_expires_at <= $1
               )
             )
           ORDER BY priority DESC, run_after, id
           LIMIT 1
           ${lockClause}
         )
           AND enabled = TRUE
           AND run_after <= $1
           AND (
             status IN ('queued', 'retry_wait')
             OR (
               status = 'running'
               AND lease_expires_at IS NOT NULL
               AND lease_expires_at <= $1
             )
           )
         RETURNING ${selectWorkerJobColumns()}`,
        [
          input.now,
          input.workerId,
          leaseToken,
          input.leaseExpiresAt,
        ],
      );
      const claimed = claimedResult.rows[0];

      if (!claimed) {
        return undefined;
      }

      await client.query(
        `INSERT INTO worker_job_runs (
           id,
           job_id,
           lease_token,
           worker_id,
           status,
           started_at,
           checkpoint_before
         ) VALUES ($1, $2, $3, $4, 'running', $5, $6::jsonb)`,
        [
          runId,
          claimed.id,
          leaseToken,
          input.workerId,
          input.now,
          claimed.checkpoint === null
            ? null
            : JSON.stringify(claimed.checkpoint),
        ],
      );

      return mapWorkerJob(claimed);
    });
  }

  async renewLease(
    jobId: string,
    leaseToken: string,
    leaseExpiresAt: Date,
  ) {
    const result = await this.database.query(
      `UPDATE worker_jobs
       SET lease_expires_at = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND lease_token = $2
         AND status = 'running'`,
      [jobId, leaseToken, leaseExpiresAt],
    );

    return result.rowCount === 1;
  }

  async checkpoint(
    jobId: string,
    leaseToken: string,
    checkpoint: unknown,
    leaseExpiresAt: Date,
  ) {
    return this.database.withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE worker_jobs
         SET checkpoint = $3::jsonb,
             lease_expires_at = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND lease_token = $2
           AND status = 'running'`,
        [jobId, leaseToken, JSON.stringify(checkpoint), leaseExpiresAt],
      );

      if (result.rowCount !== 1) {
        throw new LostJobLeaseError(jobId);
      }

      await client.query(
        `UPDATE worker_job_runs
         SET checkpoint_after = $3::jsonb
         WHERE job_id = $1
           AND lease_token = $2
           AND status = 'running'`,
        [jobId, leaseToken, JSON.stringify(checkpoint)],
      );
    });
  }

  async complete(
    job: Pick<
      WorkerJob,
      "id" | "leaseToken" | "scheduleIntervalSeconds"
    >,
    input: {
      checkpoint?: unknown;
      completedAt: Date;
      nextRunAt?: Date;
    },
  ) {
    if (!job.leaseToken) {
      throw new LostJobLeaseError(job.id);
    }

    const recurring = job.scheduleIntervalSeconds !== undefined;
    const nextRunAt =
      input.nextRunAt ??
      (recurring
        ? new Date(
            input.completedAt.getTime() +
              (job.scheduleIntervalSeconds ?? 0) * 1_000,
          )
        : input.completedAt);

    return this.database.withTransaction(async (client) => {
      const result = await client.query<WorkerJobRow>(
        `UPDATE worker_jobs
         SET checkpoint = COALESCE($3::jsonb, checkpoint),
             status = $4,
             run_after = $5,
             consecutive_failures = 0,
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             last_succeeded_at = $6,
             last_error_code = NULL,
             last_error_message = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND lease_token = $2
           AND status = 'running'
         RETURNING ${selectWorkerJobColumns()}`,
        [
          job.id,
          job.leaseToken,
          input.checkpoint === undefined
            ? null
            : JSON.stringify(input.checkpoint),
          recurring ? "queued" : "succeeded",
          nextRunAt,
          input.completedAt,
        ],
      );

      if (result.rowCount !== 1) {
        throw new LostJobLeaseError(job.id);
      }

      await client.query(
        `UPDATE worker_job_runs
         SET status = 'succeeded',
             finished_at = $3,
             checkpoint_after = COALESCE($4::jsonb, checkpoint_after)
         WHERE job_id = $1
           AND lease_token = $2
           AND status = 'running'`,
        [
          job.id,
          job.leaseToken,
          input.completedAt,
          input.checkpoint === undefined
            ? null
            : JSON.stringify(input.checkpoint),
        ],
      );

      return mapWorkerJob(result.rows[0]);
    });
  }

  async fail(
    job: Pick<WorkerJob, "id" | "leaseToken">,
    input: {
      errorCode: string;
      errorMessage: string;
      failedAt: Date;
      retryAt: Date;
      terminal?: boolean;
    },
  ) {
    if (!job.leaseToken) {
      throw new LostJobLeaseError(job.id);
    }

    return this.database.withTransaction(async (client) => {
      const currentResult = await client.query<WorkerJobRow>(
        `SELECT ${selectWorkerJobColumns()}
         FROM worker_jobs
         WHERE id = $1 AND lease_token = $2
         FOR UPDATE`,
        [job.id, job.leaseToken],
      );
      const current = currentResult.rows[0];

      if (!current) {
        throw new LostJobLeaseError(job.id);
      }

      const deadLetter =
        input.terminal ||
        Number(current.attempt_count) >= Number(current.max_attempts);
      const result = await client.query<WorkerJobRow>(
        `UPDATE worker_jobs
         SET status = $3,
             run_after = $4,
             consecutive_failures = consecutive_failures + 1,
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             last_failed_at = $5,
             last_error_code = $6,
             last_error_message = $7,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND lease_token = $2
         RETURNING ${selectWorkerJobColumns()}`,
        [
          job.id,
          job.leaseToken,
          deadLetter ? "dead_letter" : "retry_wait",
          input.retryAt,
          input.failedAt,
          input.errorCode,
          input.errorMessage.slice(0, 2_000),
        ],
      );

      await client.query(
        `UPDATE worker_job_runs
         SET status = 'failed',
             finished_at = $3,
             error_code = $4,
             error_message = $5
         WHERE job_id = $1
           AND lease_token = $2
           AND status = 'running'`,
        [
          job.id,
          job.leaseToken,
          input.failedAt,
          input.errorCode,
          input.errorMessage.slice(0, 2_000),
        ],
      );

      return mapWorkerJob(result.rows[0]);
    });
  }

  async getByKey(jobKey: string) {
    const result = await this.database.query<WorkerJobRow>(
      `SELECT ${selectWorkerJobColumns()}
       FROM worker_jobs
       WHERE job_key = $1`,
      [jobKey],
    );

    return result.rows[0] ? mapWorkerJob(result.rows[0]) : undefined;
  }

  async listStatuses() {
    const result = await this.database.query<WorkerJobRow>(
      `SELECT ${selectWorkerJobColumns()}
       FROM worker_jobs
       ORDER BY run_after, priority DESC, id`,
    );

    return result.rows.map(mapWorkerJob);
  }

  async getIngestionCheckpoint(
    providerId: string,
    ingestionScope: IngestionCheckpoint["ingestionScope"],
    queryKey: string,
  ) {
    const result = await this.database.query<IngestionCheckpointRow>(
      `SELECT
         id,
         provider_id,
         ingestion_scope,
         query_key,
         continuation_cursor,
         checkpoint_version,
         last_success_at,
         next_run_at,
         consecutive_failures
       FROM provider_ingestion_checkpoints
       WHERE provider_id = $1
         AND ingestion_scope = $2
         AND query_key = $3`,
      [providerId, ingestionScope, queryKey],
    );
    const row = result.rows[0];

    if (!row) {
      return undefined;
    }

    return {
      consecutiveFailures: Number(row.consecutive_failures),
      continuationCursor: row.continuation_cursor ?? undefined,
      id: row.id,
      ingestionScope: row.ingestion_scope,
      lastSuccessAt: row.last_success_at
        ? toDate(row.last_success_at)
        : undefined,
      nextRunAt: toDate(row.next_run_at),
      providerId: row.provider_id,
      queryKey: row.query_key,
      version: BigInt(row.checkpoint_version),
    } satisfies IngestionCheckpoint;
  }

  async saveIngestionCheckpoint(input: {
    consecutiveFailures?: number;
    continuationCursor?: unknown;
    expectedVersion: bigint;
    ingestionScope: IngestionCheckpoint["ingestionScope"];
    lastSuccessAt?: Date;
    nextRunAt: Date;
    providerId: string;
    queryKey: string;
  }) {
    const id = randomUUID();
    const result = await this.database.query<IngestionCheckpointRow>(
      `INSERT INTO provider_ingestion_checkpoints (
         id,
         provider_id,
         ingestion_scope,
         query_key,
         continuation_cursor,
         checkpoint_version,
         last_attempt_at,
         last_success_at,
         next_run_at,
         consecutive_failures
       ) VALUES ($1, $2, $3, $4, $5::jsonb, 1, CURRENT_TIMESTAMP, $6, $7, $8)
       ON CONFLICT (provider_id, ingestion_scope, query_key) DO UPDATE SET
         continuation_cursor = EXCLUDED.continuation_cursor,
         checkpoint_version =
           provider_ingestion_checkpoints.checkpoint_version + 1,
         last_attempt_at = CURRENT_TIMESTAMP,
         last_success_at = COALESCE(
           EXCLUDED.last_success_at,
           provider_ingestion_checkpoints.last_success_at
         ),
         next_run_at = EXCLUDED.next_run_at,
         consecutive_failures = EXCLUDED.consecutive_failures,
         updated_at = CURRENT_TIMESTAMP
       WHERE provider_ingestion_checkpoints.checkpoint_version = $9
       RETURNING
         id,
         provider_id,
         ingestion_scope,
         query_key,
         continuation_cursor,
         checkpoint_version,
         last_success_at,
         next_run_at,
         consecutive_failures`,
      [
        id,
        input.providerId,
        input.ingestionScope,
        input.queryKey,
        input.continuationCursor === undefined
          ? null
          : JSON.stringify(input.continuationCursor),
        input.lastSuccessAt ?? null,
        input.nextRunAt,
        input.consecutiveFailures ?? 0,
        input.expectedVersion,
      ],
    );

    if (result.rowCount !== 1) {
      throw new Error(
        `Ingestion checkpoint ${input.providerId}/${input.ingestionScope}/${input.queryKey} was concurrently modified.`,
      );
    }

    return this.getIngestionCheckpoint(
      input.providerId,
      input.ingestionScope,
      input.queryKey,
    );
  }
}
