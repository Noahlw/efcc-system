# EFCC System

Church-management application running on Cloudflare Workers/D1 with vinext, React, Hono and Better Auth. Current scope includes Member Home/Inbox/Account, public applications, Staff decisions/audit, identity work, restrictions, assisted account creation and eligible deletion.

## Local development

Activate the Node version in `.nvmrc` and the pnpm version in `package.json`, then:

```sh
pnpm install --frozen-lockfile --prefer-offline
cp .dev.vars.example .dev.vars
pnpm dev
```

Replace the local placeholders with synthetic development values. Developer D1 migrations (`pnpm db:migrate:local`) and the destructive reset command operate on your local database; testing uses separate owned stores through the snapshot gate. Keep private vars, credentials and member data out of Git.

## Find the right reference

- [Testing workflow](docs/testing.md): commands, fixtures, lifetime, source selection, privacy and troubleshooting.
- [Domain glossary](GLOSSARY.md): canonical EFCC terms.
- [Architectural decisions](docs/adr/): decisions, alternatives and retained seams.
- [Runnable R11 Design Book](docs/design/slice-1-2-ui/README.md): synthetic visual/interaction reference and assets.
- [Agent instructions](AGENTS.md): tracker and domain-document conventions.
- [Rebuild map](https://github.com/Noahlw/efcc-system/issues/2), [library integration #46](https://github.com/Noahlw/efcc-system/issues/46) and [testing foundation #66](https://github.com/Noahlw/efcc-system/issues/66): accepted scope and progress.

`src/app` owns pages/thin entry points, `src/features` owns domain behavior/UI, and `src/server` owns auth/API/database composition. The actual dependencies and versions are in `package.json` and `pnpm-lock.yaml`; the filesystem shows delivered modules.

GitHub CI runs check, typecheck and Node tests. Full Worker/D1/browser qualification runs locally. Work continues on PR #47; implementation, qualification, independent review, owner acceptance, merge and deployment are separate gates.
