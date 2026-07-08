import { fileURLToPath } from "node:url";
import { hashPassword } from "../auth/password-service.js";
import { closeDatabaseConnection, getDatabase, getDatabasePath } from "./database.js";

export function seedDatabase() {
  const database = getDatabase();
  const createdAt = "2026-07-02T12:00:00.000Z";
  const userId = "seed-closetsearch-demo";

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
      userId,
      "closetdemo",
      "closetdemo",
      hashPassword("closetdemo"),
      "USD",
      JSON.stringify({
        favoriteBrands: ["Our Legacy", "Acne Studios"],
        categories: ["jackets", "knitwear"],
        priceRange: "$100-$300",
      }),
      createdAt,
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
      userId,
      "Our Legacy jacket",
      "grailed • Fixed price • Newest first",
      "q=Our+Legacy+jacket&source=grailed&listingType=buy_now&sort=newest",
      createdAt,
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
      userId,
      "Archive outerwear",
      "grailed • Price high to low",
      "q=archive+outerwear&source=grailed&sort=price_desc",
      createdAt,
    );
}

async function runSeedCli() {
  seedDatabase();
  console.log(`Seeded database at ${getDatabasePath()}.`);
  closeDatabaseConnection();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runSeedCli();
}
