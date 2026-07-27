import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

async function writeExecutable(path, source) {
  await writeFile(path, source, { mode: 0o700 });
  await chmod(path, 0o700);
}

async function verifyRestoreTargetGuard() {
  const harnessDirectory = await mkdtemp(join(tmpdir(), "closetsearch-restore-guard-"));
  const binaryDirectory = join(harnessDirectory, "bin");
  const backupPath = join(harnessDirectory, "fixture.dump");
  const restoreMarker = join(harnessDirectory, "pg-restore-calls.log");
  const targetDatabase = "closetsearch_restore_guard";

  try {
    await mkdir(binaryDirectory);
    await writeFile(backupPath, "not-a-real-dump");
    await writeFile(`${backupPath}.sha256`, "fixture checksum");
    await writeExecutable(
      join(binaryDirectory, "psql"),
      `#!/bin/sh
case "$*" in
  *current_database*) printf '%s\\n' "\${FAKE_CURRENT_DATABASE}" ;;
  *) printf '6\\n' ;;
esac
`,
    );
    await writeExecutable(join(binaryDirectory, "sha256sum"), "#!/bin/sh\nexit 0\n");
    await writeExecutable(
      join(binaryDirectory, "pg_restore"),
      `#!/bin/sh
printf '%s\\n' "$*" >> "\${RESTORE_MARKER}"
exit 0
`,
    );

    const baseEnvironment = {
      ...process.env,
      PATH: `${binaryDirectory}:${process.env.PATH ?? ""}`,
      RESTORE_CONFIRMATION: `restore:${targetDatabase}`,
      RESTORE_DATABASE_URL: "postgresql://restore-user:secret@example.invalid/ambiguous",
      RESTORE_MARKER: restoreMarker,
      RESTORE_TARGET_DATABASE: targetDatabase,
    };
    const mismatch = spawnSync("sh", ["scripts/postgres-restore.sh", backupPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...baseEnvironment,
        FAKE_CURRENT_DATABASE: "unexpected_database",
      },
    });

    assert(
      mismatch.status !== 0 &&
        mismatch.stderr.includes("RESTORE_DATABASE_URL resolves to unexpected_database"),
      "Restore must reject a URL that resolves to a different database.",
    );
    await readFile(restoreMarker).then(
      () => {
        throw new Error("Restore invoked pg_restore before validating the actual database.");
      },
      () => undefined,
    );

    const matching = spawnSync("sh", ["scripts/postgres-restore.sh", backupPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...baseEnvironment,
        FAKE_CURRENT_DATABASE: targetDatabase,
      },
    });

    assert(
      matching.status === 0,
      `Restore target harness failed for a matching database: ${matching.stderr}`,
    );
    assert(
      matching.stdout.includes(`"database":"${targetDatabase}"`),
      "Restore completion did not identify the verified target database.",
    );
    const restoreCalls = (await readFile(restoreMarker, "utf8")).trim().split("\n");
    assert(
      restoreCalls.length === 2,
      "Restore target harness did not exercise archive validation and restore.",
    );
  } finally {
    await rm(harnessDirectory, { force: true, recursive: true });
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
      "CLOSETSEARCH_API_IMAGE:",
      "CLOSETSEARCH_WORKER_IMAGE:",
      "CLOSETSEARCH_WEB_IMAGE:",
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
      "CLOSETSEARCH_API_IMAGE=",
      "CLOSETSEARCH_WORKER_IMAGE=",
      "CLOSETSEARCH_WEB_IMAGE=",
      "POSTGRES_PASSWORD=",
    ],
    ".env.compose.example",
  );

  const workflow = files[".github/workflows/ci.yml"];
  assertContains(
    workflow,
    [
      "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
      "actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f",
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
      "anchore/scan-action/download-grype@e1165082ffb1fe366ebaf02d8526e7c4989ea9d2",
      "pnpm install --frozen-lockfile",
      "pnpm format:check",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm build",
      "pnpm test:sites",
      "pnpm test",
      "pnpm deps:check",
      "pnpm test:e2e",
      "pnpm smoke:test",
      "pnpm db:migrate",
      "test:integration",
      "CLOSETSEARCH_EXPECTED_PROVIDER_IDS",
      "LIVE_PROVIDER_SMOKE_TESTS",
      "Authorization: Bearer",
      "POSTGRES_INTEGRATION_DATABASE_URL",
      "PLAYWRIGHT_PERSISTENCE_DRIVER: postgres",
      "docker compose",
      "postgres-backup.sh",
      "postgres-restore.sh",
      "playwright install --with-deps chromium",
      "config --images",
      "--fail-on high",
    ],
    "CI workflow",
  );
  const externalActionReferences = [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map(
    (match) => match[1],
  );
  assert(
    externalActionReferences.length > 0 &&
      externalActionReferences.every((reference) => /@[a-f0-9]{40}$/.test(reference)),
    "Every external GitHub Action must be pinned to an immutable full-length commit SHA.",
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

  await verifyRestoreTargetGuard();

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
