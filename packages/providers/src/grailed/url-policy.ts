const grailedOrigin = "https://www.grailed.com";
const grailedAlgoliaAppIdPattern = /^[A-Z0-9]{8,32}$/i;

function parseUrl(value: string, label: string) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} must be a valid absolute URL.`);
  }
}

export function normalizeGrailedBaseUrl(value: string) {
  const url = parseUrl(value, "Grailed base URL");

  if (
    url.origin !== grailedOrigin ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Grailed authorized-live access is restricted to the canonical HTTPS marketplace origin.",
    );
  }

  return grailedOrigin;
}

export function isAllowedGrailedDocumentUrl(value: string, baseUrl: string) {
  try {
    const allowedOrigin = normalizeGrailedBaseUrl(baseUrl);
    const url = new URL(value, allowedOrigin);

    return (
      url.protocol === "https:" && url.origin === allowedOrigin && !url.username && !url.password
    );
  } catch {
    return false;
  }
}

export function normalizeGrailedAlgoliaAppId(value: string) {
  const normalizedValue = value.trim();

  if (!grailedAlgoliaAppIdPattern.test(normalizedValue)) {
    throw new Error("Grailed returned an invalid Algolia application identifier.");
  }

  return normalizedValue;
}
