import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppLayout } from "./app";

describe("AppLayout", () => {
  it.each([
    { path: "/", title: "Find your next piece" },
    { path: "/search", title: "Search" },
    { path: "/recent-searches", title: "Recent Searches" },
    { path: "/analytics", title: "Premium Analytics" },
    { path: "/profile", title: "Profile" },
    { path: "/signup", title: "Create Your Account" },
    { path: "/login", title: "Log In" },
    { path: "/onboarding", title: "Tell us what you like" },
    { path: "/brands", title: "Brands" },
    { path: "/brands/kapital", title: "Brand Profile" },
  ])("renders $path", ({ path, title }) => {
    const html = renderToString(
      <MemoryRouter initialEntries={[path]}>
        <AppLayout />
      </MemoryRouter>,
    );

    expect(html).toContain(title);
    expect(html).toContain("Home");
    expect(html).toContain("Search");
    expect(html).toContain("Profile");
  });
});
