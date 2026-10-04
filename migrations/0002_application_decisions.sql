CREATE TABLE `application_decision` (
	`actor_user_id` text NOT NULL,
	`application_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`internal_note` text,
	`operation_key` text NOT NULL,
	`outcome` text NOT NULL,
	`request_hash` text NOT NULL,
	`target_user_id` text NOT NULL,
	`visible_reason` text,
	CONSTRAINT "application_decision_outcome_check" CHECK("outcome" in ('approved', 'rejected')),
	CONSTRAINT "application_decision_reason_check" CHECK("outcome" <> 'rejected' or ("visible_reason" is not null and length(trim("visible_reason")) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_decision_application_unique` ON `application_decision` (`application_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_decision_operation_unique` ON `application_decision` (`actor_user_id`,`operation_key`);--> statement-breakpoint
CREATE INDEX `application_decision_target_idx` ON `application_decision` (`target_user_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_membership_application` (
	`created_at` integer NOT NULL,
	`decision_id` text,
	`group_note` text,
	`id` text PRIMARY KEY NOT NULL,
	`intent_note` text,
	`operation_key_hash` text NOT NULL,
	`referral_note` text,
	`request_hash` text NOT NULL,
	`status` text NOT NULL,
	`user_id` text NOT NULL,
	CONSTRAINT "membership_application_status_check" CHECK("status" in ('pending', 'approved', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
INSERT INTO `__new_membership_application`("created_at", "decision_id", "group_note", "id", "intent_note", "operation_key_hash", "referral_note", "request_hash", "status", "user_id") SELECT "created_at", NULL, "group_note", "id", "intent_note", "operation_key_hash", "referral_note", "request_hash", "status", "user_id" FROM `membership_application`;--> statement-breakpoint
DROP TABLE `membership_application`;--> statement-breakpoint
ALTER TABLE `__new_membership_application` RENAME TO `membership_application`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `membership_application_operation_key_hash_unique` ON `membership_application` (`operation_key_hash`);--> statement-breakpoint
CREATE INDEX `membership_application_user_id_idx` ON `membership_application` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_person_profile` (
	`account_role` text DEFAULT 'member' NOT NULL,
	`banned_at` integer,
	`created_at` integer NOT NULL,
	`membership_status` text NOT NULL,
	`name_lookup_key` text,
	`phone` text,
	`updated_at` integer NOT NULL,
	`user_id` text PRIMARY KEY NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "person_profile_account_role_check" CHECK("account_role" in ('member', 'staff', 'admin')),
	CONSTRAINT "person_profile_membership_status_check" CHECK("membership_status" in ('pending', 'active', 'deactivated'))
);
--> statement-breakpoint
INSERT INTO `__new_person_profile`("account_role", "banned_at", "created_at", "membership_status", "name_lookup_key", "phone", "updated_at", "user_id") SELECT 'member', "banned_at", "created_at", "membership_status", "name_lookup_key", "phone", "updated_at", "user_id" FROM `person_profile`;--> statement-breakpoint
DROP TABLE `person_profile`;--> statement-breakpoint
ALTER TABLE `__new_person_profile` RENAME TO `person_profile`;--> statement-breakpoint
CREATE INDEX `person_profile_membership_status_idx` ON `person_profile` (`membership_status`);--> statement-breakpoint
CREATE INDEX `person_profile_name_lookup_key_idx` ON `person_profile` (`name_lookup_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `person_profile_phone_unique` ON `person_profile` (`phone`);
--> statement-breakpoint
-- Rebuilding the application table removes its original creation guard.
CREATE TRIGGER `membership_application_requires_complete_account`
BEFORE INSERT ON `membership_application`
WHEN NOT EXISTS (
	SELECT 1 FROM `user` WHERE `id` = NEW.`user_id`
) OR NOT EXISTS (
	SELECT 1 FROM `account`
	WHERE `user_id` = NEW.`user_id`
		AND `provider_id` = 'credential'
		AND `password` IS NOT NULL
) OR NOT EXISTS (
	SELECT 1 FROM `person_profile`
	WHERE `user_id` = NEW.`user_id`
		AND `membership_status` = 'pending'
		AND `phone` IS NOT NULL
) OR NOT EXISTS (
	SELECT 1 FROM `username_reservation`
	WHERE `username_key` = (SELECT lower(`username`) FROM `user` WHERE `id` = NEW.`user_id`)
		AND `user_id` = NEW.`user_id`
) OR NOT EXISTS (
	SELECT 1 FROM `audit_event`
	WHERE `actor_user_id` = NEW.`user_id`
		AND `target_user_id` = NEW.`user_id`
		AND `action` = 'self_application_created'
)
BEGIN
	SELECT RAISE(ABORT, 'Incomplete self-application write');
END;
--> statement-breakpoint
-- The receipt is the last batch write: earlier ignored/failed effects cannot commit.
CREATE TRIGGER `application_decision_requires_complete_write`
BEFORE INSERT ON `application_decision`
WHEN NOT EXISTS (
	SELECT 1 FROM `membership_application`
	WHERE `id` = NEW.`application_id` AND `decision_id` = NEW.`id`
		AND `user_id` = NEW.`target_user_id` AND `status` = NEW.`outcome`
) OR NOT EXISTS (
	SELECT 1 FROM `person_profile`
	WHERE `user_id` = NEW.`target_user_id`
		AND `membership_status` = CASE NEW.`outcome` WHEN 'approved' THEN 'active' ELSE 'pending' END
) OR NOT EXISTS (
	SELECT 1 FROM `audit_event`
	WHERE `id` = NEW.`id` AND `actor_user_id` = NEW.`actor_user_id`
		AND `target_user_id` = NEW.`target_user_id`
		AND `action` = 'application_' || NEW.`outcome`
		AND `created_at` = NEW.`created_at`
)
BEGIN
	SELECT RAISE(ABORT, 'Incomplete application decision');
END;
--> statement-breakpoint
CREATE TRIGGER `application_decision_immutable_update`
BEFORE UPDATE ON `application_decision`
BEGIN
	SELECT RAISE(ABORT, 'Application decisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `application_decision_immutable_delete`
BEFORE DELETE ON `application_decision`
BEGIN
	SELECT RAISE(ABORT, 'Application decisions are retained');
END;
--> statement-breakpoint
CREATE TRIGGER `membership_application_terminal_state_immutable`
BEFORE UPDATE OF `status`, `decision_id` ON `membership_application`
WHEN OLD.`status` <> 'pending'
	AND (NEW.`status` IS NOT OLD.`status` OR NEW.`decision_id` IS NOT OLD.`decision_id`)
BEGIN
	SELECT RAISE(ABORT, 'Completed application transitions are retained');
END;