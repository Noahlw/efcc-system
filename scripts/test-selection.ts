import path from "node:path";

export interface TestSelection {
  tags: string[];
  mobile: boolean;
  configs: string[];
}

type Policy = TestSelection;
const runtime = (
  tags: string[],
  options: Partial<Pick<Policy, "mobile" | "configs">> = {}
): Policy => ({
  configs: options.configs ?? [],
  mobile: options.mobile ?? false,
  tags,
});

const fastOnly: Policy = runtime([]);
const explicitFull = runtime(["@native"], { mobile: true });

const riskTags = new Set([
  "@risk-access",
  "@risk-accessibility",
  "@risk-ambiguity",
  "@risk-account-status",
  "@risk-actor-isolation",
  "@risk-actor-target-key",
  "@risk-anonymous-access",
  "@risk-atomicity",
  "@risk-auth",
  "@risk-auth-boundary",
  "@risk-auth-recovery",
  "@risk-auth-ui",
  "@risk-authentication",
  "@risk-authorization",
  "@risk-authority",
  "@risk-business-denial",
  "@risk-cache",
  "@risk-canonical-distinction",
  "@risk-canonical-name",
  "@risk-compatibility",
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
  "@risk-rate-limit",
  "@risk-recovery",
  "@risk-resilience",
  "@risk-responsive",
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
const semanticRiskPolicy = runtime(
  [...riskTags, "@foundation", "@account-clock-matrix", "@dev"],
  { mobile: true }
);

const browserFeature = (tags: string[]) => runtime(tags, { mobile: true });

const familyPolicies: Record<string, Policy> = {
  "access-foundation": browserFeature([
    "@access-foundation",
    "@risk-auth",
    "@risk-csrf",
    "@risk-origin",
    "@risk-session-cookie",
    "@risk-session",
    "@risk-privacy",
  ]),
  "account-applicant": browserFeature([
    "@account-applicant",
    "@risk-atomicity",
    "@risk-actor-target-key",
    "@risk-recovery",
    "@risk-privacy",
    "@risk-compatibility",
    "@risk-rate-limit",
    "@risk-accessibility",
  ]),
  "account-application": browserFeature([
    "@account-application",
    "@risk-auth",
    "@risk-atomicity",
    "@risk-actor-target-key",
    "@risk-recovery",
    "@risk-privacy",
    "@risk-rate-limit",
    "@risk-accessibility",
  ]),
  "account-assisted": browserFeature([
    "@account-assisted",
    "@risk-auth",
    "@risk-atomicity",
    "@risk-actor-target-key",
    "@risk-verifier-race",
    "@risk-recovery",
    "@risk-privacy",
    "@risk-non-replay",
    "@risk-accessibility",
  ]),
  "account-clock-matrix": runtime([
    "@account-clock-matrix",
    "@risk-auth",
    "@risk-atomicity",
    "@risk-deadline",
  ]),
  "account-decisions": browserFeature([
    "@risk-authorization",
    "@risk-atomicity",
    "@risk-actor-target-key",
    "@risk-recovery",
    "@risk-privacy",
  ]),
  "account-deletion": browserFeature([
    "@deletion",
    "@risk-atomicity",
    "@risk-actor-target-key",
    "@risk-recovery",
    "@risk-privacy",
    "@risk-security",
  ]),
  "account-identity": browserFeature([
    "@account-identity",
    "@risk-auth",
    "@risk-atomicity",
    "@risk-actor-target-key",
    "@risk-recovery",
    "@risk-privacy",
  ]),
  "account-restrictions": browserFeature([
    "@risk-authority",
    "@risk-atomicity",
    "@risk-actor-target-key",
    "@risk-recovery",
    "@risk-privacy",
    "@risk-concurrency",
  ]),
  "account-security": browserFeature([
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
  "guard-failures": browserFeature([
    "@guard-failures",
    "@risk-auth",
    "@risk-atomicity",
    "@risk-recovery",
    "@risk-privacy",
  ]),
  "home-notices": browserFeature(["@home", "@risk-authority", "@risk-privacy"]),
  "home-participation": browserFeature([
    "@home",
    "@risk-atomicity",
    "@risk-privacy",
  ]),
  "name-sign-in": browserFeature([
    "@name-sign-in",
    "@risk-authentication",
    "@risk-auth-boundary",
    "@risk-csrf",
    "@risk-session-cookie",
    "@risk-actor-target-key",
    "@risk-privacy",
    "@risk-auth-recovery",
  ]),
  "r11-ui": browserFeature([
    "@r11-ui",
    "@risk-presentation",
    "@risk-auth",
    "@risk-actor-target-key",
    "@risk-recovery",
    "@risk-privacy",
  ]),
  "rate-limit": runtime([
    "@rate-limit",
    "@risk-real-limiter",
    "@risk-shared-bucket",
    "@risk-recovery",
    "@risk-rate-limit",
  ]),
  "restricted-status": runtime(
    ["@risk-access", "@risk-session", "@risk-auth"],
    { mobile: true }
  ),
  "session-renewal": browserFeature([
    "@risk-session",
    "@risk-cache",
    "@risk-history",
    "@risk-privacy",
  ]),
  "sign-in-experience": browserFeature(["@sign-in-experience"]),
  "worker-faults": browserFeature([
    "@worker-faults",
    "@risk-auth",
    "@risk-atomicity",
    "@risk-recovery",
    "@risk-privacy",
  ]),
};
const featurePrefix = "tests/e2e/";
const foundationPolicy = runtime(["@foundation"]);
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
  "@risk-auth-recovery",
]);
const accountPolicy = runtime([
  "@account-clock-matrix",
  "@account-applicant",
  "@account-application",
  "@account-assisted",
  "@account-identity",
  "@deletion",
  "@security",
  "@risk-authority",
  "@risk-authorization",
  "@risk-atomicity",
  "@risk-actor-target-key",
  "@risk-verifier-race",
  "@risk-recovery",
  "@risk-privacy",
  "@risk-non-replay",
  "@risk-compatibility",
  "@risk-rate-limit",
  "@risk-accessibility",
]);
const accountHarnessPolicy = runtime(
  [
    ...accountPolicy.tags,
    "@foundation",
    "@risk-auth",
    "@risk-csrf",
    "@risk-session",
    "@risk-session-cookie",
  ],
  { mobile: true }
);
const accountUiPolicy = runtime(
  [...accountPolicy.tags, "@risk-presentation", "@r11-ui"],
  { mobile: true }
);
const postOperationPolicy = runtime(
  [
    ...accountPolicy.tags,
    "@risk-auth",
    "@risk-session",
    "@risk-session-cookie",
  ],
  { mobile: true }
);
const databasePolicy = runtime([
  "@foundation",
  "@risk-auth",
  "@risk-csrf",
  "@risk-authorization",
  "@risk-session",
  "@risk-atomicity",
  "@risk-deadline",
  "@risk-actor-target-key",
  "@risk-verifier-race",
  "@risk-recovery",
  "@risk-privacy",
  "@risk-non-replay",
  "@risk-auth-recovery",
  "@risk-compatibility",
  "@risk-rate-limit",
  "@risk-accessibility",
]);
const presentationPolicy = runtime(
  [
    "@sign-in-experience",
    "@r11-ui",
    "@home",
    "@risk-presentation",
    "@risk-privacy",
    "@risk-accessibility",
  ],
  { mobile: true }
);

const accountSourceAreas: readonly {
  match: RegExp;
  mobile?: RegExp;
  policy: Policy;
}[] = [
  {
    match:
      /^src\/features\/account\/(?:applications\/)?(?:applicant-[^/]*|application[^/]*)\.(?:ts|tsx)$/u,
    mobile: /\/(?:applicant-form|application-form)\.tsx$/u,
    policy: runtime([
      "@account-applicant",
      "@account-application",
      "@risk-auth",
      "@risk-atomicity",
      "@risk-actor-target-key",
      "@risk-recovery",
      "@risk-privacy",
      "@risk-compatibility",
      "@risk-rate-limit",
      "@risk-accessibility",
    ]),
  },
  {
    match:
      /^src\/features\/account\/(?:assisted-accounts\/)?(?:staff-account[^/]*|assisted-accounts)\.(?:ts|tsx)$/u,
    mobile: /\/staff-accounts-form\.tsx$/u,
    policy: runtime([
      "@account-assisted",
      "@risk-auth",
      "@risk-atomicity",
      "@risk-actor-target-key",
      "@risk-verifier-race",
      "@risk-recovery",
      "@risk-privacy",
      "@risk-accessibility",
      "@risk-non-replay",
    ]),
  },
  {
    match:
      /^src\/features\/account\/(?:(?:decisions|staff-workspace)\/)?(?:decision|audit)[^/]*\.(?:ts|tsx)$/u,
    mobile: /\/decision-review\.tsx$/u,
    policy: runtime([
      "@risk-authorization",
      "@risk-atomicity",
      "@risk-actor-target-key",
      "@risk-recovery",
      "@risk-privacy",
    ]),
  },
  {
    match:
      /^src\/features\/account\/(?:deletion\/)?deletion[^/]*\.(?:ts|tsx)$/u,
    mobile: /\/deletion-form\.tsx$/u,
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
    match:
      /^src\/features\/account\/(?:identity-changes\/)?(?:identity|account-changes)[^/]*\.(?:ts|tsx)$/u,
    mobile: /\/identity-form(?:-views)?\.tsx$/u,
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
    match:
      /^src\/features\/account\/(?:restrictions\/)?(?:restriction|restrictions)[^/]*\.(?:ts|tsx)$/u,
    mobile: /\/restrictions-form\.tsx$/u,
    policy: runtime([
      "@risk-authority",
      "@risk-atomicity",
      "@risk-actor-target-key",
      "@risk-recovery",
      "@risk-privacy",
    ]),
  },
  {
    match:
      /^src\/features\/account\/(?:security\/)?security[^/]*\.(?:ts|tsx)$/u,
    mobile: /\/security-form(?:-views)?\.tsx$/u,
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
    match:
      /^src\/features\/account\/(?:staff-workspace\/)?(?:operation-presentation|staff-people|staff-management)[^/]*\.(?:ts|tsx)$/u,
    policy: accountUiPolicy,
  },
  {
    match:
      /^src\/features\/account\/(?:account-guards|account-change-operations|read-routes|reconciliation-query|staff-task-contract|operation-error)\.(?:ts|tsx)$/u,
    policy: accountPolicy,
  },
];

const sourceAreas: readonly { prefix: string; policy: Policy }[] = [
  { policy: authPolicy, prefix: "src/features/auth/" },
  {
    policy: browserFeature([
      "@account-identity",
      "@name-sign-in",
      "@risk-auth",
      "@risk-authentication",
      "@risk-actor-target-key",
      "@risk-recovery",
      "@risk-privacy",
      "@risk-auth-recovery",
    ]),
    prefix: "src/features/identity/",
  },
  {
    policy: browserFeature(["@home", "@risk-authority", "@risk-privacy"]),
    prefix: "src/features/home/",
  },
  { policy: authPolicy, prefix: "src/server/auth/" },
  { policy: semanticRiskPolicy, prefix: "src/server/api/" },
  { policy: databasePolicy, prefix: "src/server/db/" },
  { policy: databasePolicy, prefix: "migrations/" },
  {
    policy: browserFeature(["@home", "@sign-in-experience"]),
    prefix: "src/shared/time/",
  },
  { policy: presentationPolicy, prefix: "src/components/" },
  { policy: authPolicy, prefix: "src/app/(auth)/" },
  {
    policy: browserFeature([
      "@risk-access",
      "@risk-auth",
      "@risk-presentation",
      "@risk-privacy",
    ]),
    prefix: "src/app/unavailable/",
  },
  {
    policy: runtime(["@risk-access", "@risk-session", "@dev"], {
      mobile: true,
    }),
    prefix: "src/app/(task)/status/",
  },
  {
    policy: browserFeature([
      "@account-application",
      "@account-applicant",
      "@risk-auth",
      "@risk-actor-target-key",
      "@risk-recovery",
      "@risk-privacy",
    ]),
    prefix: "src/app/(task)/application/",
  },
  {
    policy: { ...accountUiPolicy, mobile: true },
    prefix: "src/app/(workspace)/account/",
  },
  {
    policy: browserFeature([
      "@risk-actor-target-key",
      "@risk-recovery",
      "@risk-privacy",
    ]),
    prefix: "src/app/(workspace)/inbox/",
  },
  {
    policy: browserFeature(["@home", "@risk-authority", "@risk-privacy"]),
    prefix: "src/app/(workspace)/",
  },
  {
    policy: { ...accountUiPolicy, mobile: true },
    prefix: "src/app/staff/accounts/",
  },
  {
    policy: browserFeature([
      "@risk-authorization",
      "@risk-actor-target-key",
      "@risk-recovery",
      "@risk-privacy",
    ]),
    prefix: "src/app/staff/applications/",
  },
  {
    policy: browserFeature(["@risk-authorization", "@risk-privacy"]),
    prefix: "src/app/staff/account-audit/",
  },
  { policy: authPolicy, prefix: "src/app/api/auth/" },
  { policy: semanticRiskPolicy, prefix: "src/app/api/v2/" },
  {
    policy: foundationPolicy,
    prefix: "src/app/api/internal/test-setup/",
  },
  {
    policy: browserFeature(["@risk-access", "@account-application"]),
    prefix: "src/app/(task)/",
  },
];

const exactPolicies = new Map<string, Policy>([
  [
    "src/features/account/timestamps.ts",
    runtime([...accountPolicy.tags, "@risk-deadline"]),
  ],
  ["tests/shared/tooling/fixtures.ts", fastOnly],
  [
    "src/features/account/staff-workspace/staff-task-contract.ts",
    accountPolicy,
  ],
  ["src/features/account/identity-validation.ts", semanticRiskPolicy],
  ["src/features/account/account-actors.ts", semanticRiskPolicy],
  ["src/features/account/managed-accounts.ts", accountPolicy],
  ["src/features/account/business-request.ts", semanticRiskPolicy],
  ["src/features/account/business-error-contract.ts", semanticRiskPolicy],
  ["src/features/account/bounded-json-validator.ts", semanticRiskPolicy],
  ["tests/e2e/testing-foundation.spec.ts", foundationPolicy],
  ["tests/e2e/r11-presentation.ts", presentationPolicy],
  ["tests/e2e/presentation-assertions.ts", presentationPolicy],
  ["tests/e2e/seed.ts", accountHarnessPolicy],
  ["tests/support/fixtures.ts", semanticRiskPolicy],
  ["tests/support/native-source.ts", foundationPolicy],
  [
    "tests/support/causal.ts",
    runtime(["@account-clock-matrix", "@risk-deadline", "@risk-atomicity"]),
  ],
  [
    "tests/support/credential-fixtures.ts",
    runtime([
      "@account-assisted",
      "@security",
      "@risk-verifier-race",
      "@risk-auth",
      "@risk-atomicity",
    ]),
  ],
  ["tests/support/home.ts", browserFeature(["@home", "@risk-privacy"])],
  [
    "tests/worker/clock-matrix.ts",
    runtime(["@account-clock-matrix", "@risk-deadline", "@risk-atomicity"]),
  ],
  [
    "tests/worker/credential-race.ts",
    runtime([
      "@account-assisted",
      "@security",
      "@risk-verifier-race",
      "@risk-auth",
    ]),
  ],
  ["tests/worker/dev-driver.ts", runtime(["@dev", "@risk-access"])],
  [
    "tests/worker/business-fault.ts",
    runtime([
      "@guard-failures",
      "@worker-faults",
      "@risk-atomicity",
      "@risk-recovery",
      "@risk-privacy",
    ]),
  ],
  ["tests/worker/provision.ts", semanticRiskPolicy],
  ["tests/worker/provision.jsonc", semanticRiskPolicy],
  ["tests/scenarios/accounts.ts", accountPolicy],
  ["tests/scenarios/activities.ts", browserFeature(["@home", "@risk-privacy"])],
  [
    "tests/scenarios/notices.ts",
    browserFeature(["@home", "@risk-authority", "@risk-privacy"]),
  ],
  [
    "tests/scenarios/limiter.ts",
    runtime([
      "@access-foundation",
      "@name-sign-in",
      "@rate-limit",
      "@risk-rate-limit",
      "@risk-real-limiter",
      "@risk-shared-bucket",
      "@risk-auth",
    ]),
  ],
  ["tests/scenarios/local-env.ts", semanticRiskPolicy],
  [
    "scripts/build-causal.ts",
    runtime(["@account-clock-matrix", "@risk-deadline", "@risk-atomicity"]),
  ],
  [
    "scripts/build-credential-race.ts",
    runtime([
      "@account-assisted",
      "@security",
      "@risk-verifier-race",
      "@risk-auth",
    ]),
  ],
  ["scripts/assert-native-dev-root.ts", runtime(["@dev", "@risk-access"])],
  [
    "playwright.native.config.ts",
    runtime([], { configs: ["playwright.native.config.ts"] }),
  ],
  [
    "playwright.features.config.ts",
    runtime([], { configs: ["playwright.features.config.ts"], mobile: true }),
  ],
  [
    "playwright.causal.config.ts",
    runtime([], { configs: ["playwright.causal.config.ts"] }),
  ],
  [
    "playwright.dev.config.ts",
    runtime([], { configs: ["playwright.dev.config.ts"] }),
  ],
  ["playwright.discovery.config.ts", semanticRiskPolicy],
  ["playwright.lifecycle.config.ts", foundationPolicy],
  ["playwright.config.ts", semanticRiskPolicy],
  ["scripts/test-selection.ts", semanticRiskPolicy],
  ["scripts/test-snapshot.ts", fastOnly],
  ["scripts/test-runner.ts", semanticRiskPolicy],
  ["scripts/portable-build.ts", semanticRiskPolicy],
  ["scripts/runtime-boundaries.ts", semanticRiskPolicy],
  ["turbo.json", semanticRiskPolicy],
  ["package.json", semanticRiskPolicy],
  ["pnpm-lock.yaml", semanticRiskPolicy],
  [".npmrc", semanticRiskPolicy],
  [
    ".dev.vars.example",
    runtime([...authPolicy.tags, "@foundation"], {
      mobile: true,
    }),
  ],
  [".gitignore", runtime(["@foundation", "@risk-atomicity", "@risk-privacy"])],
  [".husky/commit-msg", fastOnly],
  ["scripts/assert-legacy-source.ts", semanticRiskPolicy],
  ["tests/worker/tsconfig.json", fastOnly],
  [".husky/pre-commit", semanticRiskPolicy],
  [".lintstagedrc.json", semanticRiskPolicy],
  ["tsconfig.json", fastOnly],
  ["vitest.config.ts", fastOnly],
  ["wrangler.jsonc", semanticRiskPolicy],
  ["vite.config.ts", semanticRiskPolicy],
  ["src/env.d.ts", fastOnly],
  [".github/workflows/checks.yml", fastOnly],
  ["tests/worker/public-auth-boundary.test.ts", fastOnly],
  ["tests/types/business-api.ts", fastOnly],
  [
    "src/shared/protected-pages.ts",
    browserFeature([
      "@risk-auth",
      "@risk-access",
      "@risk-session",
      "@risk-private-cache",
    ]),
  ],
  ["src/shared/business-rpc.ts", accountPolicy],
  ["src/features/account/post-operation.ts", postOperationPolicy],
  ["src/features/account/staff-task-frame.tsx", accountUiPolicy],
  ["src/app/(workspace)/layout.tsx", accountUiPolicy],
  ["src/app/error.tsx", presentationPolicy],
  ["src/app/layout.tsx", presentationPolicy],
  ["src/app/globals.css", presentationPolicy],
  ["src/proxy.ts", authPolicy],
  ["README.md", fastOnly],
  ["CONTEXT.md", fastOnly],
  ["GLOSSARY.md", fastOnly],
  ["docs/testing.md", fastOnly],
  ["docs/adr/0001-authentication-and-business-access.md", fastOnly],
  ["docs/adr/0002-native-testing-runtime.md", fastOnly],
  ["docs/adr/0003-native-presentation.md", fastOnly],
  ["docs/adr/0004-native-causal-controls.md", fastOnly],
  ["docs/design/slice-1-2-ui/ui-architecture-census.json", fastOnly],
  ["docs/design/slice-1-2-ui/manifest.json", fastOnly],
  ["docs/design/slice-1-2-ui/selected-home-v1.png", fastOnly],
  ["docs/design/slice-1-2-ui/selected-home-v2.png", fastOnly],
  ["docs/testing-foundation/review-material/candidate-manifest.json", fastOnly],
  ["docs/testing-foundation/N16_GATE.md", fastOnly],
  ["docs/design/slice-1-2-ui/screenbook/assets/LUCIDE-LICENSE", fastOnly],
  ["tests/support/lifecycle-child.spec.ts", foundationPolicy],
  ["docs/design/slice-1-2-ui/r11-source-diff-register.csv", fastOnly],
  ["docs/design/slice-1-2-ui/r11-visual-ledger.csv", fastOnly],
]);
const artifactAreas: readonly {
  prefix: string;
  suffix: RegExp;
  policy: Policy;
}[] = [
  { policy: fastOnly, prefix: "tests/shared/", suffix: /\.test\.ts$/u },
  { policy: fastOnly, prefix: "tests/ui/", suffix: /\.test\.tsx$/u },
  { policy: fastOnly, prefix: "docs/testing-foundation/", suffix: /\.md$/u },
  { policy: fastOnly, prefix: "docs/plans/", suffix: /\.md$/u },
  {
    policy: fastOnly,
    prefix: "docs/foundation-programme/",
    suffix: /\.(?:md|json)$/u,
  },
  {
    policy: fastOnly,
    prefix: "docs/design/slice-1-2-ui/",
    suffix: /\.md$/u,
  },
  { policy: fastOnly, prefix: "docs/agents/", suffix: /\.md$/u },
  { policy: fastOnly, prefix: "docs/adr/", suffix: /\.md$/u },
  {
    policy: fastOnly,
    prefix: "docs/testing-foundation/review-material/",
    suffix: /\.(?:json|patch)$/u,
  },
  {
    policy: fastOnly,
    prefix: "docs/design/slice-1-2-ui/verification/",
    suffix: /\.(?:json|png)$/u,
  },
  {
    policy: fastOnly,
    prefix: "docs/design/slice-1-2-ui/screenbook/captures/",
    suffix: /\.jpg$/u,
  },
  {
    policy: fastOnly,
    prefix: "docs/design/slice-1-2-ui/screenbook/assets/",
    suffix: /\.svg$/u,
  },
  {
    policy: fastOnly,
    prefix: "docs/design/slice-1-2-ui/review-images/pr47-r11/",
    suffix: /\.png$/u,
  },
  {
    policy: presentationPolicy,
    prefix: "docs/design/slice-1-2-ui/screenbook/",
    suffix: /\.(?:css|html|mjs)$/u,
  },
];

const repositoryRoot = path.resolve(import.meta.dirname, "..");

const normalizePath = (input: string) => {
  const absolute = path.isAbsolute(input)
    ? path.relative(repositoryRoot, input)
    : input;
  return path.posix
    .normalize(absolute.replaceAll("\\", "/"))
    .replace(/^\.\//u, "");
};

const policyFor = (sourcePath: string): Policy | undefined => {
  // Historical PR-base deletions select the current family, never an old execution tag.
  if (sourcePath === "tests/e2e/qualification.spec.ts") {
    return familyPolicies["sign-in-experience"];
  }
  if (sourcePath === "tests/e2e/zz-worker-faults.spec.ts") {
    return familyPolicies["worker-faults"];
  }
  const exact = exactPolicies.get(sourcePath);
  if (exact) {
    return exact;
  }
  if (
    sourcePath === "tests/e2e/account-assisted/transaction-rollback.spec.ts"
  ) {
    return runtime(["@risk-atomicity", "@risk-recovery"]);
  }
  if (sourcePath.startsWith(featurePrefix)) {
    const family = sourcePath
      .slice(featurePrefix.length)
      .split("/")[0]
      ?.replace(/\.spec\.ts$/u, "");
    if (family && Object.hasOwn(familyPolicies, family)) {
      return familyPolicies[family];
    }
  }
  const accountArea = accountSourceAreas.find(({ match }) =>
    match.test(sourcePath)
  );
  if (accountArea) {
    return accountArea.mobile?.test(sourcePath)
      ? { ...accountArea.policy, mobile: true }
      : accountArea.policy;
  }
  const artifactArea = artifactAreas.find(
    ({ prefix, suffix }) =>
      sourcePath.startsWith(prefix) && suffix.test(sourcePath)
  );
  if (artifactArea) {
    return artifactArea.policy;
  }
  return sourceAreas.find(({ prefix }) => sourcePath.startsWith(prefix))
    ?.policy;
};

export const selectTests = (
  paths: readonly string[],
  fullRun = false
): TestSelection => {
  const sourcePaths = paths.map((input) => {
    const sourcePath = normalizePath(input);
    if (
      !sourcePath ||
      sourcePath === "." ||
      sourcePath === ".." ||
      sourcePath.startsWith("../") ||
      path.posix.isAbsolute(sourcePath) ||
      /^[A-Za-z]:\//u.test(sourcePath)
    ) {
      throw new Error(
        `Unclassified test source path: ${input}; add a mapping or request explicit full qualification.`
      );
    }
    return sourcePath;
  });

  if (fullRun) {
    return { ...explicitFull, tags: [...explicitFull.tags] };
  }
  if (sourcePaths.length === 0) {
    return { ...fastOnly, tags: [] };
  }

  const policies = sourcePaths.map((sourcePath) => {
    const policy = policyFor(sourcePath);
    if (!policy) {
      throw new Error(
        `Unclassified test source path: ${sourcePath}; add a mapping or request explicit full qualification.`
      );
    }
    return policy;
  });

  const selectedTags = [
    ...new Set(policies.flatMap(({ tags }) => tags)),
  ].toSorted();
  return {
    configs: [
      ...new Set(policies.flatMap(({ configs }) => configs)),
    ].toSorted(),
    mobile: policies.some(({ mobile }) => mobile),
    tags: selectedTags,
  };
};

/** Exact tag matching for the native CLI, including risk-auth vs risk-authentication. */
export const selectedGrep = (tags: readonly string[]): string => {
  if (!tags.length || tags.some((tag) => !/^@[a-z0-9][a-z0-9-]*$/u.test(tag))) {
    throw new Error("Native selection requires non-empty valid tags");
  }
  return tags.map((tag) => `${tag}(?![A-Za-z0-9_-])`).join("|");
};
const structuralTags = new Set([
  "@lifecycle",
  "@native",
  "@http",
  "@browser",
  "@mobile-critical",
  "@dev",
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
    ...Object.values(familyPolicies),
    ...accountSourceAreas.map(({ policy }) => policy),
    ...sourceAreas.map(({ policy }) => policy),
    ...exactPolicies.values(),
  ]
    .flatMap(({ tags }) => tags)
    .filter((tag) => tag !== "@native" && !tag.startsWith("@risk-"))
);

export const assertNativeClassification = (tags: readonly string[]): void => {
  const normalizedTags = new Set(
    tags.map((tag) => (tag.startsWith("@") ? tag : `@${tag}`))
  );
  const transports = ["@http", "@browser"].filter((tag) =>
    normalizedTags.has(tag)
  );
  if (
    !normalizedTags.has("@native") ||
    transports.length !== 1 ||
    (normalizedTags.has("@mobile-critical") && !normalizedTags.has("@browser"))
  ) {
    throw new Error(
      "Native cases require @native and exactly one transport; @mobile-critical requires @browser."
    );
  }

  if (normalizedTags.has("@lifecycle") && !normalizedTags.has("@foundation")) {
    throw new Error("Native lifecycle cases belong to the foundation lane.");
  }
  let hasFeatureOrRisk = false;
  let hasRisk = false;
  for (const tag of normalizedTags) {
    if (featureTags.has(tag) || riskTags.has(tag)) {
      hasFeatureOrRisk = true;
      hasRisk ||= riskTags.has(tag);
      continue;
    }
    if (!structuralTags.has(tag) && !auxiliaryTags.has(tag)) {
      throw new Error(`Unknown native test tag: ${tag}`);
    }
  }
  if (
    !normalizedTags.has("@foundation") &&
    !normalizedTags.has("@account-clock-matrix") &&
    !hasRisk
  ) {
    throw new Error("Native feature/dev cases require a known risk tag.");
  }
  if (!hasFeatureOrRisk) {
    throw new Error("Native cases require a known feature or risk tag.");
  }
};
