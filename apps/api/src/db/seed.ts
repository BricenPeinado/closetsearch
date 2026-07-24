import { fileURLToPath } from "node:url";
import type { Listing } from "@closetsearch/shared";
import { hashPassword } from "../auth/password-service.js";
import { logInfo } from "../logger.js";
import { recordObservedListings } from "../services/priceSnapshotService.js";
import { closeDatabaseConnection, getDatabase, getDatabasePath } from "./database.js";

const seedCreatedAt = "2026-07-02T12:00:00.000Z";
const seedUserId = "seed-closetsearch-demo";

const seedObservedListings: Listing[] = [
  {
    id: "mock:seed-kapital-1",
    providerId: "mock",
    providerListingId: "seed-kapital-1",
    source: { id: "mock", name: "Mock Closet" },
    sourceUrl: "https://mockcloset.example/listings/seed-kapital-1",
    title: "Kapital ring coat",
    brand: { id: "brand:kapital", slug: "kapital", name: "Kapital" },
    imageUrl: "https://cdn.example.com/seed-kapital-1.jpg",
    price: { amount: 180, currency: "USD" },
    category: "jackets",
    size: "M",
    condition: "excellent",
    listingType: "buy_now",
    fetchedAt: "2026-07-16T12:00:00.000Z",
  },
  {
    id: "mock:seed-kapital-2",
    providerId: "mock",
    providerListingId: "seed-kapital-2",
    source: { id: "mock", name: "Mock Closet" },
    sourceUrl: "https://mockcloset.example/listings/seed-kapital-2",
    title: "Kapital denim jacket",
    brand: { id: "brand:kapital", slug: "kapital", name: "Kapital" },
    imageUrl: "https://cdn.example.com/seed-kapital-2.jpg",
    price: { amount: 220, currency: "USD" },
    category: "jackets",
    size: "L",
    condition: "good",
    listingType: "buy_now",
    fetchedAt: "2026-07-16T12:00:00.000Z",
  },
  {
    id: "mock:seed-kapital-3",
    providerId: "mock",
    providerListingId: "seed-kapital-3",
    source: { id: "mock", name: "Mock Closet" },
    sourceUrl: "https://mockcloset.example/listings/seed-kapital-3",
    title: "Kapital work jacket",
    brand: { id: "brand:kapital", slug: "kapital", name: "Kapital" },
    imageUrl: "https://cdn.example.com/seed-kapital-3.jpg",
    price: { amount: 260, currency: "USD" },
    category: "jackets",
    size: "M",
    condition: "excellent",
    listingType: "buy_now",
    fetchedAt: "2026-07-16T12:00:00.000Z",
  },
  {
    id: "mock:seed-kapital-4",
    providerId: "mock",
    providerListingId: "seed-kapital-4",
    source: { id: "mock", name: "Mock Closet" },
    sourceUrl: "https://mockcloset.example/listings/seed-kapital-4",
    title: "Kapital fleece jacket",
    brand: { id: "brand:kapital", slug: "kapital", name: "Kapital" },
    imageUrl: "https://cdn.example.com/seed-kapital-4.jpg",
    price: { amount: 320, currency: "USD" },
    category: "jackets",
    size: "M",
    condition: "excellent",
    listingType: "buy_now",
    fetchedAt: "2026-07-16T12:00:00.000Z",
  },
  {
    id: "mock:seed-undercover-1",
    providerId: "mock",
    providerListingId: "seed-undercover-1",
    source: { id: "mock", name: "Mock Closet" },
    sourceUrl: "https://mockcloset.example/listings/seed-undercover-1",
    title: "Undercover graphic tee",
    brand: { id: "brand:undercover", slug: "undercover", name: "Undercover" },
    imageUrl: "https://cdn.example.com/seed-undercover-1.jpg",
    price: { amount: 90, currency: "USD" },
    category: "tops",
    size: "M",
    condition: "good",
    listingType: "buy_now",
    fetchedAt: "2026-07-16T12:00:00.000Z",
  },
  {
    id: "mock:seed-undercover-2",
    providerId: "mock",
    providerListingId: "seed-undercover-2",
    source: { id: "mock", name: "Mock Closet" },
    sourceUrl: "https://mockcloset.example/listings/seed-undercover-2",
    title: "Undercover long sleeve top",
    brand: { id: "brand:undercover", slug: "undercover", name: "Undercover" },
    imageUrl: "https://cdn.example.com/seed-undercover-2.jpg",
    price: { amount: 120, currency: "USD" },
    category: "tops",
    size: "L",
    condition: "excellent",
    listingType: "buy_now",
    fetchedAt: "2026-07-16T12:00:00.000Z",
  },
];

