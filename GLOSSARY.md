# EFCC System

The single-church context for accounts, membership and church activities. Definitions follow the [confirmed understanding](https://github.com/Noahlw/efcc-system/issues/1#issuecomment-6346598567) and the [Access foundation specification](https://github.com/Noahlw/efcc-system/issues/8).

## Language

**Account**: The identity belonging to one person for signing in to EFCC System. An account's ability to authenticate is distinct from permission to use church-management functions. _Avoid_: Membership, member record

**Username**: An account's unique, permanently reserved sign-in identifier; differences in letter case do not create different usernames. Deleting an eligible account does not make its username available to another person. _Avoid_: Full Chinese name, email address

**Full Chinese name**: A person's full Chinese name, which may be shared by several accounts. A name shared by several accounts cannot identify which account should sign in; the person must use their username instead. _Avoid_: Username, unique account identifier

**Membership status**: The person's standing in the church's membership lifecycle, including pending approval and deactivation. Membership status is independent of a security ban. _Avoid_: Security ban, login status

**Security ban**: A restriction that permits an account to sign in, view its status and sign out, while withholding its business and Security actions, history and receipts. It takes precedence over a Temporary password. Removing the ban does not reactivate a deactivated membership. _Avoid_: Membership deactivation, account lockout

**Security-only access**: The limited access retained by a Deactivated account that is not Security-banned: its necessary Security state, changing its own password and, after fresh password confirmation, revoking its other Sessions. It does not restore contact details, business history or business receipts. _Avoid_: Active membership, unrestricted account access

**Staff-assisted Active creation**: An authorized Staff member verifies the person's identity and approves Membership as part of creating their Member account. The account is Active immediately, with private Temporary-password handover and mandatory first password change; no second Pending application is required. Self-service registration retains its separate approval process. _Avoid_: Importing an old member register, automatic approval of self-service registration

**Temporary password**: A seven-day sign-in credential issued by permitted Staff for assisted account creation or recovery, which the holder must change before using business functions. It does not approve Membership status or remove a Security ban. _Avoid_: Permanent password, email-reset link

**Temporary-password expiry**: The deadline belonging to one particular issuance of a Temporary password; reissue establishes a new deadline for the new credential. A completed-operation receipt does not establish that the credential remains valid. _Avoid_: Receipt time, Membership expiry

**Credential handover**: The original Staff operator's private delivery of a newly issued Temporary password through the established verified channel. If its one-time display is lost, a receipt cannot reveal it again; another issuance requires explicit verification and reissue. _Avoid_: Receipt replay, automatic password retrieval

**Department**: A church organisational unit containing Programs. Department membership is separate from Program enrolment. _Avoid_: Program, enrolment

**Program**: A church activity belonging to one Department. Enrolment, capacity and waitlist belong to the Program; its dated occurrences are Events. _Avoid_: Event, independent Activity entity

**Event**: A dated occurrence within a Program, with attendance recorded at Event level. It does not introduce a separate enrolment capacity. _Avoid_: Program

**Activity**: An umbrella term for Programs and Events, confirmed in the Slice 1 CEO review (Q22). It is not another independent domain entity. _Avoid_: Independent Activity table or module

**Enrolment**: A person's participation state in a Program. Pending and waitlisted enrolments are distinct from approved participation; Home may show them with their state clearly labelled, without implying confirmed Event participation (Q23). _Avoid_: Department membership, confirmed attendance
