# S3 portable prototype and Mac implementation handoff

This transport branch carries the complete current clickable S3 prototype (all screens/states in the one HTML source), its editable counterpart, original visual references, current-source representative captures, and the approved implementation/spec snapshots. It contains the existing application source at `1907979fb689e120a50c629ef14f0570c0f20749`; application runtime/auth/API/DB code is unchanged by this handoff.

## Open on a Mac

From your existing authenticated repository clone:

```sh
git fetch origin
git switch --track origin/handoff/s3-ui-prototype-194
open docs/plans/project-v1/s3-ui-prototype-194/prototypes/s3-design-preview-20261026.html
```

If that local branch already exists, use `git switch handoff/s3-ui-prototype-194` instead. The HTML is self-contained: inline styles, JavaScript, SVG icons and synthetic data, with no WSL path, CDN, API, database or package install required for preview. A browser may render fonts/platform details differently; Mac/Safari has not been checked here.

The implementation workflow target stays [#194](https://github.com/Noahlw/efcc-system/issues/194). Read that issue, [#29](https://github.com/Noahlw/efcc-system/issues/29) and the assigned child/comments before starting. The first unblocked child is #195. This transfer does not invoke implementation or authorize merge/deployment.

## Files and authority

- [Current clickable HTML](prototypes/s3-design-preview-20261026.html) and [editable counterpart](prototypes/scoped-roles-responsive.html) are byte-identical at capture. SHA-256: `c4c69e59efcd06ad80623bbd4b1f343153153dcf18475b17f438496e5c6e1cff`.
- [Original reference images](references/reference-manifest.json) retain their original bytes/hashes; accepted later #194 decisions supersede older visual details.
- [Phone/tablet/desktop gallery](preview/review-gallery.html) contains representative current-source captures; [scope of historical checks](preview/README.md) states their limits.
- [UI/frontend spec snapshot](specs/194.md) and [business/security spec snapshot](specs/29.md) include source comments. They are frozen reading aids; live GitHub remains authoritative.
- [Implementation tickets](tickets/) carry methods, existing/proposed file maps, components/libraries, test files and acceptance criteria. [Planning notes](planning/README.md) preserve source-owner/documentation context.
- [Earlier source iterations](archive/README.md) are explicitly superseded history and must not override the current source/spec.

## Implementation frontier

| Ticket | End-to-end slice | Blocked by |
| --- | --- | --- |
| [#195](https://github.com/Noahlw/efcc-system/issues/195) | S3: person-first search and responsive responsibilities overview | None |
| [#196](https://github.com/Noahlw/efcc-system/issues/196) | S3: Member/Staff identity task with shared bottom actions and confirmation | #195 |
| [#197](https://github.com/Noahlw/efcc-system/issues/197) | S3: atomically save one person’s Department Manager changes | #196 |
| [#198](https://github.com/Noahlw/efcc-system/issues/198) | S3: save mixed Department and Program duties in one person task | #197 |
| [#199](https://github.com/Noahlw/efcc-system/issues/199) | S3: Department-to-Program workspace and scoped Leader cleanup | #198 |
| [#200](https://github.com/Noahlw/efcc-system/issues/200) | S3: atomically grant several Leaders in one Program | #199 |
| [#201](https://github.com/Noahlw/efcc-system/issues/201) | S3: independent Staff Role Assigner delegation task | #196 |
| [#202](https://github.com/Noahlw/efcc-system/issues/202) | S3: direct Admin grant with fresh overview and Session consequence | #196 |
| [#203](https://github.com/Noahlw/efcc-system/issues/203) | S3: own Admin exit from Account with guarded fresh sign-in | #196 |
| [#204](https://github.com/Noahlw/efcc-system/issues/204) | S3: converge role routes, current-access navigation and historical Inbox | #200, #201, #202, #203 |

## Adapt the design into production owners

Use the HTML to inspect the accepted visual/interaction design. Compose production RootFrame/PageFrame/PrimaryNavigation, existing tokens and Button CVA variants, fields/forms, Base UI dialogs and current feature/API/lifetime owners. Do not transplant the standalone DOM/string renderer, fixture actor switcher or synthetic mutation simulation into production. The tickets own the planned real aggregate commands and their native qualification; a working preview does not establish permissions, authentication, security or atomic DB behavior.

## Integrity

Run from this bundle directory on macOS or Linux:

```sh
shasum -a 256 -c checksums.sha256
```

The checksum list covers all transported files except itself. `manifest.json` records source/base identity and ticket dependencies. Main and editable HTML must retain the pinned hash until an explicitly accepted design change updates the reference. Prototype reference paths in the transported snapshots are repository-relative; preserved historical comments retain their original provenance.

## Qualification and integration limits

This is an artifact transport branch, not a merge-ready implementation. Application dependencies and the local Husky hook installation are absent in the exporting worktree; no application/native qualification is claimed. The existing source-impact policy classifies Markdown under docs/plans, but does not yet register this new prototype HTML/PNG/JSON artifact area. Preserve that fail-closed policy: before an implementation/merge candidate includes these artifacts, add narrowly scoped source-impact ownership and run the existing required selection/qualification gates. Do not disable the guard or weaken production/UI mappings. No merge/deployment is part of this transfer. Raw browser state, credentials, member records, caches, node_modules and private runtime logs are not transported.
