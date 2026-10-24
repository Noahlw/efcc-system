# Separate authentication from EFCC business access

Accepted during the Slice 1 foundation grilling on 1 October 2026 (Q5). [The confirmed understanding](https://github.com/Noahlw/efcc-system/issues/1#issuecomment-6346598567) allows pending, banned and deactivated accounts to authenticate while restricting them to a status view. Better Auth owns credentials and sessions; EFCC owns membership status and security restrictions, checked on every server request before business data or actions are authorised.

The Better Auth Admin plugin's default `banned` behaviour refuses sign-in, so it cannot directly represent EFCC's security-ban policy. Keep the domain restriction separate rather than overriding credential verification to force a status-page session. Slice 1 proves this boundary with synthetic accounts and a minimal status page; account-management operations remain in Slice 2.

Context7 research: [Better Auth Admin plugin](https://www.better-auth.com/docs/plugins/admin) and [session management](https://www.better-auth.com/docs/concepts/session-management). This records the selected design, not a completed Worker/D1 proof or approval to implement.

## Credential proof ownership

The foundation implements the accepted neutral credential-proof capability without `passwordHash`; password verification retains the private verification material it needs. Applicant, Identity and Staff consumers receive only their required session, revision, confirmation and temporary-password state. Existing session expiry, ten-minute confirmation and independent SQL-time authority checks remain at their respective owners. Current source-specific qualification is recorded in #92/#106; this ownership statement does not grant aggregate or Owner acceptance.

## Owner-approved restricted-account correction (20 October 2026)

The later [CR-02.P1–P4 decisions and CR-09 v2.1](https://github.com/Noahlw/efcc-system/issues/106) refine the original status-only policy. Security-banned actors retain Status/native Sign-out and the necessary authentication exchange; no own Security/business/contact/history reads or writes, including receipt recovery, are allowed while Banned. Ban takes precedence over a temporary-password requirement. The native restricted User projection retains only the principal ID, and the Session projection retains minimal identity/expiry; neither returns contact or tracking data. Existing native authentication metadata/cookies keep their own transport contract.

Nonbanned Deactivated actors may use the existing `/account` in Server-controlled Security-only mode: current-password change, minimal Security state and revoking other Sessions with the existing current-Session/credential-bound ten-minute confirmation. Full contact/business readers do not run for this mode. Completed Security receipts remain readable under current Session/permission checks after confirmation expiry; reading/replaying a receipt never renews proof or performs effects again. Consumers use the actual Server deadline instead of browser receipt time plus ten minutes. Active own-Security actions gain no new global confirmation requirement.

Ordinary Staff/Admin mutation owners reject another current Admin for Identity, Reset/Reissue, Ban/Unban, Deactivate/Reactivate and Delete, at both Server and atomic D1 boundaries. Lawful Admin read/discovery remains separate. Last-effective-Admin and retained-history database defenses remain in force. No Admin recovery, Operator endpoint, separate Lock or Roles feature is introduced.

This records policy and implementation ownership; exact-source qualification, independent review and separate Owner acceptance remain in #106. S1's later Ban/deletion/verified-recovery safeguards remain a separate source-blocked pre-production track.

## Staff-assisted Active membership

The [CR-03.2 Owner decision](https://github.com/Noahlw/efcc-system/issues/106#issuecomment-6268259363) confirms that authorized, identity-verified Staff approval within assisted creation directly creates an Active Member. This route needs neither a prior member register nor a second Pending application/approval. Self-service registration still creates Pending. Creation retains atomic identity/search/Audit/Receipt writes, fixed Member role, current Staff/Session/proof predicates, one-time private seven-day temporary-password issuance with the committed Server expiry, and mandatory first change. Active status does not waive Ban, credential or downstream attendance requirements.

After the operator acknowledges private handover, explicit completion can return to the originating account-management context or clear the task to create the next member. Both reuse the same compare-before-clear completion owner, discard private issuance/draft state and preserve UNKNOWN original keys. Failed local cleanup does not navigate or falsely report completion; lost display remains receipt-only with separately verified reissue. Current qualification and Owner acceptance remain recorded in #99/#106.