export function seedDatabase() {
  const database = getDatabase();

  database
    .prepare(
      `INSERT INTO users (
        id,
        username,
        normalized_username,
        password_hash,
        currency_preference,
        onboarding_preferences_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(normalized_username) DO UPDATE SET
        username = excluded.username,
        password_hash = excluded.password_hash,
        currency_preference = excluded.currency_preference,
        onboarding_preferences_json = excluded.onboarding_preferences_json`,
    )
    .run(
      seedUserId,
      "closetdemo",
      "closetdemo",
      hashPassword("closetdemo"),
      "USD",
      JSON.stringify({
        favoriteBrands: ["Our Legacy", "Acne Studios"],
        categories: ["jackets", "knitwear"],
        priceRange: "$100-$300",
      }),
      seedCreatedAt,
    );

  database
    .prepare(
      `INSERT INTO recent_searches (id, user_id, label, description, params, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, params) DO UPDATE SET
        label = excluded.label,
        description = excluded.description,
        created_at = excluded.created_at`,
    )
    .run(
      "seed-recent-search-1",
      seedUserId,
      "Our Legacy jacket",
      "grailed • Fixed price • Newest first",
      "q=Our+Legacy+jacket&source=grailed&listingType=buy_now&sort=newest",
      seedCreatedAt,
    );

  database
    .prepare(
      `INSERT INTO saved_searches (id, user_id, label, description, params, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, params) DO UPDATE SET
        label = excluded.label,
        description = excluded.description,
        created_at = excluded.created_at`,
    )
    .run(
      "seed-saved-search-1",
      seedUserId,
      "Archive outerwear",
      "grailed • Price high to low",
      "q=archive+outerwear&source=grailed&sort=price_desc",
      seedCreatedAt,
    );

  database
    .prepare(
      `INSERT INTO saved_filters (
        id,
        user_id,
        label,
        params_key,
        query_text,
        source_filter,
        listing_type_filter,
        min_price,
        max_price,
        sort_mode,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, params_key) DO UPDATE SET
        label = excluded.label,
        query_text = excluded.query_text,
        source_filter = excluded.source_filter,
        listing_type_filter = excluded.listing_type_filter,
        min_price = excluded.min_price,
        max_price = excluded.max_price,
        sort_mode = excluded.sort_mode,
        updated_at = excluded.updated_at`,
    )
    .run(
      "seed-saved-filter-1",
      seedUserId,
      "Kapital preset",
      "q=kapital|source=grailed|listingType=buy_now|maxPrice=300|sort=newest",
      "kapital",
      "grailed",
      "buy_now",
      100,
      300,
      "newest",
      seedCreatedAt,
      seedCreatedAt,
    );

  database
    .prepare(
      `INSERT INTO watchlists (
        id,
        user_id,
        label,
        query_text,
        brand,
        category,
        source_filter,
        listing_type,
        min_price_amount,
        max_price_amount,
        max_price,
        price_currency,
        condition,
        size,
        enabled,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        query_text = excluded.query_text,
        brand = excluded.brand,
        category = excluded.category,
        source_filter = excluded.source_filter,
        listing_type = excluded.listing_type,
        min_price_amount = excluded.min_price_amount,
        max_price_amount = excluded.max_price_amount,
        max_price = excluded.max_price,
        price_currency = excluded.price_currency,
        condition = excluded.condition,
        size = excluded.size,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at`,
    )
    .run(
      "seed-watchlist-1",
      seedUserId,
      "Kapital under $300",
      "kapital",
      "Kapital",
      "jackets",
      "grailed",
      "buy_now",
      100,
      300,
      300,
      "USD",
      "excellent",
      "M",
      1,
      seedCreatedAt,
      seedCreatedAt,
    );

  database
    .prepare(
      `INSERT INTO user_settings (
        user_id,
        display_name,
        default_sort_mode,
        preferred_sources_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        display_name = excluded.display_name,
        default_sort_mode = excluded.default_sort_mode,
        preferred_sources_json = excluded.preferred_sources_json,
        updated_at = excluded.updated_at`,
    )
    .run(
      seedUserId,
      "Closet Demo",
      "newest",
      JSON.stringify(["grailed", "mock"]),
      seedCreatedAt,
      seedCreatedAt,
    );

  database
    .prepare(
      `INSERT INTO notification_preferences (
        user_id,
        email_enabled,
        push_enabled,
        sms_enabled,
        in_app_enabled,
        frequency,
        quiet_hours_start,
        quiet_hours_end,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        email_enabled = excluded.email_enabled,
        push_enabled = excluded.push_enabled,
        sms_enabled = excluded.sms_enabled,
        in_app_enabled = excluded.in_app_enabled,
        frequency = excluded.frequency,
        quiet_hours_start = excluded.quiet_hours_start,
        quiet_hours_end = excluded.quiet_hours_end,
        updated_at = excluded.updated_at`,
    )
    .run(seedUserId, 0, 0, 0, 1, "daily", "22:00", "08:00", seedCreatedAt, seedCreatedAt);

  recordObservedListings(seedObservedListings);
}

async function runSeedCli() {
  seedDatabase();
  logInfo("Seed command completed", {
    databasePath: getDatabasePath(),
    seededUser: "closetdemo",
  });
  closeDatabaseConnection();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runSeedCli();
}
