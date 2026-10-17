import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium } from "@playwright/test";
import type { Browser, BrowserContext, Page, Request } from "@playwright/test";

type CookieState = Awaited<ReturnType<BrowserContext["cookies"]>>;

interface DeviceOptions {
  deviceScaleFactor?: number;
  hasTouch?: boolean;
  isMobile?: boolean;
  screen?: { height: number; width: number };
  userAgent?: string;
  viewport: { height: number; width: number } | null | undefined;
}

interface BrowserProfileOptions {
  deviceScaleFactor: number;
  hasTouch: boolean;
  isMobile: boolean;
  screen: { height: number; width: number };
  userAgent: string | undefined;
  viewport: { height: number; width: number };
}

interface ProfileReadback {
  clientHintMobileMatches: boolean;
  coarsePointerMatches: boolean;
  devicePixelRatioMatches: boolean;
  maxTouchPointsMatches: boolean;
  screenMatches: boolean;
  touchEventSupportMatches: boolean;
  userAgentMatches: boolean | null;
  viewportMatches: boolean;
}

interface VisibilityStaffPage {
  close?: () => Promise<void>;
  page: Page;
  profileReadback: ProfileReadback | null;
}

const staffAccountsCreateUrl = (origin: string) =>
  new URL("/staff/accounts?task=create", origin).toString();

const profileFor = (options: DeviceOptions): BrowserProfileOptions => {
  const { viewport } = options;
  if (!viewport) {
    throw new Error("The visibility browser requires a configured viewport");
  }

  return {
    deviceScaleFactor: options.deviceScaleFactor ?? 1,
    hasTouch: options.hasTouch ?? false,
    isMobile: options.isMobile ?? false,
    screen: options.screen ?? viewport,
    userAgent: options.userAgent,
    viewport,
  };
};

const waitForDevToolsPort = async (child: ReturnType<typeof spawn>) => {
  const { stderr } = child;
  if (!stderr) {
    throw new Error("Visibility browser stderr is unavailable");
  }
  const ready = new EventTarget();
  let stderrText = "";
  let portFound = false;
  const onData = (chunk: Buffer | string) => {
    if (portFound) {
      return;
    }
    stderrText += chunk.toString();
    const match = stderrText.match(
      /DevTools listening on ws:\/\/127\.0\.0\.1:(?<port>\d+)\//u
    );
    if (match?.groups?.port) {
      portFound = true;
      ready.dispatchEvent(
        new CustomEvent("port", { detail: Number(match.groups.port) })
      );
    }
  };
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(15_000),
  ]);
  stderr.setEncoding("utf-8");
  stderr.on("data", onData);
  child.once("exit", (code) => {
    ready.dispatchEvent(new CustomEvent("exit", { detail: code }));
  });
  child.once("error", (error) => {
    ready.dispatchEvent(new CustomEvent("spawn-error", { detail: error }));
  });
  try {
    const [event] = await Promise.race([
      once(ready, "port", { signal }),
      once(ready, "exit", { signal }),
      once(ready, "spawn-error", { signal }),
    ]);
    if (event.type === "port") {
      return Number((event as CustomEvent<number>).detail);
    }
    if (event.type === "spawn-error") {
      throw (event as CustomEvent<Error>).detail;
    }
    const exitCode = (event as CustomEvent<number | null>).detail;
    throw new Error(
      `Visibility browser exited before CDP was ready (${exitCode})`
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Visibility browser CDP readiness timed out", {
        cause: error,
      });
    }
    throw error;
  } finally {
    controller.abort();
  }
};

const processErrorCode = (error: unknown) =>
  error && typeof error === "object" && "code" in error
    ? Reflect.get(error, "code")
    : undefined;

const processGroupIsPresent = (pid: number) => {
  if (process.platform === "win32") {
    throw new Error("Visibility browser cleanup requires POSIX process groups");
  }
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (processErrorCode(error) === "ESRCH") {
      return false;
    }
    if (processErrorCode(error) === "EPERM") {
      return true;
    }
    throw error;
  }
};

const signalProcessGroup = (pid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (processErrorCode(error) !== "ESRCH") {
      throw new Error("Could not signal the owned visibility process group", {
        cause: error,
      });
    }
  }
};

