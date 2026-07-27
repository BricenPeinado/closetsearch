import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientRoot = path.join(repositoryRoot, "dist", "client");
const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

const environment = {
  ASSETS: {
    async fetch(request) {
      const url = new URL(request.url);
      const relativePath =
        url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const filePath = path.resolve(clientRoot, relativePath);

      if (filePath !== clientRoot && !filePath.startsWith(`${clientRoot}${path.sep}`)) {
        return new Response("Not found", { status: 404 });
      }

      try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) {
          return new Response("Not found", { status: 404 });
        }

        return new Response(await readFile(filePath), {
          headers: {
            "content-type": contentTypes.get(path.extname(filePath)) ?? "application/octet-stream",
          },
          status: 200,
        });
      } catch (error) {
        if (error?.code === "ENOENT") {
          return new Response("Not found", { status: 404 });
        }
        throw error;
      }
    },
  },
};

test("serves the Vite application and restores browser routes", async () => {
  const rootResponse = await worker.fetch(
    new Request("https://closetsearch.example/", {
      headers: { accept: "text/html" },
    }),
    environment,
  );
  assert.equal(rootResponse.status, 200);
  assert.match(rootResponse.headers.get("content-type") ?? "", /^text\/html/i);
  assert.match(await rootResponse.text(), /<div id="root"><\/div>/);

  const nestedResponse = await worker.fetch(
    new Request("https://closetsearch.example/brands/acne-studios", {
      headers: { accept: "text/html" },
    }),
    environment,
  );
  assert.equal(nestedResponse.status, 200);
  assert.match(await nestedResponse.text(), /<div id="root"><\/div>/);
});

test("embeds the same-origin API route instead of a local development origin", async () => {
  const assetDirectory = path.join(clientRoot, "assets");
  const javascriptAssets = (await readdir(assetDirectory)).filter((file) => file.endsWith(".js"));
  assert.ok(javascriptAssets.length > 0);

  const compiledJavascript = (
    await Promise.all(
      javascriptAssets.map((file) => readFile(path.join(assetDirectory, file), "utf8")),
    )
  ).join("\n");

  assert.match(compiledJavascript, /\/api/);
  assert.doesNotMatch(compiledJavascript, /localhost:4000/);
});

test("fails closed when no API origin is configured", async () => {
  const response = await worker.fetch(
    new Request("https://closetsearch.example/api/feed"),
    environment,
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, "feed_unavailable");
  assert.match(body.message, /Mock inventory is disabled/);
});

test("proxies same-origin API requests to the configured backend", async (context) => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const response = await worker.fetch(
    new Request("https://closetsearch.example/api/search?q=coat"),
    {
      ...environment,
      CLOSETSEARCH_API_ORIGIN: `http://127.0.0.1:${address.port}`,
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(requests, ["/search?q=coat"]);
});
