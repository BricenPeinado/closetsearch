import { getDatabase } from "./db/database.js";
import { createApp } from "./app.js";

getDatabase();

const defaultPort = 4000;
const parsedPort = Number.parseInt(process.env.PORT ?? `${defaultPort}`, 10);
const port = Number.isNaN(parsedPort) ? defaultPort : parsedPort;
const host = process.env.HOST ?? "127.0.0.1";

const server = createApp();

server.listen(port, host, () => {
  console.log(`ClosetSearch API listening at http://${host}:${port}`);
});
