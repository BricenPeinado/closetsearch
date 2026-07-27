const securityHeaders = {
  "content-security-policy":
    "default-src 'self'; connect-src 'self' https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function jsonResponse(body, status, additionalHeaders = {}) {
  return new Response(JSON.stringify(body), {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...securityHeaders,
      ...additionalHeaders,
    },
    status,
  });
}

function unavailableError(pathname) {
  if (pathname === "/api/feed" || pathname.startsWith("/api/feed/")) {
    return "feed_unavailable";
  }

  if (pathname === "/api/search" || pathname.startsWith("/api/search/")) {
    return "search_unavailable";
  }

  return "service_unavailable";
}

function apiOriginFrom(environment) {
  const configuredOrigin = environment.CLOSETSEARCH_API_ORIGIN?.trim();
  if (!configuredOrigin) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(configuredOrigin);
  } catch {
    return null;
  }

  const isLoopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) {
    return null;
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

async function proxyApiRequest(request, environment) {
  const requestUrl = new URL(request.url);
  const apiOrigin = apiOriginFrom(environment);

  if (!apiOrigin) {
    return jsonResponse(
      {
        error: unavailableError(requestUrl.pathname),
        message:
          "The ClosetSearch API is not configured for this deployment. Mock inventory is disabled.",
      },
      503,
    );
  }

  const upstreamPath = requestUrl.pathname.slice("/api".length) || "/";
  const apiBasePath = apiOrigin.pathname === "/" ? "" : apiOrigin.pathname.replace(/\/+$/, "");
  const upstreamUrl = new URL(apiOrigin.origin);
  upstreamUrl.pathname = `${apiBasePath}${upstreamPath}`;
  upstreamUrl.search = requestUrl.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("x-forwarded-host", requestUrl.host);
  headers.set("x-forwarded-proto", requestUrl.protocol.slice(0, -1));

  try {
    const upstreamResponse = await fetch(
      new Request(upstreamUrl, {
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        headers,
        method: request.method,
        redirect: "manual",
      }),
    );
    const responseHeaders = new Headers(upstreamResponse.headers);
    for (const [name, value] of Object.entries(securityHeaders)) {
      responseHeaders.set(name, value);
    }
    responseHeaders.set("cache-control", "no-store");

    return new Response(upstreamResponse.body, {
      headers: responseHeaders,
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
    });
  } catch {
    return jsonResponse(
      {
        error: unavailableError(requestUrl.pathname),
        message: "The ClosetSearch API could not be reached.",
      },
      502,
    );
  }
}

function secureAssetResponse(response, pathname) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders)) {
    headers.set(name, value);
  }

  if (pathname.startsWith("/assets/") && response.ok) {
    headers.set("cache-control", "public, max-age=31536000, immutable");
  } else if (headers.get("content-type")?.toLowerCase().includes("text/html")) {
    headers.set("cache-control", "no-cache");
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

async function serveAsset(request, environment) {
  if (!environment.ASSETS?.fetch) {
    return jsonResponse(
      {
        error: "site_assets_unavailable",
        message: "The ClosetSearch web artifact is unavailable.",
      },
      503,
    );
  }

  const requestUrl = new URL(request.url);
  let response = await environment.ASSETS.fetch(request);
  const expectsHtml =
    (request.method === "GET" || request.method === "HEAD") &&
    request.headers.get("accept")?.includes("text/html");

  if (response.status === 404 && expectsHtml) {
    const indexUrl = new URL("/index.html", requestUrl);
    response = await environment.ASSETS.fetch(
      new Request(indexUrl, {
        headers: request.headers,
        method: request.method,
      }),
    );
  }

  return secureAssetResponse(response, requestUrl.pathname);
}

const worker = {
  async fetch(request, environment) {
    const requestUrl = new URL(request.url);

    if (requestUrl.pathname === "/health/live") {
      return jsonResponse(
        {
          service: "closetsearch-sites-web",
          status: "ok",
        },
        200,
      );
    }

    if (requestUrl.pathname === "/api" || requestUrl.pathname.startsWith("/api/")) {
      return proxyApiRequest(request, environment);
    }

    return serveAsset(request, environment);
  },
};

export default worker;
