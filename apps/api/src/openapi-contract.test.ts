import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;

const httpMethods = ["delete", "get", "patch", "post", "put"] as const;
const implementedOperations = [
  "DELETE /likes",
  "DELETE /me",
  "DELETE /me/likes",
  "DELETE /me/phone",
  "DELETE /me/saved-filters",
  "DELETE /me/saved-searches",
  "DELETE /me/watchlists",
  "DELETE /me/watchlists/{watchlistId}",
  "DELETE /recent-searches",
  "DELETE /saved-searches",
  "GET /analytics/market-insights",
  "GET /analytics/overview",
  "GET /analytics/underpriced",
  "GET /auth/me",
  "GET /brands",
  "GET /brands/{slug}",
  "GET /feed",
  "GET /health",
  "GET /health/live",
  "GET /health/ready",
  "GET /likes",
  "GET /listings/{listingId}",
  "GET /listings/{listingId}/price-history",
  "GET /listings/{listingId}/price-trends",
  "GET /me/alert-matches",
  "GET /me/alerts",
  "GET /me/likes",
  "GET /me/notification-preferences",
  "GET /me/notification-readiness",
  "GET /me/saved-filters",
  "GET /me/saved-searches",
  "GET /me/settings",
  "GET /me/watchlists",
  "GET /me/watchlists/{watchlistId}/alert-settings",
  "GET /metrics",
  "GET /operations/status",
  "GET /notifications/unsubscribe",
  "GET /providers/health",
  "GET /recent-searches",
  "GET /saved-searches",
  "GET /search",
  "PATCH /me/notification-preferences",
  "PATCH /me/settings",
  "PATCH /me/watchlists/{watchlistId}",
  "PATCH /me/watchlists/{watchlistId}/alert-settings",
  "POST /account/export",
  "POST /admin/development-entitlements",
  "POST /auth/login",
  "POST /auth/logout",
  "POST /auth/logout-all",
  "POST /auth/password-reset/complete",
  "POST /auth/password-reset/request",
  "POST /auth/signup",
  "POST /auth/verify-email",
  "POST /events",
  "POST /likes",
  "POST /me/account-export",
  "POST /me/alerts/dismiss",
  "POST /me/alerts/seen",
  "POST /me/email/verification",
  "POST /me/likes",
  "POST /me/phone/verification",
  "POST /me/phone/verify",
  "POST /me/saved-filters",
  "POST /me/saved-searches",
  "POST /me/watchlists",
  "POST /recent-searches",
  "POST /saved-searches",
  "POST /notifications/unsubscribe",
  "POST /users/onboarding",
  "POST /webhooks/email",
  "POST /webhooks/sms",
  "PUT /me/email",
  "PUT /me/phone",
].sort();
const routeSourceFiles = [
  "./app.ts",
  "./routes/analytics-routes.ts",
  "./routes/brand-routes.ts",
  "./routes/engagement-routes.ts",
  "./routes/entitlement-routes.ts",
  "./routes/listing-detail-routes.ts",
  "./routes/notification-routes.ts",
  "./routes/operations-routes.ts",
  "./routes/postgres-account-routes.ts",
  "./routes/postgres-auth-routes.ts",
  "./routes/postgres-saved-routes.ts",
  "./routes/price-trend-routes.ts",
];
const endpointSpecificSuccesses = [
  ["GET /listings/{listingId}", "200", "#/components/responses/ListingDetail"],
  ["GET /listings/{listingId}/price-history", "200", "#/components/responses/ListingPriceTrend"],
  ["GET /listings/{listingId}/price-trends", "200", "#/components/responses/ListingPriceTrend"],
  ["GET /me/notification-preferences", "200", "#/components/responses/NotificationPreferences"],
  ["PATCH /me/notification-preferences", "200", "#/components/responses/NotificationPreferences"],
  ["GET /me/notification-readiness", "200", "#/components/responses/NotificationReadiness"],
  ["PUT /me/phone", "201", "#/components/responses/PhoneIdentityCreated"],
  ["DELETE /me/phone", "200", "#/components/responses/PhoneIdentityRemoved"],
  ["POST /me/phone/verification", "202", "#/components/responses/PhoneVerificationRequested"],
  ["POST /me/phone/verify", "200", "#/components/responses/PhoneVerified"],
  [
    "GET /me/watchlists/{watchlistId}/alert-settings",
    "200",
    "#/components/responses/WatchlistAlertSettings",
  ],
  [
    "PATCH /me/watchlists/{watchlistId}/alert-settings",
    "200",
    "#/components/responses/WatchlistAlertSettings",
  ],
  ["GET /notifications/unsubscribe", "200", "#/components/responses/EmailUnsubscribeConfirmation"],
  ["POST /notifications/unsubscribe", "200", "#/components/responses/EmailUnsubscribed"],
  ["POST /webhooks/email", "202", "#/components/responses/EmailWebhookAccepted"],
  ["POST /webhooks/sms", "200", "#/components/responses/SmsWebhookAcknowledgement"],
] as const;
const genericResponseReferences = new Set([
  "#/components/responses/MutationOk",
  "#/components/responses/ObjectAccepted",
  "#/components/responses/ObjectCreated",
  "#/components/responses/ObjectOk",
  "#/components/responses/SensitiveObjectOk",
]);

