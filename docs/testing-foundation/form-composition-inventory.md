# Official form composition migration inventory

Authority: #94 W07.C01–C05. Baseline `fced6c3ee4accefee51a71b673bea025f9f5bca7`, tree `dfb16f372b3e584a30a2033c6f8524a9700917f9`; current candidate and qualification receipts are linked from #94. This inventory records actual production owners, not a new workflow abstraction.

The baseline has five consumer aliases in four files plus the shared `AppFormApi` definition. Eight production modules contain ten `useAppForm` calls. Before C05, rescan production source for additions, renames, removed paths and remaining legacy imports; this table alone does not prove closure.

| Checkpoint | Production owner | Form instances | Baseline legacy surface | Current disposition |
| --- | --- | --- | --- | --- |
| C01 | `src/features/account/identity-changes/identity-form.tsx` | Identity edit, one instance | `IdentityFormApi` | Module-level official `withForm` field composition; actual account-derived defaults remain in the single owner. |
| C02 | `src/features/account/assisted-accounts/staff-accounts-form.tsx` | Creation and recovery, two instances | `StaffCreationFormApi`, `RecoveryFormApi` | Pending family migration. |
| C02 | `src/features/account/security/security-form-views.tsx` | Password change and confirmation, two instances | None | Retain legitimate local `useAppForm`; inspect and verify the family without inventing an alias migration. |
| C03 | `src/features/account/applications/applicant-form.tsx` | Applicant edit, one instance | `ApplicantEditFormApi` | Pending family migration. |
| C03 | `src/features/account/applications/application-form.tsx` | Anonymous application, one instance | None | Retain legitimate local `useAppForm`; verify its distinct anonymous contract. |
| C04 | `src/features/account/deletion/deletion-form.tsx` | Deletion confirmation, one instance | `DeletionFormApi` | Pending family migration. |
| C04 | `src/features/account/decisions/decision-review.tsx` | Staff decision, one instance | None | Retain legitimate local `useAppForm`; inspect native confirmation behavior. |
| C04 | `src/features/account/restrictions/restrictions-form.tsx` | Native controlled form | None | Inspect as KEEP during the destructive-action family; no `useAppForm` or obsolete alias to replace. |
| C01 / unchanged consumer | `src/features/auth/sign-in-form.tsx` | Sign-in, one instance | None | Preserve existing `useAppForm` and include genuine sign-in qualification. |
| C05 | `src/components/ui/app-form.tsx` | Shared hook/context owner | `AppFormApi` and library generic imports | Export the existing library's `withForm` alongside `useAppForm`; retain compatibility only until C02–C04 finish, then remove it. |

Identity's `formOptions` supplies the existing value shape to the library's public inference. The placeholder defaults are type hints for composition; `formValues(account)` always supplies the real initial values to the single `useAppForm` instance. Both field components are declared at module scope, and no new field-group or form instance is introduced. Validation, subscriptions, raw values, frozen review values, dirty/discard, reconciliation and explicit submission remain at their existing owners.

`tests/ui/form-composition.test.tsx` exercises public composed-field rendering and canonical wrong-field/value typing. That SSR seam does not establish browser interactions; the existing Identity and sign-in native journeys supply the corresponding boundary evidence. WebKit, full qualification and separate owner acceptance retain their own receipts.
