# Separate authentication from EFCC business access

Accepted during the Slice 1 foundation grilling on 1 October 2026 (Q5). [The confirmed understanding](https://github.com/Noahlw/efcc-system/issues/1) allows pending, banned and deactivated accounts to authenticate while restricting them to a status view. Better Auth owns credentials and sessions; EFCC owns membership status and security restrictions, checked on every server request before business data or actions are authorised.

The Better Auth Admin plugin's default `banned` behaviour refuses sign-in, so it cannot directly represent EFCC's security-ban policy. Keep the domain restriction separate rather than overriding credential verification to force a status-page session. Slice 1 proves this boundary with synthetic accounts and a minimal status page; account-management operations remain in Slice 2.

Context7 research: [Better Auth Admin plugin](https://www.better-auth.com/docs/plugins/admin) and [session management](https://www.better-auth.com/docs/concepts/session-management). This records the selected design, not a completed Worker/D1 proof or approval to implement.
