import type { PostgresDatabase } from "./database.js";
import { AlertRepository } from "./repositories/alerts.js";
import { EngagementRepository } from "./repositories/engagement.js";
import { EntitlementRepository } from "./repositories/entitlements.js";
import { JobRepository, type JobRepositoryOptions } from "./repositories/jobs.js";
import { ListingRepository, type ListingRepositoryOptions } from "./repositories/listings.js";
import { ProviderRepository } from "./repositories/providers.js";
import { PostgresRequestStore } from "./request-store.js";
import type { RequestStoreOptions } from "./request-store-types.js";

export class PostgresDataPlane {
  readonly alerts: AlertRepository;
  readonly engagement: EngagementRepository;
  readonly entitlements: EntitlementRepository;
  readonly jobs: JobRepository;
  readonly listings: ListingRepository;
  readonly providers: ProviderRepository;
  readonly requestStore: PostgresRequestStore;

  constructor(
    readonly database: PostgresDatabase,
    options: {
      jobs?: JobRepositoryOptions;
      listings?: ListingRepositoryOptions;
      requestStore?: RequestStoreOptions;
    } = {},
  ) {
    this.alerts = new AlertRepository(database);
    this.engagement = new EngagementRepository(database);
    this.entitlements = new EntitlementRepository(database);
    this.jobs = new JobRepository(database, options.jobs);
    this.listings = new ListingRepository(database, options.listings);
    this.providers = new ProviderRepository(database);
    this.requestStore = new PostgresRequestStore(database, options.requestStore);
  }
}
