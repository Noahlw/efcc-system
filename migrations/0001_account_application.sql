ALTER TABLE `person_profile` ADD `phone` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `person_profile_phone_unique` ON `person_profile` (`phone`);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_canonical_unique_idx` ON `user` (lower(trim(`email`)));
--> statement-breakpoint
CREATE TABLE `username_reservation` (
	`reserved_at` integer NOT NULL,
	`user_id` text NOT NULL,
	`username_key` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
INSERT INTO `username_reservation` (`username_key`, `user_id`, `reserved_at`)
SELECT lower(`username`), `id`, CAST(strftime('%s', 'now') AS INTEGER)
FROM `user`
WHERE `username` IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `user_reserve_username_after_insert`
AFTER INSERT ON `user`
WHEN NEW.`username` IS NOT NULL
BEGIN
	INSERT INTO `username_reservation` (`username_key`, `user_id`, `reserved_at`)
	VALUES (lower(NEW.`username`), NEW.`id`, CAST(strftime('%s', 'now') AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER `user_reserve_username_after_update`
AFTER UPDATE OF `username` ON `user`
WHEN NEW.`username` IS NOT NULL
	AND (OLD.`username` IS NULL OR lower(NEW.`username`) <> lower(OLD.`username`))
BEGIN
	INSERT INTO `username_reservation` (`username_key`, `user_id`, `reserved_at`)
	VALUES (lower(NEW.`username`), NEW.`id`, CAST(strftime('%s', 'now') AS INTEGER));
END;
--> statement-breakpoint
CREATE TABLE `membership_application` (
	`created_at` integer NOT NULL,
	`group_note` text,
	`id` text PRIMARY KEY NOT NULL,
	`intent_note` text,
	`operation_key_hash` text NOT NULL,
	`referral_note` text,
	`request_hash` text NOT NULL,
	`status` text NOT NULL,
	`user_id` text NOT NULL,
	CONSTRAINT `membership_application_status_check` CHECK("status" in ('pending', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
CREATE INDEX `membership_application_user_id_idx` ON `membership_application` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_application_operation_key_hash_unique` ON `membership_application` (`operation_key_hash`);
--> statement-breakpoint
CREATE TABLE `audit_event` (
	`action` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`target_user_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_event_target_user_id_idx` ON `audit_event` (`target_user_id`);
--> statement-breakpoint
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