async function readContract() {
  const rawContract = await readFile(new URL("../openapi.json", import.meta.url), "utf8");

  return JSON.parse(rawContract) as JsonObject;
}

function asObject(value: unknown, label: string): JsonObject {
  expect(value, `${label} must be an object`).toBeTypeOf("object");
  expect(value, `${label} must not be null`).not.toBeNull();
  expect(Array.isArray(value), `${label} must not be an array`).toBe(false);
  return value as JsonObject;
}

function resolveLocalReference(contract: JsonObject, reference: string) {
  expect(reference.startsWith("#/"), `${reference} must be local`).toBe(true);

  let current: unknown = contract;

  for (const encodedSegment of reference.slice(2).split("/")) {
    const segment = encodedSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    current = asObject(current, reference)[segment];
    expect(current, `${reference} has an unresolved segment: ${segment}`).toBeDefined();
  }

  return current;
}

function resolveObject(contract: JsonObject, value: unknown): JsonObject {
  const object = asObject(value, "OpenAPI object");
  const reference = object.$ref;

  if (typeof reference !== "string") {
    return object;
  }

  return resolveObject(contract, resolveLocalReference(contract, reference));
}

function collectReferences(value: unknown, references: string[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectReferences(item, references);
    }

    return references;
  }

  if (!value || typeof value !== "object") {
    return references;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string") {
      references.push(child);
    } else {
      collectReferences(child, references);
    }
  }

  return references;
}

function listOperations(contract: JsonObject) {
  const paths = asObject(contract.paths, "paths");
  const operations: Array<{
    key: string;
    operation: JsonObject;
  }> = [];

  for (const [path, rawPathItem] of Object.entries(paths)) {
    const pathItem = asObject(rawPathItem, `paths.${path}`);

    for (const method of httpMethods) {
      if (pathItem[method]) {
        operations.push({
          key: `${method.toUpperCase()} ${path}`,
          operation: asObject(pathItem[method], `${method.toUpperCase()} ${path}`),
        });
      }
    }
  }

  return operations;
}

function getOperation(contract: JsonObject, key: string) {
  const separator = key.indexOf(" ");
  const method = key.slice(0, separator).toLowerCase();
  const path = key.slice(separator + 1);
  const pathItem = asObject(asObject(contract.paths, "paths")[path], path);

  return asObject(pathItem[method], key);
}

