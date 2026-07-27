import { access, cp, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sitesOutput = path.join(repositoryRoot, "dist");
const webOutput = path.join(repositoryRoot, "apps", "web", "dist");
const workerSource = path.join(repositoryRoot, "sites", "worker.mjs");
const hostingSource = path.join(repositoryRoot, ".openai", "hosting.json");
const apiBaseUrl = process.env.VITE_API_BASE_URL?.trim() || "/api";

function run(command, arguments_, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: repositoryRoot,
      env: environment,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `${command} terminated with signal ${signal}`
            : `${command} exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

await run("corepack", ["pnpm", "--filter", "@closetsearch/web", "build"], {
  ...process.env,
  VITE_API_BASE_URL: apiBaseUrl,
});

await rm(sitesOutput, { force: true, recursive: true });
await mkdir(path.join(sitesOutput, "server"), { recursive: true });
await cp(webOutput, path.join(sitesOutput, "client"), { recursive: true });
await cp(workerSource, path.join(sitesOutput, "server", "index.js"));

if (await exists(hostingSource)) {
  const hostingOutput = path.join(sitesOutput, ".openai", "hosting.json");
  await mkdir(path.dirname(hostingOutput), { recursive: true });
  await cp(hostingSource, hostingOutput);
}

console.log(
  `Sites artifact created at ${path.relative(repositoryRoot, sitesOutput)} with API base ${apiBaseUrl}.`,
);
