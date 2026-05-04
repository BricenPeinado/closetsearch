import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@closetsearch/providers": fileURLToPath(
        new URL("../../packages/providers/src/index.ts", import.meta.url),
      ),
      "@closetsearch/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
  },
});
