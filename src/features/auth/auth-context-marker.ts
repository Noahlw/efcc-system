"use client";

export const authContextCookieName = "efcc-auth-context";
const authContextCookiePrefix = `${authContextCookieName}=`;

export const readAuthContextMarker = (): string | null => {
  try {
    // eslint-disable-next-line no-document-cookie -- This opaque marker is readable by design; it carries no authority or credential.
    const cookie = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(authContextCookiePrefix));
    return cookie?.slice(authContextCookiePrefix.length) || null;
  } catch {
    return null;
  }
};

export const rotateAuthContextMarker = (): string => {
  const marker = crypto.randomUUID();
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  try {
    // eslint-disable-next-line no-document-cookie -- Rotate an opaque, non-authority marker when the confirmed auth context changes.
    document.cookie = `${authContextCookiePrefix}${marker}; Path=/; Max-Age=7776000; SameSite=Lax${secure}`;
  } catch {
    throw new Error("The auth context marker could not be stored.");
  }
  if (readAuthContextMarker() !== marker) {
    throw new Error("The auth context marker could not be read back.");
  }
  return marker;
};

export const prepareAuthContextMarker = (): string =>
  readAuthContextMarker() ?? rotateAuthContextMarker();
