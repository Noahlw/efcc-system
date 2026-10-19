# Separate authentication from EFCC business access

Accepted during the Slice 1 foundation grilling on 1 October 2026 (Q5). [The confirmed understanding](https://github.com/Noahlw/efcc-system/issues/1) allows pending, banned and deactivated accounts to authenticate while restricting them to a status view. Better Auth owns credentials and sessions; EFCC owns membership status and security restrictions, checked on every server request before business data or actions are authorised.

The Better Auth Admin plugin's default `banned` behaviour refuses sign-in, so it cannot directly represent EFCC's security-ban policy. Keep the domain restriction separate rather than overriding credential verification to force a status-page session. Slice 1 proves this boundary with synthetic accounts and a minimal status page; account-management operations remain in Slice 2.

Context7 research: [Better Auth Admin plugin](https://www.better-auth.com/docs/plugins/admin) and [session management](https://www.better-auth.com/docs/concepts/session-management). This records the selected design, not a completed Worker/D1 proof or approval to implement.

## Planned foundation refinement

The foundation planning interview accepted a neutral credential-proof capability without `passwordHash`; password verification retains the private verification material it needs. Applicant, Identity and Staff consumers receive only their required session, revision, confirmation and temporary-password state. Existing session expiry, ten-minute confirmation and independent SQL-time authority checks remain unchanged. This refinement is accepted design with implementation pending.

## Owner-approved restricted-account correction (20 October 2026)

The later [CR-02.P1–P4 decisions and CR-09 v2.1](https://github.com/Noahlw/efcc-system/issues/106) refine the original status-only policy. Security-banned actors retain Status/native Sign-out and the necessary authentication exchange; no own Security/business/contact/history reads or writes, including receipt recovery, are allowed while Banned. Ban takes precedence over a temporary-password requirement. The native restricted User projection retains only the principal ID, and the Session projection retains minimal identity/expiry; neither returns contact or tracking data. Existing native authentication metadata/cookies keep their own transport contract.

Nonbanned Deactivated actors may use the existing `/account` in Server-controlled Security-only mode: current-password change, minimal Security state and revoking other Sessions with the existing current-Session/credential-bound ten-minute confirmation. Full contact/business readers do not run for this mode. Completed Security receipts remain readable under current Session/permission checks after confirmation expiry; reading/replaying a receipt never renews proof or performs effects again. Consumers use the actual Server deadline instead of browser receipt time plus ten minutes. Active own-Security actions gain no new global confirmation requirement.

Ordinary Staff/Admin mutation owners reject another current Admin for Identity, Reset/Reissue, Ban/Unban, Deactivate/Reactivate and Delete, at both Server and atomic D1 boundaries. Lawful Admin read/discovery remains separate. Last-effective-Admin and retained-history database defenses remain in force. No Admin recovery, Operator endpoint, separate Lock or Roles feature is introduced.

This records policy and implementation ownership; exact-source qualification, independent review and separate Owner acceptance remain in #106. S1's later Ban/deletion/verified-recovery safeguards remain a separate source-blocked pre-production track.