function getResponse(contract: JsonObject, key: string, status: string) {
  const operation = getOperation(contract, key);
  const responses = asObject(operation.responses, `${key} responses`);

  return {
    raw: asObject(responses[status], `${key} response ${status}`),
    resolved: resolveObject(contract, responses[status]),
  };
}

function getResponseSchema(
  contract: JsonObject,
  key: string,
  status: string,
  mediaType = "application/json",
) {
  const response = getResponse(contract, key, status).resolved;
  const content = asObject(response.content, `${key} response ${status} content`);
  const media = asObject(content[mediaType], `${key} response ${status} ${mediaType}`);

  return resolveObject(contract, media.schema);
}

function collectSchemaPropertyNames(
  contract: JsonObject,
  value: unknown,
  names = new Set<string>(),
  visitedReferences = new Set<string>(),
) {
  if (Array.isArray(value)) {
    for (const child of value) {
      collectSchemaPropertyNames(contract, child, names, visitedReferences);
    }
    return names;
  }

  if (!value || typeof value !== "object") {
    return names;
  }

  const object = value as JsonObject;

  if (typeof object.$ref === "string") {
    if (visitedReferences.has(object.$ref)) {
      return names;
    }
    visitedReferences.add(object.$ref);
    collectSchemaPropertyNames(
      contract,
      resolveLocalReference(contract, object.$ref),
      names,
      visitedReferences,
    );
  }

  if (object.properties && typeof object.properties === "object") {
    for (const [name, child] of Object.entries(asObject(object.properties, "schema properties"))) {
      names.add(name);
      collectSchemaPropertyNames(contract, child, names, visitedReferences);
    }
  }

  for (const keyword of ["allOf", "anyOf", "items", "oneOf"] as const) {
    collectSchemaPropertyNames(contract, object[keyword], names, visitedReferences);
  }

  return names;
}

function responseHasRequestId(contract: JsonObject, rawResponse: unknown) {
  const response = resolveObject(contract, rawResponse);
  const headers = asObject(response.headers, "response headers");
  const requestId = resolveObject(contract, headers["X-Request-ID"]);

  return requestId.description === "Opaque request correlation identifier generated by the API.";
}

