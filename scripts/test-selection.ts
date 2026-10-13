import path from "node:path";

export interface TestSelection {
  tags: string[];
  mobile: boolean;
  foundation: boolean;
  causal: boolean;
  dev: boolean;
  requiresRuntime: boolean;
}

type Policy = TestSelection;
type Options = Partial<Pick<Policy, "mobile" | "foundation" | "causal" | "dev">>;

const runtime = (tags: string[], options: Options = {}): Policy => ({
  tags,
  mobile: options.mobile ?? false,
  foundation: options.foundation ?? false,
  causal: options.causal ?? false,
  dev: options.dev ?? false,
  requiresRuntime: true,
});

const fastOnly: Policy = {
  tags: [],
  mobile: false,
  foundation: false,
  causal: false,
  dev: false,
  requiresRuntime: false,
};

const full: Policy = runtime(["@native"], {
  mobile: true,
  foundation: true,
  causal: true,
  dev: true,
});

const browserFeature = (tags: string[]) => runtime(tags, { mobile: true });

const featureSpecs: Record<string, Policy> = {
  "access-foundation.spec.ts": browserFeature([
    "@access-foundation",
    "@risk-auth",
    "@risk-csrf",
    "@risk-origin",
    "@risk-session-cookie",
    "@risk-session",
    "@risk-privacy",
  ]),
  "account-applicant.spec.ts": browserFeature([
    "@account-applicant",
    "@risk-atomicity",
    "@risk-actor-target-key",
    "@risk-recovery",
    "@risk-privacy",
  ]),
  "account-application.spec.ts": browserFeature([
    "@account-application",
    "@risk-auth",
    "@risk-atomicity",
    "@risk-actor-target-key",
    "@risk-recovery",
    "@risk-privacy",
  ]),
  "account-assisted.spec.ts": browserFeature([
    "@account-assisted",
    "@risk-auth",
    "@risk-atomicity",
    "@risk-actor-target-key",
    "@risk-verifier-race",
    "@risk-recovery",
    "@risk-privacy",
    "@risk-non-replay",
  ]),
  "account-clock-matrix.spec.ts": runtime(
    [
      "@account-clock-matrix",
      "@risk-auth",
      "@risk-atomicity",
      "@risk-deadline",
    ],
    { causal: true }
  ),
  "account-decisions.spec.ts": browserFeature([
    "@account-decisions",
    "@risk-authorization",
    "@risk-atomicity",
    "@risk-actor-target-key",
    "@risk-recovery",
    "@risk-privacy",
  ]),
  "account-deletion.spec.ts": browserFeature([
    "@deletion",
    "@risk-atomicity",
    "@risk-actor-target-key",
    "@risk-recovery",
    "@risk-privacy",
    "@risk-security",
  ]),
  "account-identity.spec.ts": browserFeature([
    "@account-identity",
    "@risk-auth",
    "@risk-atomicity",
    "@risk-actor-target-key",
    "@risk-recovery",
    "@risk-privacy",
  ]),
  "account-restrictions.spec.ts": browserFeature([
    "@risk-authority",
    "@risk-atomicity",
    "@risk-actor-target-key",
    "@risk-recovery",
    "@risk-privacy",
    "@risk-concurrency",
  ]),
  "account-security.spec.ts": browserFeature([
    "@security",
    "@risk-auth",
    "@risk-atomicity",
    "@risk-actor-target-key",
    "@risk-verifier-race",
    "@risk-session",
    "@risk-recovery",
    "@risk-privacy",
    "@risk-non-replay",
  ]),
  "guard-failures.spec.ts": browserFeature([
    "@guard-failures",
    "@risk-auth",
    "@risk-atomicity",
    "@risk-recovery",
    "@risk-privacy",
  ]),
  "home-notices.spec.ts": browserFeature([
    "@home",
    "@risk-authority",
    "@risk-privacy",
  ]),
  "home-participation.spec.ts": browserFeature([
    "@home",
    "@risk-atomicity",
    "@risk-privacy",
  ]),
  "name-sign-in.spec.ts": browserFeature([
    "@name-sign-in",
    "@risk-authentication",
    "@risk-auth-boundary",
    "@risk-csrf",
    "@risk-session-cookie",
    "@risk-actor-target-key",
    "@risk-privacy",
  ]),
  "qualification.spec.ts": browserFeature(["@qualification"]),
  "r11-ui.spec.ts": browserFeature([
    "@r11-ui",
    "@risk-presentation",
    "@risk-auth",
    "@risk-actor-target-key",
    "@risk-recovery",
    "@risk-privacy",
  ]),
  "rate-limit.spec.ts": runtime([
    "@rate-limit",
    "@risk-real-limiter",
    "@risk-shared-bucket",
    "@risk-recovery",
  ]),
  "restricted-status.spec.ts": runtime(
    ["@risk-access", "@risk-session", "@risk-auth"],
    { mobile: true, dev: true }
  ),
  "session-renewal.spec.ts": browserFeature([
    "@risk-session",
    "@risk-cache",
    "@risk-history",
    "@risk-privacy",
  ]),
  "zz-worker-faults.spec.ts": browserFeature([
    "@zz-worker-faults",
    "@risk-auth",
    "@risk-atomicity",
    "@risk-recovery",
    "@risk-privacy",
  ]),
};

