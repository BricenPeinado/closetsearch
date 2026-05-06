import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppLayout } from "./app";

describe("AppLayout", () => {
  it.each([
    { path: "/", title: "Homepage Feed" },
    { path: "/search", title: "Search" },
    { path: "/recent-searches", title: "Recent Searches" },
    { path: "/analytics", title: "Analytics" },
    { path: "/profile", title: "Profile" },
    { path: "/signup", title: "Sign Up" },
    { path: "/login", title: "Log In" },
    { path: "/onboarding", title: "Onboarding" },
    { path: "/brands", title: "Brand Directory" },
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
