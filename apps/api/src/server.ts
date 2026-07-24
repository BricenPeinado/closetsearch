import { createApp } from "./app.js";
import { closePersistenceRuntime, getPersistenceRuntime } from "./db/persistence-runtime.js";
import { logError, logInfo } from "./logger.js";
import { validateStartupEnvironment } from "./startup-config.js";

const startupConfig = validateStartupEnvironment();
await getPersistenceRuntime();

const server = createApp();

server.listen(startupConfig.port, startupConfig.host, () => {
  logInfo("ClosetSearch API listening", {
    host: startupConfig.host,
    port: startupConfig.port,
    url: `http://${startupConfig.host}:${startupConfig.port}`,
  });
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logInfo("Graceful shutdown started", { signal });

  const forceTimer = setTimeout(() => {
    logError("Graceful shutdown timed out", {
      signal,
      timeoutMs: startupConfig.shutdownTimeoutMs,
    });
    server.closeAllConnections();
    void closePersistenceRuntime();
    process.exitCode = 1;
  }, startupConfig.shutdownTimeoutMs);
  forceTimer.unref();

  server.close(async (error) => {
    clearTimeout(forceTimer);

    if (error) {
      logError("Graceful shutdown failed", {
        errorName: error.name,
        signal,
      });
      process.exitCode = 1;
      return;
    }

    await closePersistenceRuntime();
    logInfo("Graceful shutdown completed", { signal });
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