const featurePrefix = "tests/e2e/";
const foundationPolicy = runtime(["@foundation"], { foundation: true });
const authPolicy = browserFeature([
  "@access-foundation",
  "@name-sign-in",
  "@risk-auth",
  "@risk-authentication",
  "@risk-auth-boundary",
  "@risk-csrf",
  "@risk-origin",
  "@risk-session",
  "@risk-session-cookie",
  "@risk-actor-target-key",
  "@risk-verifier-race",
  "@risk-non-replay",
  "@risk-privacy",
]);
const accountPolicy = runtime([
  "@account-applicant",
  "@account-application",
  "@account-assisted",
  "@account-decisions",
  "@account-identity",
  "@deletion",
  "@security",
  "@risk-authority",
  "@risk-atomicity",
  "@risk-actor-target-key",
  "@risk-verifier-race",
  "@risk-recovery",
  "@risk-privacy",
  "@risk-non-replay",
]);
const accountUiPolicy = runtime(
  [...accountPolicy.tags, "@risk-presentation", "@r11-ui"],
  { mobile: true }
);
const databasePolicy = runtime(
  [
    "@foundation",
    "@risk-auth",
    "@risk-csrf",
    "@risk-session",
    "@risk-atomicity",
    "@risk-deadline",
    "@risk-actor-target-key",
    "@risk-verifier-race",
    "@risk-recovery",
    "@risk-privacy",
    "@risk-non-replay",
  ],
  { foundation: true, causal: true }
);
const presentationPolicy = runtime(
  [
    "@qualification",
    "@r11-ui",
    "@home",
    "@risk-presentation",
    "@risk-privacy",
  ],
  { mobile: true }
);

const mobileAccountFiles = new Set([
  "src/features/account/applicant-form.tsx",
  "src/features/account/application-form.tsx",
  "src/features/account/deletion-form.tsx",
  "src/features/account/decision-review.tsx",
  "src/features/account/identity-form.tsx",
  "src/features/account/identity-form-views.tsx",
  "src/features/account/restrictions-form.tsx",
  "src/features/account/security-form.tsx",
  "src/features/account/security-form-views.tsx",
  "src/features/account/staff-accounts-form.tsx",
]);

