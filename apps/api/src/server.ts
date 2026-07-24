import { closeDatabaseConnection, getDatabase } from "./db/database.js";
import { createApp } from "./app.js";
import { logError, logInfo } from "./logger.js";
import { validateStartupEnvironment } from "./startup-config.js";

const startupConfig = validateStartupEnvironment();
getDatabase();

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
    closeDatabaseConnection();
    process.exitCode = 1;
  }, startupConfig.shutdownTimeoutMs);
  forceTimer.unref();

  server.close((error) => {
    clearTimeout(forceTimer);
    closeDatabaseConnection();

    if (error) {
      logError("Graceful shutdown failed", {
        errorName: error.name,
        message: error.message,
        signal,
      });
      process.exitCode = 1;
      return;
    }

    logInfo("Graceful shutdown completed", { signal });
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