const waitForProcessGroupExit = async (pid: number, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!processGroupIsPresent(pid)) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    // eslint-disable-next-line no-await-in-loop -- confirm the owned group is gone before removing its profile.
    await delay(25);
  }
};

const stopProcessGroup = async (pid: number) => {
  if (!processGroupIsPresent(pid)) {
    return;
  }
  signalProcessGroup(pid, "SIGTERM");
  if (await waitForProcessGroupExit(pid, 5000)) {
    return;
  }
  signalProcessGroup(pid, "SIGKILL");
  if (!(await waitForProcessGroupExit(pid, 5000))) {
    throw new Error("Owned visibility browser process group did not exit");
  }
};

const userAgentMetadata = (userAgent: string, isMobile: boolean) => {
  const androidMatch = userAgent.match(
    /Android (?<version>\d+(?:\.\d+){0,2})/u
  );
  return {
    architecture: userAgent.includes("ARM") || androidMatch ? "arm" : "x86",
    mobile: isMobile,
    model: "",
    platform: androidMatch ? "Android" : "Linux",
    platformVersion: androidMatch?.groups?.version ?? "",
  };
};

const applyProfile = async (
  context: BrowserContext,
  page: Page,
  profile: BrowserProfileOptions
) => {
  const session = await context.newCDPSession(page);
  await session.send("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: profile.deviceScaleFactor,
    height: profile.viewport.height,
    mobile: profile.isMobile,
    screenHeight: profile.screen.height,
    screenWidth: profile.screen.width,
    width: profile.viewport.width,
  });
  if (profile.hasTouch) {
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  }
  if (profile.userAgent) {
    await session.send("Emulation.setUserAgentOverride", {
      userAgent: profile.userAgent,
      userAgentMetadata: userAgentMetadata(profile.userAgent, profile.isMobile),
    });
  }

  return session;
};

const readProfile = async (page: Page, profile: BrowserProfileOptions) => {
  const readback = await page.evaluate(
    (expectedUserAgent) => ({
      clientHintMobile: (() => {
        const clientHints = Reflect.get(navigator, "userAgentData") as
          | { mobile?: unknown }
          | undefined;
        return typeof clientHints?.mobile === "boolean"
          ? clientHints.mobile
          : null;
      })(),
      coarsePointer: matchMedia("(pointer: coarse)").matches,
      devicePixelRatio,
      height: innerHeight,
      maxTouchPoints: navigator.maxTouchPoints,
      screenHeight: screen.height,
      screenWidth: screen.width,
      touchEventSupport: "ontouchstart" in window,
      userAgentMatches: expectedUserAgent
        ? navigator.userAgent === expectedUserAgent
        : null,
      width: innerWidth,
    }),
    profile.userAgent ?? null
  );
  return {
    clientHintMobileMatches:
      readback.clientHintMobile === null
        ? !profile.isMobile
        : readback.clientHintMobile === profile.isMobile,
    coarsePointerMatches: readback.coarsePointer === profile.hasTouch,
    devicePixelRatioMatches:
      readback.devicePixelRatio === profile.deviceScaleFactor,
    maxTouchPointsMatches: profile.hasTouch
      ? readback.maxTouchPoints > 0
      : readback.maxTouchPoints === 0,
    screenMatches:
      readback.screenWidth === profile.screen.width &&
      readback.screenHeight === profile.screen.height,
    touchEventSupportMatches: readback.touchEventSupport === profile.hasTouch,
    userAgentMatches: profile.userAgent
      ? readback.userAgentMatches === true
      : null,
    viewportMatches:
      readback.width === profile.viewport.width &&
      readback.height === profile.viewport.height,
  } satisfies ProfileReadback;
};

const requiredStaffHeaders = async (request: Request) => {
  const requestHeaders = await request.allHeaders();
  const { origin, "cf-connecting-ip": connectingIp } = requestHeaders;
  if (!origin || !connectingIp) {
    throw new Error(
      "The Staff page did not send its configured native headers"
    );
  }
  return { "cf-connecting-ip": connectingIp, origin };
};