const accountSourceAreas: readonly { match: RegExp; policy: Policy }[] = [
  {
    match: /^src\/features\/account\/(?:applicant-|application)/u,
    policy: runtime([
      "@account-applicant",
      "@account-application",
      "@risk-auth",
      "@risk-atomicity",
      "@risk-actor-target-key",
      "@risk-recovery",
      "@risk-privacy",
    ]),
  },
  {
    match: /^src\/features\/account\/staff-account/u,
    policy: runtime([
      "@account-assisted",
      "@risk-auth",
      "@risk-atomicity",
      "@risk-actor-target-key",
      "@risk-verifier-race",
      "@risk-recovery",
      "@risk-privacy",
      "@risk-non-replay",
    ]),
  },
  {
    match: /^src\/features\/account\/(?:decision|audit)/u,
    policy: runtime([
      "@account-decisions",
      "@risk-authorization",
      "@risk-atomicity",
      "@risk-actor-target-key",
      "@risk-recovery",
      "@risk-privacy",
    ]),
  },
  {
    match: /^src\/features\/account\/deletion/u,
    policy: runtime([
      "@deletion",
      "@risk-atomicity",
      "@risk-actor-target-key",
      "@risk-recovery",
      "@risk-privacy",
      "@risk-security",
    ]),
  },
  {
    match: /^src\/features\/account\/(?:identity|account-changes)/u,
    policy: runtime([
      "@account-identity",
      "@risk-auth",
      "@risk-atomicity",
      "@risk-actor-target-key",
      "@risk-recovery",
      "@risk-privacy",
    ]),
  },
  {
    match: /^src\/features\/account\/(?:restriction|restrictions)/u,
    policy: runtime([
      "@risk-authority",
      "@risk-atomicity",
      "@risk-actor-target-key",
      "@risk-recovery",
      "@risk-privacy",
    ]),
  },
  {
    match: /^src\/features\/account\/security/u,
    policy: runtime([
      "@security",
      "@risk-auth",
      "@risk-atomicity",
      "@risk-actor-target-key",
      "@risk-verifier-race",
      "@risk-session",
      "@risk-recovery",
      "@risk-privacy",
      "@risk-non-replay",
    ]),
  },
  {
    match: /^src\/features\/account\/(?:operation-presentation|staff-people|staff-management)/u,
    policy: accountUiPolicy,
  },
  {
    match: /^src\/features\/account\/(?:account-guards|read-routes|reconciliation-query|timestamps|staff-task-contract|operation-error)\./u,
    policy: accountPolicy,
  },
];

const sourceAreas: readonly { prefix: string; policy: Policy }[] = [
  { prefix: "src/features/auth/", policy: authPolicy },
  {
    prefix: "src/features/identity/",
    policy: browserFeature([
      "@account-identity",
      "@name-sign-in",
      "@risk-auth",
      "@risk-authentication",
      "@risk-actor-target-key",
      "@risk-recovery",
      "@risk-privacy",
    ]),
  },
  {
    prefix: "src/features/home/",
    policy: browserFeature(["@home", "@risk-authority", "@risk-privacy"]),
  },
  { prefix: "src/server/auth/", policy: { ...authPolicy, foundation: true } },
  { prefix: "src/server/api/", policy: full },
  { prefix: "src/server/db/", policy: databasePolicy },
  { prefix: "migrations/", policy: databasePolicy },
  {
    prefix: "src/shared/time/",
    policy: browserFeature(["@home", "@qualification"]),
  },
  {
    prefix: "src/shared/protected-pages.ts",
    policy: browserFeature([
      "@risk-auth",
      "@risk-access",
      "@risk-session",
      "@risk-private-cache",
    ]),
  },
  {
    prefix: "src/shared/business-rpc.ts",
    policy: accountPolicy,
  },
  { prefix: "src/components/", policy: presentationPolicy },
  { prefix: "src/app/(auth)/", policy: authPolicy },
  {
    prefix: "src/app/unavailable/",
    policy: browserFeature([
      "@risk-access",
      "@risk-auth",
      "@risk-presentation",
      "@risk-privacy",
    ]),
  },
  {
    prefix: "src/app/(task)/status/",
    policy: runtime(["@risk-access", "@risk-session", "@dev"], {
      mobile: true,
      dev: true,
    }),
  },
  {
    prefix: "src/app/(task)/application/",
    policy: browserFeature([
      "@account-application",
      "@account-applicant",
      "@risk-auth",
      "@risk-actor-target-key",
      "@risk-recovery",
      "@risk-privacy",
    ]),
  },
  {
    prefix: "src/app/(workspace)/account/",
    policy: { ...accountUiPolicy, mobile: true },
  },
  {
    prefix: "src/app/(workspace)/inbox/",
    policy: browserFeature([
      "@account-decisions",
      "@risk-actor-target-key",
      "@risk-recovery",
      "@risk-privacy",
    ]),
  },
  {
    prefix: "src/app/(workspace)/layout.tsx",
    policy: accountUiPolicy,
  },
  {
    prefix: "src/app/(workspace)/",
    policy: browserFeature(["@home", "@risk-authority", "@risk-privacy"]),
  },
  {
    prefix: "src/app/staff/accounts/",
    policy: { ...accountUiPolicy, mobile: true },
  },
  {
    prefix: "src/app/staff/applications/",
    policy: browserFeature([
      "@account-decisions",
      "@risk-authorization",
      "@risk-actor-target-key",
      "@risk-recovery",
      "@risk-privacy",
    ]),
  },
  {
    prefix: "src/app/staff/account-audit/",
    policy: browserFeature([
      "@account-decisions",
      "@risk-authorization",
      "@risk-privacy",
    ]),
  },
  { prefix: "src/app/api/auth/", policy: authPolicy },
  { prefix: "src/app/api/v2/", policy: full },
  {
    prefix: "src/app/api/internal/test-setup/",
    policy: foundationPolicy,
  },
  {
    prefix: "src/app/(task)/",
    policy: browserFeature(["@risk-access", "@account-application"]),
  },
  { prefix: "src/app/error.tsx", policy: presentationPolicy },
  { prefix: "src/app/layout.tsx", policy: presentationPolicy },
  { prefix: "src/app/globals.css", policy: presentationPolicy },
  { prefix: "src/proxy.ts", policy: { ...authPolicy, foundation: true } },
];

