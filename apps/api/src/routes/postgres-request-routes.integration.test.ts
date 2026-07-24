import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import type { Listing } from "@closetsearch/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareRequestAuthContext } from "../auth/postgres-session-service.js";
import type { PostgresDataPlane } from "../db/postgres/data-plane.js";
import { createPostgresTestHarness } from "../db/postgres/test-harness.js";
import { handlePostgresAuthRoute } from "./postgres-auth-routes.js";
import { handlePostgresSavedRoute } from "./postgres-saved-routes.js";

const runtime = vi.hoisted(() => ({
  dataPlane: undefined as PostgresDataPlane | undefined,
}));

vi.mock("../db/persistence-runtime.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../db/persistence-runtime.js")>();

  return {
    ...original,
    getPostgresDataPlane: async () => {
      if (!runtime.dataPlane) {
        throw new Error("Test PostgreSQL data plane is not initialized.");
      }

      return runtime.dataPlane;
    },
  };
});

function request(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const json = body === undefined ? "" : JSON.stringify(body);
  const stream = Readable.from(json ? [json] : []) as IncomingMessage;
  stream.headers = {
    ...headers,
    ...(body === undefined ? {} : { "content-type": "application/json" }),
  };
  stream.method = method;
  stream.url = url;
  return stream;
}

const listing: Listing = {
  analyticsEligibility: { eligible: true },
  brand: {
    id: "brand:acme",
    name: "Acme",
    slug: "acme",
  },
  fetchedAt: "2026-07-24T12:00:00.000Z",
  id: "ebay:listing-123",
  imageUrl: "https://images.example.com/listing-123.jpg",
  listingType: "buy_now",
  price: {
    amount: 125,
    amountMinor: 12_500,
    currency: "USD",
    fractionDigits: 2,
  },
  providerId: "ebay",
  providerListingId: "listing-123",
  source: {
    dataOrigin: "official_api",
    id: "ebay",
    name: "eBay",
  },
  sourceUrl: "https://www.ebay.com/itm/listing-123",
  title: "Acme jacket",
};

describe("PostgreSQL HTTP request cutover", () => {
  let harness: Awaited<ReturnType<typeof createPostgresTestHarness>>;
  let originalDriver: string | undefined;
  let originalPepper: string | undefined;

  beforeEach(async () => {
    originalDriver = process.env.PERSISTENCE_DRIVER;
    originalPepper = process.env.AUTH_SESSION_PEPPER;
    process.env.PERSISTENCE_DRIVER = "postgres";
    process.env.AUTH_SESSION_PEPPER =
      "postgres-route-test-session-pepper-value";
    harness = await createPostgresTestHarness();
    runtime.dataPlane = harness.dataPlane;
  });

  afterEach(async () => {
    runtime.dataPlane = undefined;
    await harness.database.close();

    if (originalDriver === undefined) {
      delete process.env.PERSISTENCE_DRIVER;
    } else {
      process.env.PERSISTENCE_DRIVER = originalDriver;
    }

    if (originalPepper === undefined) {
      delete process.env.AUTH_SESSION_PEPPER;
    } else {
      process.env.AUTH_SESSION_PEPPER = originalPepper;
    }
  });

  async function signup() {
    const signupRequest = request("POST", "/auth/signup", {
      password: "violet sparrow orbit lantern",
      username: "routefan",
    });
    const result = await handlePostgresAuthRoute(
      signupRequest,
      new URL("http://localhost/auth/signup"),
    );

    expect(result).toMatchObject({
      body: {
        user: {
          username: "routefan",
        },
      },
      statusCode: 201,
    });

    const cookie = result?.headers?.["set-cookie"];

    if (!cookie) {
      throw new Error("Expected a session cookie.");
    }

    return {
      cookie,
      user: (result?.body as { user: { id: string; username: string } }).user,
    };
  }

  it("persists signup and resolves the resulting cookie from PostgreSQL", async () => {
    const { cookie, user } = await signup();
    const meRequest = request("GET", "/auth/me", undefined, {
      cookie,
    });

    await prepareRequestAuthContext(meRequest);
    const result = await handlePostgresAuthRoute(
      meRequest,
      new URL("http://localhost/auth/me"),
    );

    expect(result).toMatchObject({
      body: {
        userId: user.id,
      },
      statusCode: 200,
    });
    await expect(
      harness.dataPlane.requestStore.findUserById(user.id),
    ).resolves.toMatchObject({
      username: "routefan",
    });
  });

  it("persists saved searches and rejects body-supplied actor identities", async () => {
    const { cookie, user } = await signup();
    const createRequest = request(
      "POST",
      "/me/saved-searches",
      {
        description: "Acme jackets",
        label: "Acme",
        params: "q=acme",
      },
      { cookie },
    );
    await prepareRequestAuthContext(createRequest);

    const created = await handlePostgresSavedRoute(
      createRequest,
      new URL("http://localhost/me/saved-searches"),
    );
    expect(created).toMatchObject({
      body: {
        savedSearches: [
          {
            params: "q=acme",
            userId: user.id,
          },
        ],
      },
      statusCode: 201,
    });

    const spoofedRequest = request(
      "POST",
      "/me/saved-searches",
      {
        description: "Spoofed",
        label: "Spoofed",
        params: "q=spoofed",
        userId: "00000000-0000-4000-8000-000000000000",
      },
      { cookie },
    );
    await prepareRequestAuthContext(spoofedRequest);

    await expect(
      handlePostgresSavedRoute(
        spoofedRequest,
        new URL("http://localhost/me/saved-searches"),
      ),
    ).rejects.toMatchObject({
      code: "spoofed_user_id",
      statusCode: 400,
    });
  });

  it("upserts a normalized listing before a like and reconstructs it after the request", async () => {
    const { cookie } = await signup();
    const likeRequest = request(
      "POST",
      "/me/likes",
      {
        listing,
        listingId: listing.id,
        source: listing.source.id,
      },
      { cookie },
    );
    await prepareRequestAuthContext(likeRequest);

    const created = await handlePostgresSavedRoute(
      likeRequest,
      new URL("http://localhost/me/likes"),
    );
    expect(created).toMatchObject({
      body: {
        likedListing: {
          like: {
            listingId: listing.id,
          },
        },
      },
      statusCode: 201,
    });

    const getRequest = request("GET", "/me/likes", undefined, {
      cookie,
    });
    await prepareRequestAuthContext(getRequest);
    const result = await handlePostgresSavedRoute(
      getRequest,
      new URL("http://localhost/me/likes"),
    );

    expect(result).toMatchObject({
      body: {
        likedListings: [
          {
            listing: {
              id: listing.id,
              price: {
                amountMinor: 12_500,
                currency: "USD",
              },
            },
          },
        ],
        likes: [
          {
            listingId: listing.id,
          },
        ],
      },
      statusCode: 200,
    });
  });
});
