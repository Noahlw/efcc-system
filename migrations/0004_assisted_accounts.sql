CREATE TABLE `staff_account_operation` (
	`action` text NOT NULL,
	`actor_credential_revision` integer NOT NULL,
	`actor_session_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`confirmation_operation_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`identity_check` text NOT NULL,
	`operation_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`target_credential_revision` integer NOT NULL,
	`target_user_id` text NOT NULL,
	CONSTRAINT "staff_account_operation_action_check" CHECK("action" in ('assisted_account_created','staff_password_reset','temporary_password_reissued')),
	CONSTRAINT "staff_account_operation_identity_check" CHECK("identity_check" in ('face_to_face','verified_phone'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_account_operation_key_unique` ON `staff_account_operation` (`actor_user_id`,`operation_key`);--> statement-breakpoint
CREATE INDEX `staff_account_operation_target_idx` ON `staff_account_operation` (`target_user_id`);--> statement-breakpoint
DROP INDEX `person_profile_phone_unique`;--> statement-breakpoint
ALTER TABLE `person_profile` ADD `phone_shared` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `person_profile` ADD `verified_recovery_phone` text;--> statement-breakpoint
CREATE INDEX `person_profile_phone_idx` ON `person_profile` (`phone`);--> statement-breakpoint
ALTER TABLE `account` ADD `temporary_password_expires_at` integer;
--> statement-breakpoint
-- Public/non-exception contact changes still reject every occupied phone.
CREATE TRIGGER person_profile_requires_unique_phone_insert
BEFORE INSERT ON person_profile
WHEN NEW.phone IS NOT NULL AND NEW.phone_shared=0
 AND EXISTS(SELECT 1 FROM person_profile WHERE phone=NEW.phone)
BEGIN SELECT RAISE(ABORT, 'Phone is already used'); END;
--> statement-breakpoint
CREATE TRIGGER person_profile_requires_unique_phone_update
BEFORE UPDATE OF phone,phone_shared ON person_profile
WHEN NEW.phone IS NOT NULL AND NEW.phone_shared=0
 AND EXISTS(SELECT 1 FROM person_profile WHERE phone=NEW.phone AND user_id<>NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'Phone is already used'); END;
--> statement-breakpoint
-- Never mint a native session for an expired temporary password, including
-- the small gap between the native pre-insert hook and INSERT.
CREATE TRIGGER session_requires_unexpired_temporary_password
BEFORE INSERT ON session
WHEN EXISTS(SELECT 1 FROM account WHERE user_id=NEW.user_id AND account_id=NEW.user_id
 AND provider_id='credential' AND temporary_password_expires_at IS NOT NULL
 AND temporary_password_expires_at<=CAST(strftime('%s','now') AS INTEGER))
BEGIN SELECT RAISE(ABORT, 'Expired temporary credential'); END;
--> statement-breakpoint
CREATE TRIGGER staff_account_operation_requires_complete_write
BEFORE INSERT ON staff_account_operation
WHEN NEW.actor_user_id=NEW.target_user_id OR NOT EXISTS(
 SELECT 1 FROM session s INNER JOIN account a ON a.user_id=s.user_id
 INNER JOIN person_profile p ON p.user_id=s.user_id
 INNER JOIN account_security_operation o ON o.id=s.confirmation_operation_id
 WHERE s.id=NEW.actor_session_id AND s.user_id=NEW.actor_user_id
  AND a.account_id=s.user_id AND a.provider_id='credential' AND a.password IS NOT NULL
  AND a.temporary_password_expires_at IS NULL
  AND s.expires_at>CAST(strftime('%s','now') AS INTEGER)
  AND a.credential_revision=NEW.actor_credential_revision
  AND s.credential_revision=a.credential_revision
  AND s.confirmation_operation_id=NEW.confirmation_operation_id
  AND o.user_id=s.user_id AND o.session_id=s.id AND o.action='password_confirmed'
  AND o.credential_revision=s.credential_revision AND s.password_confirmed_at=o.created_at
  AND s.password_confirmed_at<=CAST(strftime('%s','now') AS INTEGER)
  AND s.password_confirmed_at>CAST(strftime('%s','now') AS INTEGER)-600
  AND p.membership_status='active' AND p.banned_at IS NULL AND p.account_role IN ('staff','admin')
  AND (p.account_role='admin' OR EXISTS(SELECT 1 FROM person_profile target
   WHERE target.user_id=NEW.target_user_id AND target.account_role='member'))
) OR NOT EXISTS(
 SELECT 1 FROM user u INNER JOIN account a ON a.user_id=u.id
 INNER JOIN person_profile p ON p.user_id=u.id
 WHERE u.id=NEW.target_user_id AND a.account_id=u.id AND a.provider_id='credential'
  AND a.password IS NOT NULL AND a.credential_revision=NEW.target_credential_revision
  AND a.temporary_password_expires_at=NEW.created_at+604800
  AND EXISTS(SELECT 1 FROM username_reservation WHERE user_id=u.id AND username_key=u.username)
) OR NOT EXISTS(
 SELECT 1 FROM audit_event WHERE id=NEW.id AND action=NEW.action
  AND actor_user_id=NEW.actor_user_id AND target_user_id=NEW.target_user_id AND created_at=NEW.created_at
) OR (NEW.action IN ('staff_password_reset','temporary_password_reissued')
 AND EXISTS(SELECT 1 FROM session WHERE user_id=NEW.target_user_id)
) OR (NEW.action='assisted_account_created' AND (
 NEW.identity_check<>'face_to_face' OR NEW.target_credential_revision<>0
 OR NOT EXISTS(SELECT 1 FROM person_profile WHERE user_id=NEW.target_user_id
  AND membership_status='active' AND banned_at IS NULL AND account_role='member'
  AND name_lookup_key IS NOT NULL AND phone IS NOT NULL)
))
BEGIN SELECT RAISE(ABORT, 'Incomplete Staff credential operation'); END;
--> statement-breakpoint
CREATE TRIGGER staff_account_operation_immutable_update
BEFORE UPDATE ON staff_account_operation
BEGIN SELECT RAISE(ABORT, 'Staff account operations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER staff_account_operation_immutable_delete
BEFORE DELETE ON staff_account_operation
BEGIN SELECT RAISE(ABORT, 'Staff account operations are retained'); END;

--> statement-breakpoint
CREATE TRIGGER account_security_operation_requires_completed_password_change
BEFORE INSERT ON account_security_operation
WHEN EXISTS(SELECT 1 FROM account WHERE user_id=NEW.user_id AND account_id=NEW.user_id
 AND provider_id='credential' AND temporary_password_expires_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Temporary password change is required'); END;