const exactPolicies = new Map<string, Policy>([
  ["tests/e2e/testing-foundation.spec.ts", foundationPolicy],
  ...Object.entries(featureSpecs).map(([file, policy]) => [
    `${featurePrefix}${file}`,
    policy,
  ] as const),
  ["tests/e2e/r11-presentation.ts", presentationPolicy],
  ["tests/e2e/seed.ts", full],
  ["tests/e2e/staff-fixture.ts", full],
  ["tests/support/fixtures.ts", full],
  ["tests/support/native-source.ts", foundationPolicy],
  ["tests/support/causal.ts", runtime(["@account-clock-matrix", "@risk-deadline", "@risk-atomicity"], { causal: true })],
  ["tests/support/credential-fixtures.ts", runtime(["@account-assisted", "@security", "@risk-verifier-race", "@risk-auth", "@risk-atomicity"])],
  ["tests/support/home.ts", browserFeature(["@home", "@risk-privacy"])],
  ["tests/worker/clock-matrix.ts", runtime(["@account-clock-matrix", "@risk-deadline", "@risk-atomicity"], { causal: true })],
  ["tests/worker/credential-race.ts", runtime(["@account-assisted", "@security", "@risk-verifier-race", "@risk-auth"])],
  ["tests/worker/dev-driver.ts", runtime(["@dev", "@risk-access"], { dev: true })],
  ["tests/worker/business-fault.ts", runtime(["@guard-failures", "@zz-worker-faults", "@risk-atomicity", "@risk-recovery", "@risk-privacy"], { foundation: true })],
  ["tests/worker/provision.ts", full],
  ["tests/worker/provision.jsonc", full],
  ["tests/scenarios/accounts.ts", accountPolicy],
  ["tests/scenarios/activities.ts", browserFeature(["@home", "@risk-privacy"])],
  ["tests/scenarios/notices.ts", browserFeature(["@home", "@risk-authority", "@risk-privacy"])],
  ["tests/scenarios/limiter.ts", runtime(["@access-foundation", "@name-sign-in", "@rate-limit", "@risk-real-limiter", "@risk-shared-bucket", "@risk-auth"])],
  ["tests/scenarios/local-env.ts", full],
  ["scripts/build-causal.ts", runtime(["@account-clock-matrix", "@risk-deadline", "@risk-atomicity"], { causal: true })],
  ["scripts/build-credential-race.ts", runtime(["@account-assisted", "@security", "@risk-verifier-race", "@risk-auth"])],
  ["scripts/assert-native-dev-root.ts", runtime(["@dev", "@risk-access"], { dev: true })],
  ["playwright.native.config.ts", full],
  ["playwright.features.config.ts", full],
  ["playwright.causal.config.ts", full],
  ["playwright.dev.config.ts", full],
  ["playwright.lifecycle.config.ts", full],
  ["playwright.config.ts", full],
  ["scripts/test-selection.ts", full],
  ["scripts/test-snapshot.ts", full],
  ["scripts/test-runner.ts", full],
  ["package.json", full],
  ["pnpm-lock.yaml", full],
  [".npmrc", full],
  [".dev.vars.example", full],
  [".gitignore", full],
  [".husky/commit-msg", full],
  ["scripts/assert-legacy-source.ts", full],
  ["tests/worker/tsconfig.json", full],
  [".husky/pre-commit", full],
  [".lintstagedrc.json", full],
  ["tsconfig.json", full],
  ["vitest.config.ts", full],
  ["wrangler.jsonc", full],
  ["vite.config.ts", full],
  ["src/env.d.ts", full],
  [".github/workflows/checks.yml", fastOnly],
  ["tests/shared/application-contract.test.ts", fastOnly],
  ["tests/shared/church-time.test.ts", fastOnly],
  ["tests/shared/decision-contract.test.ts", fastOnly],
  ["tests/shared/deletion-contract.test.ts", fastOnly],
  ["tests/shared/identity-contract.test.ts", fastOnly],
  ["tests/shared/restriction-contract.test.ts", fastOnly],
  ["tests/shared/security-contract.test.ts", fastOnly],
  ["tests/shared/staff-account-contract.test.ts", fastOnly],
  ["tests/shared/test-foundation.test.ts", fastOnly],
  ["tests/shared/test-selection.test.ts", fastOnly],
  ["tests/ui/app-error.test.tsx", fastOnly],
  ["tests/ui/query-provider.test.tsx", fastOnly],
  ["tests/worker/public-auth-boundary.test.ts", fastOnly],
  ["tests/types/business-api.ts", fastOnly],
  ["README.md", fastOnly],
  ["CONTEXT.md", fastOnly],
  ["docs/testing.md", fastOnly],
  ["docs/adr/0001-authentication-and-business-access.md", fastOnly],
  ["docs/adr/0002-native-testing-runtime.md", fastOnly],
  ["docs/adr/0003-native-presentation.md", fastOnly],
  ["docs/adr/0004-native-causal-controls.md", fastOnly],
]);

