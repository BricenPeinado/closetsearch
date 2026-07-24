export interface DatabaseMetricsSnapshot {
  completedQueries: number;
  failedQueries: number;
  queryLatencyMsTotal: number;
  retries: number;
  poolErrors: number;
  transactionsCommitted: number;
  transactionsRolledBack: number;
  pool: {
    idle: number;
    total: number;
    waiting: number;
  };
}

export class DatabaseMetrics {
  private completedQueries = 0;
  private failedQueries = 0;
  private queryLatencyMsTotal = 0;
  private retries = 0;
  private poolErrors = 0;
  private transactionsCommitted = 0;
  private transactionsRolledBack = 0;

  recordQuery(durationMs: number, succeeded: boolean) {
    this.queryLatencyMsTotal += Math.max(0, durationMs);

    if (succeeded) {
      this.completedQueries += 1;
    } else {
      this.failedQueries += 1;
    }
  }

  recordRetry() {
    this.retries += 1;
  }

  recordPoolError() {
    this.poolErrors += 1;
  }

  recordTransactionCommitted() {
    this.transactionsCommitted += 1;
  }

  recordTransactionRolledBack() {
    this.transactionsRolledBack += 1;
  }

  snapshot(pool?: {
    idleCount?: number;
    totalCount?: number;
    waitingCount?: number;
  }): DatabaseMetricsSnapshot {
    return {
      completedQueries: this.completedQueries,
      failedQueries: this.failedQueries,
      queryLatencyMsTotal: this.queryLatencyMsTotal,
      retries: this.retries,
      poolErrors: this.poolErrors,
      transactionsCommitted: this.transactionsCommitted,
      transactionsRolledBack: this.transactionsRolledBack,
      pool: {
        idle: pool?.idleCount ?? 0,
        total: pool?.totalCount ?? 0,
        waiting: pool?.waitingCount ?? 0,
      },
    };
  }
}
