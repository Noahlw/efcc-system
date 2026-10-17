# Native build cache qualification

W17.C01 consumes the W02.C03 native gate/resource contract, W06.C01 production/native stylesheet policy and W07.C05 official form composition surface. Keep their producer receipts separate from fresh execution on the assembled candidate.

Run qualification in a fresh, owned standalone Git export of the candidate with the pinned Node/pnpm and a normal frozen install. Its own Git common directory owns `efcc-native-build-cache`; never mutate another worktree's shared cache. Every invocation uses the actual `pnpm build:cached` entry point and retains its Turbo summary and terminal result.

| Exercise | Required evidence |
| --- | --- |
| Empty cache | One successful build, MISS |
| Same compiled inputs | HIT; stale dist outputs removed before restore |
| Assertion-only edit | Same input hash and HIT; execute runtime assertions separately |
| Compiled CSS/source edit | Different input hash and MISS; emitted asset contains the probe |
| Restored inputs | Original hash and HIT |
| Corrupt owned artifact | Rebuild succeeds with MISS; never accept corrupt output |
| Unusable owned cache path | Fixed `native-build-cache` / `unavailable` / `uncached` event, no raw caught exception/path, successful uncached build |
| Compiler failure | One failed build, nonzero exit; no availability retry |
| Source/cache relocation | Same hash and HIT, then fresh public runtime execution from the new location |

Inspect actual cache archive members and Turbo inputs/outputs. Runtime D1/state, synthetic secrets, test evidence and passing results are not build outputs. Preserve independently owned runtime/evidence markers through build reuse, and ensure stale dist content cannot enter a cache artifact.

After restoring source probes, verify the exported tracked tree matches the candidate. Reuse the existing native foundation claims for built HTML/assets/hydration, real auth/cookies and app-bound D1; run affected form/browser journeys and public type checks. Perform the production build separately from native qualification and retain their distinct source-attributed results. A cached build never substitutes for fresh execution, owner acceptance or remote edge behavior. Dependency/input changes invalidate affected evidence; no fixed speed ratio or byte-identical fresh build is promised.