const repositoryRoot = path.resolve(import.meta.dirname, "..");

const normalizePath = (input: string) => {
  const absolute = path.isAbsolute(input) ? path.relative(repositoryRoot, input) : input;
  return path.posix.normalize(absolute.replaceAll("\\", "/")).replace(/^\.\//u, "");
};

const policyFor = (sourcePath: string): Policy | undefined => {
  const exact = exactPolicies.get(sourcePath);
  if (exact) {
    return exact;
  }
  const accountArea = accountSourceAreas.find(({ match }) => match.test(sourcePath));
  if (accountArea) {
    return mobileAccountFiles.has(sourcePath)
      ? { ...accountArea.policy, mobile: true }
      : accountArea.policy;
  }
  return sourceAreas.find(({ prefix }) => sourcePath.startsWith(prefix))?.policy;
};

export function selectTests(paths: readonly string[], fullRun = false): TestSelection {
  if (fullRun) {
    return { ...full, tags: [...full.tags] };
  }
  if (paths.length === 0) {
    return { ...fastOnly, tags: [] };
  }

  const policies = paths.map((input) => {
    const sourcePath = normalizePath(input);
    if (
      !sourcePath ||
      sourcePath === "." ||
      sourcePath === ".." ||
      sourcePath.startsWith("../") ||
      path.posix.isAbsolute(sourcePath)
    ) {
      throw new Error(`Unclassified test source path: ${input}; add a mapping or request explicit full qualification.`);
    }
    const policy = policyFor(sourcePath);
    if (!policy) {
      throw new Error(`Unclassified test source path: ${sourcePath}; add a mapping or request explicit full qualification.`);
    }
    return policy;
  });

  const selectedTags = [...new Set(policies.flatMap(({ tags }) => tags))].sort();
  const requiresRuntime = policies.some(({ requiresRuntime }) => requiresRuntime);
  if (requiresRuntime && selectedTags.length === 0) {
    throw new Error("Runtime selection must include at least one native feature or risk tag.");
  }

  return {
    tags: requiresRuntime ? selectedTags : [],
    mobile: policies.some(({ mobile }) => mobile),
    foundation: policies.some(({ foundation }) => foundation),
    causal: policies.some(({ causal }) => causal),
    dev: policies.some(({ dev }) => dev),
    requiresRuntime,
  };
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export function nativeGrep(base: RegExp): RegExp {
  const raw = process.env.EFCC_REQUIRED_TAGS;
  if (raw === undefined) {
    return base;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("EFCC_REQUIRED_TAGS must be a non-empty JSON array of native tags.");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((tag) => typeof tag !== "string" || !/^@[a-z0-9][a-z0-9-]*$/u.test(tag))
  ) {
    throw new Error("EFCC_REQUIRED_TAGS must be a non-empty JSON array of native tags.");
  }

  const tags = [...new Set(parsed as string[])];
  const tagAlternation = tags
    .map((tag) => `${escapeRegExp(tag)}(?![A-Za-z0-9_-])`)
    .join("|");
  const flags = base.flags.replace(/[gy]/gu, "");
  return new RegExp(
    `(?=[\\s\\S]*?(?:${base.source}))(?=[\\s\\S]*?(?:${tagAlternation}))`,
    flags
  );
}
const structuralTags = new Set([
  "@native",
  "@http",
  "@browser",
  "@mobile-critical",
  "@dev",
]);
const riskTags = new Set([
  "@risk-access",
  "@risk-account-status",
  "@risk-actor-isolation",
  "@risk-actor-target-key",
  "@risk-anonymous-access",
  "@risk-atomicity",
  "@risk-auth",
  "@risk-auth-boundary",
  "@risk-auth-ui",
  "@risk-authentication",
  "@risk-authorization",
  "@risk-authority",
  "@risk-business-denial",
  "@risk-cache",
  "@risk-canonical-distinction",
  "@risk-canonical-name",
  "@risk-concurrency",
  "@risk-csrf",
  "@risk-deadline",
  "@risk-deletion",
  "@risk-denial",
  "@risk-draft",
  "@risk-email-state",
  "@risk-freshness",
  "@risk-history",
  "@risk-immutability",
  "@risk-injected-network",
  "@risk-name-sign-in",
  "@risk-no-write",
  "@risk-non-enumeration",
  "@risk-non-replay",
  "@risk-origin",
  "@risk-privacy",
  "@risk-private-cache",
  "@risk-presentation",
  "@risk-real-limiter",
  "@risk-recovery",
  "@risk-resilience",
  "@risk-review",
  "@risk-restriction",
  "@risk-rollback",
  "@risk-secret",
  "@risk-secret-draft",
  "@risk-security",
  "@risk-session",
  "@risk-session-cookie",
  "@risk-shared-bucket",
  "@risk-script-distinction",
  "@risk-sign-in-draft",
  "@risk-staff-access",
  "@risk-temporary-credential",
  "@risk-username-case",
  "@risk-unsent-draft",
  "@risk-validation",
  "@risk-verifier-race",
]);
const auxiliaryTags = new Set([
  "@emulation",
  "@injected-delay",
  "@injected-network",
  "@presentation",
  "@privacy",
  "@real-limiter",
  "@resilience",
]);
const featureTags = new Set(
  [
    ...Object.values(featureSpecs),
    ...accountSourceAreas.map(({ policy }) => policy),
    ...sourceAreas.map(({ policy }) => policy),
    ...exactPolicies.values(),
  ]
    .flatMap(({ tags }) => tags)
    .filter((tag) => tag !== "@native" && !tag.startsWith("@risk-"))
);

export function assertNativeClassification(tags: readonly string[]): void {
  const normalizedTags = new Set(
    tags.map((tag) => (tag.startsWith("@") ? tag : `@${tag}`))
  );
  const transports = ["@http", "@browser"].filter((tag) =>
    normalizedTags.has(tag)
  );
  if (
    !normalizedTags.has("@native") ||
    transports.length !== 1 ||
    (normalizedTags.has("@mobile-critical") &&
      !normalizedTags.has("@browser"))
  ) {
    throw new Error(
      "Native cases require @native and exactly one transport; @mobile-critical requires @browser."
    );
  }

  let hasFeatureOrRisk = false;
  for (const tag of normalizedTags) {
    if (featureTags.has(tag) || riskTags.has(tag)) {
      hasFeatureOrRisk = true;
      continue;
    }
    if (!structuralTags.has(tag) && !auxiliaryTags.has(tag)) {
      throw new Error(`Unknown native test tag: ${tag}`);
    }
  }
  if (!hasFeatureOrRisk) {
    throw new Error("Native cases require a known feature or risk tag.");
  }
}
