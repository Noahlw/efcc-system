import { describe, expect, it } from "vitest";

import { isAllowedPublicAuthRequest } from "@/server/auth/allowlist";

const BASE = "/api/auth";

describe("public auth allowlist", () => {
  it("allows only the implemented method/path pairs", () => {
    expect(
      isAllowedPublicAuthRequest({
        method: "POST",
        pathname: `${BASE}/sign-in/username`,
      })
    ).toBe(true);
    expect(
      isAllowedPublicAuthRequest({
        method: "POST",
        pathname: `${BASE}/sign-in/name`,
      })
    ).toBe(true);
    expect(
      isAllowedPublicAuthRequest({
        method: "GET",
        pathname: `${BASE}/get-session`,
      })
    ).toBe(true);
    expect(
      isAllowedPublicAuthRequest({
        method: "POST",
        pathname: `${BASE}/sign-out`,
      })
    ).toBe(true);
  });

  it("refuses other methods on allowed paths", () => {
    expect(
      isAllowedPublicAuthRequest({
        method: "GET",
        pathname: `${BASE}/sign-in/username`,
      })
    ).toBe(false);
    expect(
      isAllowedPublicAuthRequest({
        method: "GET",
        pathname: `${BASE}/sign-in/name`,
      })
    ).toBe(false);
    expect(
      isAllowedPublicAuthRequest({
        method: "GET",
        pathname: `${BASE}/sign-out`,
      })
    ).toBe(false);
    expect(
      isAllowedPublicAuthRequest({
        method: "POST",
        pathname: `${BASE}/get-session`,
      })
    ).toBe(false);
  });

  it("refuses registered lifecycle routes and dynamic reset paths", () => {
    const refused = [
      { method: "POST", pathname: `${BASE}/sign-up/email` },
      { method: "POST", pathname: `${BASE}/sign-in/email` },
      { method: "POST", pathname: `${BASE}/request-password-reset` },
      { method: "POST", pathname: `${BASE}/reset-password/token-abc` },
      { method: "POST", pathname: `${BASE}/change-email` },
      { method: "POST", pathname: `${BASE}/is-username-available` },
      { method: "DELETE", pathname: `${BASE}/delete-user` },
      { method: "GET", pathname: `${BASE}/list-sessions` },
      { method: "POST", pathname: `${BASE}/sign-out/all` },
    ];
    for (const target of refused) {
      expect(
        isAllowedPublicAuthRequest(target),
        `${target.method} ${target.pathname}`
      ).toBe(false);
    }
  });

  it("refuses paths outside the auth base path", () => {
    expect(
      isAllowedPublicAuthRequest({
        method: "POST",
        pathname: "/api/v2/sign-in/username",
      })
    ).toBe(false);
    expect(
      isAllowedPublicAuthRequest({ method: "GET", pathname: "/get-session" })
    ).toBe(false);
  });

  it("tolerates a trailing slash only on an allowed path", () => {
    expect(
      isAllowedPublicAuthRequest({
        method: "GET",
        pathname: `${BASE}/get-session/`,
      })
    ).toBe(true);
    expect(
      isAllowedPublicAuthRequest({
        method: "GET",
        pathname: `${BASE}/get-session//`,
      })
    ).toBe(false);
  });
});
