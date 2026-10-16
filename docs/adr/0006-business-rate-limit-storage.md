# Separate business and native rate-limit storage

Status: accepted design from the foundation planning interview; implementation pending.

EFCC business quotas will own a separate table in the existing D1 database. Better Auth will retain its native `rate_limit` table. At baseline `272dddbc887e7c3343a61831f91833fb687047bc`, the two owners share storage despite different timestamp units and window semantics; native cleanup is not restricted to native keys. Separate storage isolates cleanup ownership as well as representation. Converting units alone leaves the lifecycles coupled.

Business quotas retain their existing per-action/IP keys, ten-request fixed sixty-second window and request-error precedence. Native authentication limits remain unchanged. An additive forward migration must preserve existing business keys, counts and fixed-window anchors, including exhausted buckets, without changing native authentication rows.

Foundation acceptance requires a populated upgrade rehearsal in a disposable D1 store with requests quiesced, followed by real business and native-auth checks for quota denial, expiry recovery and request-error precedence. Mixed-version, zero-downtime Worker rollout compatibility remains a separately authorised deployment decision.
