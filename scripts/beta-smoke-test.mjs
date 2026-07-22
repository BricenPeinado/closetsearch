import { main } from "./smoke-test.mjs";

main().catch((error) => {
  console.error(
    `FAIL beta smoke test: ${error instanceof Error ? error.message : "Unknown error"}`,
  );
  process.exitCode = 1;
});
