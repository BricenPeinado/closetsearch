import type {
  PoolClient,
  QueryResult,
  QueryResultRow,
} from "pg";

export interface PgQueryable {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface PgPoolLike extends PgQueryable {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
  readonly idleCount?: number;
  readonly totalCount?: number;
  readonly waitingCount?: number;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
