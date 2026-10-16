# Official form composition migration inventory

Authority: #94 W07.C01–C05. Baseline `fced6c3ee4accefee51a71b673bea025f9f5bca7`, tree `dfb16f372b3e584a30a2033c6f8524a9700917f9`; current candidate and qualification receipts are linked from #94. This inventory records actual production owners, not a new workflow abstraction.

The baseline has five consumer aliases in four files plus the shared `AppFormApi` definition. Eight production modules contain ten `useAppForm` calls. Before C05, rescan production source for additions, renames, removed paths and remaining legacy imports; this table alone does not prove closure.

| Checkpoint | Production owner | Form instances | Baseline legacy surface | Current disposition |
| --- | --- | --- | --- | --- |
| C01 | `src/features/account/identity-changes/identity-form.tsx` | Identity edit, one instance | `IdentityFormApi` | Module-level official `withForm` field composition; actual account-derived defaults remain in the single owner. |
| C02 | `src/features/account/assisted-accounts/staff-accounts-form.tsx` | Creation and recovery, two instances | `StaffCreationFormApi`, `RecoveryFormApi` | Module-level official `withForm` composition; creation and recovery retain their distinct single owning forms and runtime defaults. |
| C02 | `src/features/account/security/security-form-views.tsx` | Password change and confirmation, two instances | None | KEEP legitimate local `useAppForm`; native password/confirmation and assisted journeys verify this family without inventing an alias migration. |
| C03 | `src/features/account/applications/applicant-form.tsx` | Applicant edit, one instance | `ApplicantEditFormApi` | Module-level official `withForm` edit/panel composition; the single owner keeps actual application-derived defaults and frozen reviews. |
| C03 | `src/features/account/applications/application-form.tsx` | Anonymous application, one instance | None | KEEP legitimate local `useAppForm`; verify its distinct anonymous contract through the existing native application journeys. |
| C04 | `src/features/account/deletion/deletion-form.tsx` | Deletion confirmation, one instance | `DeletionFormApi` | Module-level official `withForm` confirmation/view composition; the existing single owner retains actual defaults, warning, confirmation, dirty/focus and explicit submission. |
| C04 | `src/features/account/decisions/decision-review.tsx` | Staff decision, one instance | None | KEEP legitimate local `useAppForm`; native frozen rejection/private-note and explicit final submission verify this family. |
| C04 | `src/features/account/restrictions/restrictions-form.tsx` | Native controlled form | None | KEEP native controlled form; no `useAppForm` or obsolete alias to replace. Native independent-restriction review/cancel/password/submit verifies its existing contract. |
| C01 / unchanged consumer | `src/features/auth/sign-in-form.tsx` | Sign-in, one instance | None | Preserve existing `useAppForm` and include genuine sign-in qualification. |
| C05 | `src/components/ui/app-form.tsx` | Shared hook/context owner | `AppFormApi` and library generic imports | Export the existing library's `withForm` alongside `useAppForm`; retain compatibility only until C02–C04 finish, then remove it. |

Identity's `formOptions` supplies the existing value shape to the library's public inference. The placeholder defaults are type hints for composition; `formValues(account)` always supplies the real initial values to the single `useAppForm` instance. Both field components are declared at module scope, and no new field-group or form instance is introduced. Validation, subscriptions, raw values, frozen review values, dirty/discard, reconciliation and explicit submission remain at their existing owners.

`tests/ui/form-composition.test.tsx` exercises public composed-field rendering and canonical wrong-field/value typing. That SSR seam does not establish browser interactions; the existing Identity and sign-in native journeys supply the corresponding boundary evidence. WebKit, full qualification and separate owner acceptance retain their own receipts.
