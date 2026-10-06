import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AppError from "../../src/app/error";

const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn<() => string | null>(),
}));

vi.mock("next/navigation", () => ({ usePathname: usePathnameMock }));

const renderError = () =>
  renderToStaticMarkup(
    createElement(AppError, {
      error: new Error("private detail"),
      reset: vi.fn(),
    })
  );

describe("AppError", () => {
  beforeEach(() => {
    usePathnameMock.mockReset();
  });

  it.each(["/sign-in", "/apply", "/unavailable"])(
    "keeps the compact Auth recovery actions on %s",
    (pathname) => {
      usePathnameMock.mockReturnValue(pathname);
      const markup = renderError();

      expect(markup).toContain("max-w-[28rem]");
      expect(markup).toContain("重試");
      expect(markup).toContain("登出");
      expect(markup).not.toContain("主要導覽");
      expect(markup).not.toContain("private detail");
    }
  );

  it("keeps task recovery compact on other routes", () => {
    usePathnameMock.mockReturnValue("/application");
    const markup = renderError();

    expect(markup).toContain("max-w-[40rem]");
    expect(markup).toContain("重試");
    expect(markup).not.toContain("登出");
  });
});