async function listSourceRouteLiterals() {
  const routeLiteralPattern = /["'`](\/[a-z][a-z0-9_\-/.]*)["'`]/gi;
  const routeLiterals = new Set<string>();

  for (const sourceFile of routeSourceFiles) {
    const source = await readFile(new URL(sourceFile, import.meta.url), "utf8");

    for (const match of source.matchAll(routeLiteralPattern)) {
      const precedingSource = source.slice(Math.max(0, (match.index ?? 0) - 40), match.index);

      if (/\.endsWith\(\s*$/.test(precedingSource)) {
        continue;
      }

      routeLiterals.add(match[1]);
    }
  }

  return [...routeLiterals].sort();
}

describe("OpenAPI contract", () => {
  it("is valid JSON with resolvable local references", async () => {
    const contract = await readContract();

    expect(contract.openapi).toBe("3.0.3");
    expect(asObject(contract.info, "info").title).toBe("ClosetSearch HTTP API");
    expect(asObject(contract.components, "components").securitySchemes).toBeDefined();

    for (const reference of collectReferences(contract)) {
      expect(resolveLocalReference(contract, reference)).toBeDefined();
    }
  });

  it("enumerates exactly the supported canonical and explicit legacy operations", async () => {
    const contract = await readContract();
    const operations = listOperations(contract);

    expect(operations.map(({ key }) => key).sort()).toEqual(implementedOperations);
    expect(new Set(operations.map(({ operation }) => operation.operationId)).size).toBe(
      operations.length,
    );
    expect(
      operations.every(
        ({ operation }) =>
          typeof operation.operationId === "string" &&
          Array.isArray(operation.tags) &&
          operation.tags.length > 0 &&
          Array.isArray(operation.security) &&
          Object.keys(asObject(operation.responses, "responses")).length > 0,
      ),
    ).toBe(true);
  });

  it("uses endpoint-specific success responses for listing intelligence and notifications", async () => {
    const contract = await readContract();

    for (const [key, status, expectedReference] of endpointSpecificSuccesses) {
      const { raw } = getResponse(contract, key, status);

      expect(raw.$ref, `${key} ${status} must use its typed response`).toBe(expectedReference);
      expect(
        genericResponseReferences.has(String(raw.$ref)),
        `${key} ${status} must not use a generic object response`,
      ).toBe(false);
    }

    expect(
      getResponseSchema(contract, "GET /listings/{listingId}", "200").additionalProperties,
    ).toBe(false);
    expect(
      getResponseSchema(contract, "GET /listings/{listingId}/price-trends", "200")
        .additionalProperties,
    ).toBe(false);
    expect(
      getResponseSchema(contract, "GET /me/notification-readiness", "200").additionalProperties,
    ).toBe(false);
    expect(getResponseSchema(contract, "POST /webhooks/email", "202").additionalProperties).toBe(
      false,
    );
    expect(getResponseSchema(contract, "POST /webhooks/sms", "200", "application/xml").type).toBe(
      "string",
    );
  });

  it("models application-owned request, listing, trend, and notification shapes as closed schemas", async () => {
    const contract = await readContract();
    const schemas = asObject(asObject(contract.components, "components").schemas, "schemas");
    const closedSchemas = [
      "ListingDetailEnvelope",
      "ListingDetailState",
      "NotificationCapabilityReadiness",
      "NotificationDeliveryReadiness",
      "NotificationDestinationReadiness",
      "NotificationPreferencesEnvelope",
      "NotificationPreferencesPatch",
      "NotificationPreferencesState",
      "NotificationReadinessEnvelope",
      "PhoneIdentity",
      "PhoneIdentityEnvelope",
      "PhoneIdentityInput",
      "PhoneIdentityRemovalResult",
      "PhoneVerificationInput",
      "PhoneVerificationResult",
      "PriceTrendResponse",
      "PriceTrendSeriesPoint",
      "PriceTrendSummary",
      "WatchlistAlertChannels",
      "WatchlistAlertSettingsEnvelope",
      "WatchlistAlertSettingsPatch",
      "WatchlistAlertSettingsState",
      "WebhookAccepted",
    ];

    for (const schemaName of closedSchemas) {
      const schema = asObject(schemas[schemaName], schemaName);
      expect(schema.additionalProperties, `${schemaName} must reject undocumented fields`).toBe(
        false,
      );
    }

    const verificationRequest = asObject(
      schemas.PhoneVerificationRequestResult,
      "PhoneVerificationRequestResult",
    );
    for (const variant of verificationRequest.oneOf as unknown[]) {
      expect(asObject(variant, "phone verification variant").additionalProperties).toBe(false);
    }

    const trend = asObject(schemas.PriceTrendResponse, "PriceTrendResponse");
    const trendProperties = asObject(trend.properties, "PriceTrendResponse properties");
    expect(asObject(trendProperties.state, "trend state").$ref).toBe(
      "#/components/schemas/PriceTrendState",
    );
    expect(
      asObject(asObject(trendProperties.series, "trend series").items, "trend item").$ref,
    ).toBe("#/components/schemas/PriceTrendSeriesPoint");
    expect(asObject(trendProperties.summary, "trend summary").$ref).toBe(
      "#/components/schemas/PriceTrendSummary",
    );
    expect(asObject(schemas.PriceTrendState, "PriceTrendState").enum).toEqual([
      "analytics_excluded",
      "insufficient_data",
      "no_data",
      "ready",
    ]);

    const expectedRequestSchemas = [
      ["PATCH /me/notification-preferences", "#/components/schemas/NotificationPreferencesPatch"],
      ["PUT /me/phone", "#/components/schemas/PhoneIdentityInput"],
      ["POST /me/phone/verify", "#/components/schemas/PhoneVerificationInput"],
      [
        "PATCH /me/watchlists/{watchlistId}/alert-settings",
        "#/components/schemas/WatchlistAlertSettingsPatch",
      ],
      ["POST /webhooks/email", "#/components/schemas/EmailWebhookEvent"],
      ["POST /webhooks/sms", "#/components/schemas/SmsWebhookEvent"],
    ] as const;

    for (const [key, expectedReference] of expectedRequestSchemas) {
      const operation = getOperation(contract, key);
      const requestBody = asObject(operation.requestBody, `${key} request body`);
      const content = asObject(requestBody.content, `${key} request content`);
      const mediaType =
        key === "POST /webhooks/sms" ? "application/x-www-form-urlencoded" : "application/json";
      const media = asObject(content[mediaType], `${key} ${mediaType}`);
      const schema = asObject(media.schema, `${key} request schema`);

      expect(schema.$ref).toBe(expectedReference);
    }

    for (const key of ["GET /notifications/unsubscribe", "POST /notifications/unsubscribe"]) {
      const operation = getOperation(contract, key);
      const token = (operation.parameters as JsonObject[]).find(
        (parameter) => parameter.name === "token",
      );

      expect(asObject(asObject(token, `${key} token`).schema, `${key} token schema`)).toMatchObject(
        {
          $ref: "#/components/schemas/EmailUnsubscribeToken",
        },
      );
    }

    const emailWebhook = getOperation(contract, "POST /webhooks/email");
    expect((emailWebhook.parameters as JsonObject[]).map((parameter) => parameter.$ref)).toEqual([
      "#/components/parameters/ResendWebhookId",
      "#/components/parameters/ResendWebhookTimestamp",
      "#/components/parameters/ResendWebhookSignature",
    ]);

    const smsWebhook = getOperation(contract, "POST /webhooks/sms");
    const smsParameters = smsWebhook.parameters as JsonObject[];
    expect(smsParameters[0]).toMatchObject({
      $ref: "#/components/parameters/TwilioWebhookSignature",
    });
    expect(smsParameters[1]).toMatchObject({
      in: "query",
      name: "deliveryId",
      required: false,
      schema: {
        format: "uuid",
        type: "string",
      },
    });

    const emailWebhookSchema = asObject(schemas.EmailWebhookEvent, "EmailWebhookEvent");
    const smsWebhookSchema = asObject(schemas.SmsWebhookEvent, "SmsWebhookEvent");
    expect(emailWebhookSchema.required).toEqual(["type"]);
    expect(asObject(emailWebhookSchema.properties, "email webhook properties")).toHaveProperty(
      "data",
    );
    expect(asObject(smsWebhookSchema.properties, "SMS webhook properties")).toEqual(
      expect.objectContaining({
        MessageSid: expect.any(Object),
        SmsSid: expect.any(Object),
      }),
    );
  });

  it("keeps secrets, verification material, provider internals, and unsubscribe tokens out of success responses", async () => {
    const contract = await readContract();
    const forbiddenResponseProperties = [
      "authToken",
      "code",
      "codeHash",
      "destinationHash",
      "idempotencyKey",
      "marketplace_limitations",
      "payloadDigest",
      "providerDeliveryStatus",
      "providerEventId",
      "providerMessageId",
      "providerResponse",
      "providerStatusRank",
      "rawBody",
      "secret",
      "sellerMetadata",
      "shippingMetadata",
      "token",
      "tokenHash",
    ];

    for (const [key, status] of endpointSpecificSuccesses) {
      if (key === "POST /webhooks/sms") {
        continue;
      }

      const propertyNames = collectSchemaPropertyNames(
        contract,
        getResponseSchema(contract, key, status),
      );

      for (const forbidden of forbiddenResponseProperties) {
        expect(
          propertyNames.has(forbidden),
          `${key} ${status} must not document sensitive/internal field ${forbidden}`,
        ).toBe(false);
      }
    }

    const unsubscribeConfirmationProperties = collectSchemaPropertyNames(
      contract,
      getResponseSchema(contract, "GET /notifications/unsubscribe", "200"),
    );
    const unsubscribedProperties = collectSchemaPropertyNames(
      contract,
      getResponseSchema(contract, "POST /notifications/unsubscribe", "200"),
    );
    const webhookProperties = collectSchemaPropertyNames(
      contract,
      getResponseSchema(contract, "POST /webhooks/email", "202"),
    );

    expect([...unsubscribeConfirmationProperties].sort()).toEqual(["message", "status"]);
    expect([...unsubscribedProperties].sort()).toEqual(["status"]);
    expect([...webhookProperties].sort()).toEqual(["accepted", "duplicate"]);
  });

  it("keeps source route literals represented without documenting planned routes", async () => {
    const contract = await readContract();
    const documentedPaths = Object.keys(asObject(contract.paths, "paths"));
    const documentedBases = new Set(
      documentedPaths.map((path) => path.replace(/\/\{[^}]+\}$/, "")),
    );

    for (const sourceRoute of await listSourceRouteLiterals()) {
      expect(
        documentedBases.has(sourceRoute.replace(/\/$/, "")),
        `source route ${sourceRoute} is missing from the contract`,
      ).toBe(true);
    }

    const description = String(asObject(contract.info, "info").description);
    expect(description).toContain(
      "Billing webhooks and direct delivery-attempt APIs are intentionally absent",
    );
    expect(documentedPaths).not.toContain("/billing/webhooks");
    expect(documentedPaths).not.toContain("/me/alert-deliveries");
    expect(documentedPaths).not.toContain("/me/account");
  });

  it("documents request IDs, cookie auth, stable errors, and privacy identity boundaries", async () => {
    const contract = await readContract();
    const components = asObject(contract.components, "components");
    const securitySchemes = asObject(components.securitySchemes, "securitySchemes");
    const cookieAuth = asObject(securitySchemes.cookieAuth, "cookieAuth");
    const operationsBearer = asObject(securitySchemes.operationsBearer, "operationsBearer");
    const errorSchema = asObject(asObject(components.schemas, "schemas").Error, "Error");

    expect(cookieAuth).toMatchObject({
      in: "cookie",
      name: "closetsearch_session",
      type: "apiKey",
    });
    expect(operationsBearer).toMatchObject({
      scheme: "bearer",
      type: "http",
    });
    expect(errorSchema.required).toEqual(["error", "message"]);

    for (const path of ["/metrics", "/operations/status", "/providers/health"]) {
      const operation = asObject(
        asObject(asObject(contract.paths, "paths")[path], path).get,
        `GET ${path}`,
      );
      expect(operation.security).toEqual([{ operationsBearer: [] }]);
    }

    for (const { key, operation } of listOperations(contract)) {
      for (const [status, response] of Object.entries(
        asObject(operation.responses, `${key} responses`),
      )) {
        expect(
          responseHasRequestId(contract, response),
          `${key} response ${status} must document X-Request-ID`,
        ).toBe(true);
      }
    }

    const paths = asObject(contract.paths, "paths");
    const eventOperation = asObject(asObject(paths["/events"], "/events").post, "POST /events");
    const eventParameters = eventOperation.parameters as JsonObject[];
    expect(eventParameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: "header",
          name: "X-Privacy-Session-ID",
          required: true,
        }),
      ]),
    );
    expect(JSON.stringify(asObject(components.schemas, "schemas").EngagementEvent)).not.toContain(
      "userId",
    );
    expect(
      JSON.stringify(asObject(components.schemas, "schemas").DevelopmentEntitlementGrant),
    ).not.toContain('"userId"');
    expect(JSON.stringify(asObject(components.schemas, "schemas").AccountDelete)).not.toContain(
      '"userId"',
    );
  });
});
