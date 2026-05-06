import type { PremiumAccess, User } from "@closetsearch/shared";

const mockPremiumUsernames = new Set(["premiumdemo", "analyticsdemo"]);
const mockPremiumPlanName = "Collector Preview";
const mockPremiumExpiration = "2026-12-31T23:59:59.000Z";

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function getPremiumPreviewUsername() {
  return "premiumdemo";
}

export function getPremiumAccess(user?: User): PremiumAccess | undefined {
  if (!user) {
    return undefined;
  }

  const isPremium = mockPremiumUsernames.has(normalizeUsername(user.username));

  return {
    userId: user.id,
    isPremium,
    planName: isPremium ? mockPremiumPlanName : "Free",
    expiresAt: isPremium ? mockPremiumExpiration : undefined,
  };
}

export function hasPremiumAccess(user?: User) {
  return getPremiumAccess(user)?.isPremium === true;
}
