# EFCC System

The single-church context for accounts, membership and church activities. Definitions follow the [confirmed understanding](https://github.com/Noahlw/efcc-system/issues/1) and the [Access foundation specification](https://github.com/Noahlw/efcc-system/issues/8).

## Language

**Account**: The identity belonging to one person for signing in to EFCC System. An account's ability to authenticate is distinct from permission to use church-management functions. _Avoid_: Membership, member record

**Username**: An account's unique, permanently reserved sign-in identifier; differences in letter case do not create different usernames. Deleting an eligible account does not make its username available to another person. _Avoid_: Full Chinese name, email address

**Full Chinese name**: A person's full Chinese name, which may be shared by several accounts. A name shared by several accounts cannot identify which account should sign in; the person must use their username instead. _Avoid_: Username, unique account identifier

**Membership status**: The person's standing in the church's membership lifecycle, including pending approval and deactivation. Membership status is independent of a security ban. _Avoid_: Security ban, login status

**Security ban**: A restriction on an account's access to business functions. A banned account may sign in to see its status, and removing the ban does not reactivate a deactivated membership. _Avoid_: Membership deactivation, account lockout

**Department**: A church organisational unit containing Programs. Department membership is separate from Program enrolment. _Avoid_: Program, enrolment

**Program**: A church activity belonging to one Department. Enrolment, capacity and waitlist belong to the Program; its dated occurrences are Events. _Avoid_: Event, independent Activity entity

**Event**: A dated occurrence within a Program, with attendance recorded at Event level. It does not introduce a separate enrolment capacity. _Avoid_: Program

**Activity**: An umbrella term for Programs and Events, confirmed in the Slice 1 CEO review (Q22). It is not another independent domain entity. _Avoid_: Independent Activity table or module

**Enrolment**: A person's participation state in a Program. Pending and waitlisted enrolments are distinct from approved participation; Home may show them with their state clearly labelled, without implying confirmed Event participation (Q23). _Avoid_: Department membership, confirmed attendance
