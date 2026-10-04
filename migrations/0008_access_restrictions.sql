PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_account_change_operation` (
	`action` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`identity_check` text,
	`operation_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`target_user_id` text NOT NULL,
	CONSTRAINT "account_change_operation_action_check" CHECK(action in ('own_phone_changed', 'staff_identity_corrected', 'staff_shared_phone_corrected', 'account_banned', 'account_unbanned', 'membership_deactivated', 'membership_reactivated'))
);
--> statement-breakpoint
INSERT INTO `__new_account_change_operation`("action", "actor_user_id", "created_at", "id", "identity_check", "operation_key", "request_hash", "target_user_id") SELECT "action", "actor_user_id", "created_at", "id", "identity_check", "operation_key", "request_hash", "target_user_id" FROM `account_change_operation`;--> statement-breakpoint
DROP TABLE `account_change_operation`;--> statement-breakpoint
ALTER TABLE `__new_account_change_operation` RENAME TO `account_change_operation`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `account_change_operation_key_unique` ON `account_change_operation` (`actor_user_id`,`operation_key`);--> statement-breakpoint
CREATE INDEX `account_change_operation_target_idx` ON `account_change_operation` (`target_user_id`);--> statement-breakpoint
CREATE TRIGGER account_change_operation_immutable_update
BEFORE UPDATE ON account_change_operation
BEGIN SELECT RAISE(ABORT, 'Account changes are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER account_change_operation_immutable_delete
BEFORE DELETE ON account_change_operation
BEGIN SELECT RAISE(ABORT, 'Account change history is retained'); END;
--> statement-breakpoint
-- Effective administration is durable eligibility, never current login count.
CREATE TRIGGER person_profile_preserves_last_admin_update
BEFORE UPDATE OF account_role,membership_status,banned_at ON person_profile
WHEN OLD.account_role='admin' AND OLD.membership_status='active' AND OLD.banned_at IS NULL
 AND (NEW.account_role<>'admin' OR NEW.membership_status<>'active' OR NEW.banned_at IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM person_profile p INNER JOIN account a ON a.user_id=p.user_id AND a.account_id=p.user_id AND a.provider_id='credential'
  WHERE p.user_id<>OLD.user_id AND p.account_role='admin' AND p.membership_status='active' AND p.banned_at IS NULL AND a.password IS NOT NULL AND a.temporary_password_expires_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Last effective administrator'); END;
--> statement-breakpoint
CREATE TRIGGER person_profile_preserves_last_admin_delete
BEFORE DELETE ON person_profile
WHEN OLD.account_role='admin' AND OLD.membership_status='active' AND OLD.banned_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM person_profile p INNER JOIN account a ON a.user_id=p.user_id AND a.account_id=p.user_id AND a.provider_id='credential'
  WHERE p.user_id<>OLD.user_id AND p.account_role='admin' AND p.membership_status='active' AND p.banned_at IS NULL AND a.password IS NOT NULL AND a.temporary_password_expires_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Last effective administrator'); END;
--> statement-breakpoint
CREATE TRIGGER user_preserves_last_admin_delete
BEFORE DELETE ON user
WHEN EXISTS(SELECT 1 FROM person_profile WHERE user_id=OLD.id AND account_role='admin' AND membership_status='active' AND banned_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM person_profile p INNER JOIN account a ON a.user_id=p.user_id AND a.account_id=p.user_id AND a.provider_id='credential'
  WHERE p.user_id<>OLD.id AND p.account_role='admin' AND p.membership_status='active' AND p.banned_at IS NULL AND a.password IS NOT NULL AND a.temporary_password_expires_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Last effective administrator'); END;
