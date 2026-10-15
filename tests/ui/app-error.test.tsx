import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AppError from "../../src/app/error";

const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn<() => string | null>(),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
  useSearchParams: () => new URLSearchParams(),
}));

const renderError = () =>
  renderToStaticMarkup(
    createElement(AppError, {
      error: new Error("private detail"),
      reset: vi.fn(),
    })
  );

describe("AppError SSR", () => {
  beforeEach(() => {
    usePathnameMock.mockReset();
  });

  it.each(["/sign-in", "/apply", "/unavailable"])(
    "keeps the compact Auth recovery actions on %s",
    (pathname) => {
      usePathnameMock.mockReturnValue(pathname);
      const markup = renderError();

      expect(markup).not.toContain("主要導覽");
      expect(markup).not.toContain("private detail");
    }
  );

  it("renders safe semantic retry markup without private diagnostics", () => {
    usePathnameMock.mockReturnValue("/application");
    const markup = renderError();

    expect(markup).toContain("<main");
    expect(markup).toContain("<h1");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("這頁暫時未能開啟");
    expect(markup).toContain("請重試；如持續出現問題，請聯絡同工。");
    expect(markup).toContain('action="/application"');
    expect(markup).toContain('action="/account"');
    expect(markup).toContain("重試");
    expect(markup).toContain("返回帳戶");
    expect(markup).not.toContain("private detail");
  });

  it("does not expose private exceptions on protected routes", () => {
    usePathnameMock.mockReturnValue("/application");
    const markup = renderError();

    expect(markup).not.toContain("private detail");
  });
});