const openChromiumStaffPage = async (
  origin: string,
  headers: Record<string, string>,
  cookies: CookieState,
  projectOptions: DeviceOptions
) => {
  if (process.platform === "win32") {
    throw new Error("The visibility browser requires POSIX process groups");
  }
  const profileDirectory = await mkdtemp(
    path.join(os.tmpdir(), "efcc-w12-visible-hide-")
  );
  let child: ReturnType<typeof spawn> | undefined;
  let browser: Browser | undefined;
  let session: Awaited<ReturnType<BrowserContext["newCDPSession"]>> | undefined;
  let closed = false;
  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    const cleanupErrors: unknown[] = [];
    await session
      ?.detach()
      .catch((error: unknown) => cleanupErrors.push(error));
    await browser?.close().catch((error: unknown) => cleanupErrors.push(error));
    let processGroupAbsent = !child?.pid;
    if (child?.pid) {
      try {
        await stopProcessGroup(child.pid);
        processGroupAbsent = true;
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (processGroupAbsent) {
      await rm(profileDirectory, {
        force: true,
        maxRetries: 6,
        recursive: true,
        retryDelay: 150,
      }).catch((error: unknown) => cleanupErrors.push(error));
    } else {
      cleanupErrors.push(
        new Error("The temporary Chromium process did not exit")
      );
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        "The temporary visibility browser did not clean up cleanly"
      );
    }
  };

  try {
    await chmod(profileDirectory, 0o700);
    const profileStats = await stat(profileDirectory);
    if (profileStats.mode.toString(8).slice(-3) !== "700") {
      throw new Error(
        "The temporary visibility browser profile is not private"
      );
    }

    const browserEnvironment = { ...process.env };
    delete browserEnvironment.LD_LIBRARY_PATH;
    delete browserEnvironment.CODEX_HOME;
    child = spawn(
      chromium.executablePath(),
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-startup-window",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        `--user-data-dir=${profileDirectory}`,
      ],
      {
        detached: true,
        env: browserEnvironment,
        stdio: ["ignore", "ignore", "pipe"],
      }
    );
    const port = await waitForDevToolsPort(child);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
      isLocal: true,
      noDefaults: true,
      timeout: 10_000,
    });
    const contexts = browser.contexts();
    if (contexts.length !== 1) {
      throw new Error("Expected the connected browser default context");
    }
    const [context] = contexts;
    if (!context) {
      throw new Error("The connected browser has no default context");
    }
    await context.addCookies(cookies);
    const page = await context.newPage();
    await page.setExtraHTTPHeaders(headers);
    const profile = profileFor(projectOptions);
    session = await applyProfile(context, page, profile);
    await page.goto(staffAccountsCreateUrl(origin));
    const profileReadback = await readProfile(page, profile);
    return { close, page, profileReadback };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Visibility browser setup and cleanup failed",
        { cause: cleanupError }
      );
    }
    throw error;
  }
};

const openVisibilityStaffPage = async ({
  fixturePage,
  origin,
  projectName,
  projectOptions,
}: {
  fixturePage: Page;
  origin: string;
  projectOptions: DeviceOptions;
  projectName: string;
}): Promise<VisibilityStaffPage> => {
  const requestPromise = fixturePage.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      request.method() === "GET" &&
      url.origin === origin &&
      url.pathname === "/staff/accounts" &&
      url.searchParams.get("task") === "create"
    );
  });
  await fixturePage.goto(staffAccountsCreateUrl(origin));

  if (projectName === "features-iphone-webkit") {
    await requestPromise;
    return {
      page: fixturePage,
      profileReadback: null,
    };
  }

  if (
    projectName !== "features-chromium" &&
    projectName !== "features-pixel-chromium"
  ) {
    throw new Error(
      "The visibility case ran in an unsupported browser project"
    );
  }

  const request = await requestPromise;
  const headers = await requiredStaffHeaders(request);
  const cookies = await fixturePage.context().cookies();
  await fixturePage.close();
  const chromiumPage = await openChromiumStaffPage(
    origin,
    headers,
    cookies,
    projectOptions
  );
  return chromiumPage;
};

export { openVisibilityStaffPage };
