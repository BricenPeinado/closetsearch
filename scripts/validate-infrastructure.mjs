import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const requiredFiles = [
  ".dockerignore",
  ".env.compose.example",
  "Dockerfile.api",
  "Dockerfile.web",
  "Dockerfile.worker",
  "docker-compose.yml",
  "deploy/nginx.conf",
  "package.json",
  "playwright.config.ts",
  "scripts/postgres-backup.sh",
  "scripts/postgres-restore.sh",
  "scripts/production-smoke-test.mjs",
  ".github/workflows/ci.yml",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function assertContains(source, values, subject) {
  for (const value of values) {
    assert(source.includes(value), `${subject} is missing ${value}.`);
  }
}

async function main() {
  const files = Object.fromEntries(
    await Promise.all(requiredFiles.map(async (path) => [path, await text(path)])),
  );
  const compose = files["docker-compose.yml"];
  const rootPackage = JSON.parse(files["package.json"]);

  assertContains(
    compose,
    [
      "postgres:",
      "migrate:",
      "api:",
      "worker:",
      "web:",
      "condition: service_healthy",
      "condition: service_completed_successfully",
      "PROVIDER_ALLOW_MOCK_FALLBACK:",
      "PROVIDER_MOCK_ENABLED:",
      "PERSISTENCE_DRIVER:",
      "WORKER_PROVIDER_INGESTION_ENABLED:",
      "WORKER_INGESTION_SEARCHES_JSON:",
    ],
    "docker-compose.yml",
  );
  assert(
    /PROVIDER_ALLOW_MOCK_FALLBACK:\s+\$\{PROVIDER_ALLOW_MOCK_FALLBACK:-false\}/.test(compose),
    "Compose must default mock fallback to false.",
  );
  assert(
    /PROVIDER_MOCK_ENABLED:\s+\$\{PROVIDER_MOCK_ENABLED:-false\}/.test(compose),
    "Compose must default the mock provider to false.",
  );
  assert(
    rootPackage.scripts?.["db:migrate"]?.includes("db:migrate:postgres"),
    "Root db:migrate must target PostgreSQL.",
  );
  assert(
    rootPackage.scripts?.["db:migrate:sqlite"]?.includes("@closetsearch/api db:migrate"),
    "SQLite migration must remain available only under an explicit local command.",
  );
  assert(
    rootPackage.scripts?.["smoke:test"] === "node scripts/production-smoke-test.mjs",
    "Root smoke:test must use the fail-closed production smoke.",
  );
  assert(
    rootPackage.scripts?.["deps:check"]?.includes("pnpm audit --audit-level high") &&
      !rootPackage.scripts["deps:check"].includes("--prod"),
    "Dependency checking must fail on high-severity development or production advisories.",
  );

  assertContains(
    files["playwright.config.ts"],
    [
      "PLAYWRIGHT_PERSISTENCE_DRIVER",
      "PLAYWRIGHT_DATABASE_URL",
      "PERSISTENCE_DRIVER: persistenceDriver",
    ],
    "Playwright configuration",
  );

  for (const dockerfile of ["Dockerfile.api", "Dockerfile.worker", "Dockerfile.web"]) {
    assertContains(
      files[dockerfile],
      ["pnpm install --frozen-lockfile", "HEALTHCHECK", "STOPSIGNAL"],
      dockerfile,
    );
  }

  const composeEnvironment = files[".env.compose.example"];
  assertContains(
    composeEnvironment,
    [
      "PROVIDER_RUNTIME_MODE=real",
      "PROVIDER_ALLOW_MOCK_FALLBACK=false",
      "PROVIDER_MOCK_ENABLED=false",
      "PERSISTENCE_DRIVER=postgres",
      "AUTH_SESSION_PEPPER=",
      "POSTGRES_PASSWORD=",
    ],
    ".env.compose.example",
  );

  const workflow = files[".github/workflows/ci.yml"];
  assertContains(
    workflow,
    [
      "pnpm install --frozen-lockfile",
      "pnpm format:check",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm build",
      "pnpm test",
      "pnpm deps:check",
      "pnpm test:e2e",
      "pnpm smoke:test",
      "pnpm db:migrate",
      "test:integration",
      "CLOSETSEARCH_EXPECTED_PROVIDER_IDS",
      "POSTGRES_INTEGRATION_DATABASE_URL",
      "PLAYWRIGHT_PERSISTENCE_DRIVER: postgres",
      "docker compose",
      "postgres-backup.sh",
      "postgres-restore.sh",
      "playwright install --with-deps chromium",
    ],
    "CI workflow",
  );

  for (const script of ["scripts/postgres-backup.sh", "scripts/postgres-restore.sh"]) {
    const result = spawnSync("sh", ["-n", script], {
      encoding: "utf8",
    });
    assert(result.status === 0, `${script} failed shell syntax validation: ${result.stderr}`);
  }

  for (const script of [
    "scripts/smoke-test.mjs",
    "scripts/production-smoke-test.mjs",
    "scripts/validate-infrastructure.mjs",
  ]) {
    const result = spawnSync(process.execPath, ["--check", script], {
      encoding: "utf8",
    });
    assert(result.status === 0, `${script} failed Node syntax validation: ${result.stderr}`);
  }

  process.stdout.write(
    `${JSON.stringify({
      event: "infrastructure_static_validation_passed",
      files: requiredFiles.length,
    })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      event: "infrastructure_static_validation_failed",
      message: error instanceof Error ? error.message : "Unknown validation failure.",
    })}\n`,
  );
  process.exitCode = 1;
});
