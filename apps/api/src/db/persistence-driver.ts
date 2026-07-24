export type PersistenceDriver = "postgres" | "sqlite";

export function resolvePersistenceDriver(
  env: Record<string, string | undefined> = process.env,
): PersistenceDriver {
  const configuredDriver = env.PERSISTENCE_DRIVER?.trim().toLowerCase();

  if (configuredDriver === "postgres") {
    return "postgres";
  }

  if (configuredDriver === "sqlite") {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "PERSISTENCE_DRIVER=sqlite is forbidden in production; use postgres.",
      );
    }

    return "sqlite";
  }

  if (!configuredDriver && env.NODE_ENV === "test") {
    return "sqlite";
  }

  throw new Error(
    "PERSISTENCE_DRIVER must be explicitly set to postgres or sqlite.",
  );
}
