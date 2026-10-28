# Current source inventory — private implementation audit

Inspected HEAD1907979fb689e120a50c629ef14f0570c0f20749. Kept outside normative spec per to-spec; reverify paths at implementation.

| Existing owner | Reuse / adaptation responsibility |
| --- | --- |
| `src/components/page-frame.tsx` (`PageFrame`, `RootFrame`) and existing primary navigation | Shared shell, one scroll owner, focused/browse composition; minimal shared task-footer/header seam. |
| `src/components/ui/button.tsx`, `icon.tsx`, `input.tsx`, existing `app-form`/field wrappers, `src/app/globals.css` | Actual CVA variants, Lucide geometry, Input and tokens; preserve DOM/refs/keyboard/focus contracts. ADR0009 pins CVA0.7.1/Lucide1.58.0; use existing package pins, not an upgrade project. |
| `src/app/staff/roles/{department-managers,program-leaders,global-roles}/page.tsx`; `src/features/roles/ui/` | Existing person-first role reads/clients/views/APIs; adapt into the new person overview/focused tasks without moving business authorization into UI or copying broad Staff account payloads. |
| `src/app/(workspace)/roles/program-leaders/page.tsx`; `src/features/roles/ui/department-program-leader-workspace.tsx` | Current Department→Program entry/workspace and authorized scope reads; share roster/picker patterns and task owner. |
| Existing role contracts/routes and `role-change-operation.ts` | Preserve single-change/current authority and original-key protections; introduce the two explicit aggregate command/result/reconciliation shapes. Existing DM/PL schemas and receipts are single-target/scope/action, not batches. |
| `src/features/account/security/{security.ts,security-routes.ts,security-form.tsx,security-form-views.tsx}` | Existing proof state/form/protocol and shared `/api/v2/account/password-confirmation`; extract/reuse presentation privately as needed, no second security owner. |
| `src/features/roles/ui/role-command-lifetime.ts` and feature command/reconciliation clients | Original-operation lifetime, late-response/disposal, authorized settlement and exact one-effect handling, extended coherently for aggregate operations. |
