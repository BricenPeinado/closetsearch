export interface PublicListingIdentity {
  providerId: string;
  publicId: string;
  sourceListingId: string;
}

export function parsePublicListingId(value: string): PublicListingIdentity | undefined {
  if (
    value !== value.trim() ||
    value.length === 0 ||
    value.length > 337 ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    return undefined;
  }

  const separatorIndex = value.indexOf(":");
  const providerId = value.slice(0, separatorIndex);
  const sourceListingId = value.slice(separatorIndex + 1);

  if (
    separatorIndex <= 0 ||
    providerId.length > 80 ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(providerId) ||
    sourceListingId.length === 0 ||
    sourceListingId.length > 256 ||
    sourceListingId !== sourceListingId.trim()
  ) {
    return undefined;
  }

  return {
    providerId,
    publicId: value,
    sourceListingId,
  };
}

export function formatPublicListingId(providerId: string, sourceListingId: string) {
  return `${providerId}:${sourceListingId}`;
}
