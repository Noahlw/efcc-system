CREATE TABLE `account_security_operation` (
	`action` text NOT NULL,
	`created_at` integer NOT NULL,
	`credential_revision` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`operation_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	CONSTRAINT "account_security_operation_action_check" CHECK("action" in ('password_changed', 'other_sessions_revoked', 'password_confirmed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_security_operation_key_unique` ON `account_security_operation` (`user_id`,`operation_key`);--> statement-breakpoint
CREATE INDEX `account_security_operation_user_idx` ON `account_security_operation` (`user_id`);--> statement-breakpoint
ALTER TABLE `account` ADD `credential_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `confirmation_operation_id` text;--> statement-breakpoint
ALTER TABLE `session` ADD `credential_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `password_confirmed_at` integer;
--> statement-breakpoint
-- Native sign-in carries the revision captured before password verification.
-- A credential change between verification and INSERT cannot issue an old-proof session.
CREATE TRIGGER `session_requires_current_credential_revision`
BEFORE INSERT ON `session`
WHEN NOT EXISTS (
	SELECT 1 FROM `account`
	WHERE `user_id` = NEW.`user_id` AND `account_id` = NEW.`user_id`
		AND `provider_id` = 'credential' AND `password` IS NOT NULL
		AND `credential_revision` = NEW.`credential_revision`
)
BEGIN
	SELECT RAISE(ABORT, 'Stale credential proof');
END;
--> statement-breakpoint
CREATE TRIGGER `session_revision_update_requires_current_credential`
BEFORE UPDATE OF `credential_revision` ON `session`
WHEN NOT EXISTS (
	SELECT 1 FROM `account`
	WHERE `user_id` = NEW.`user_id` AND `account_id` = NEW.`user_id`
		AND `provider_id` = 'credential' AND `password` IS NOT NULL
		AND `credential_revision` = NEW.`credential_revision`
)
BEGIN
	SELECT RAISE(ABORT, 'Stale credential proof');
END;
--> statement-breakpoint
-- The final receipt verifies every required effect, including ignored writes.
CREATE TRIGGER `account_security_operation_requires_complete_write`
BEFORE INSERT ON `account_security_operation`
WHEN NOT EXISTS (
	SELECT 1 FROM `session` s INNER JOIN `account` a ON a.`user_id` = s.`user_id`
	WHERE s.`id` = NEW.`session_id` AND s.`user_id` = NEW.`user_id`
		AND s.`expires_at` > CAST(strftime('%s', 'now') AS INTEGER)
		AND a.`provider_id` = 'credential' AND a.`account_id` = s.`user_id`
		AND a.`password` IS NOT NULL
		AND a.`credential_revision` = NEW.`credential_revision`
		AND s.`credential_revision` = NEW.`credential_revision`
) OR NOT EXISTS (
	SELECT 1 FROM `audit_event`
	WHERE `id` = NEW.`id` AND `actor_user_id` = NEW.`user_id`
		AND `target_user_id` = NEW.`user_id` AND `action` = NEW.`action`
		AND `created_at` = NEW.`created_at`
) OR (
	NEW.`action` IN ('password_changed', 'other_sessions_revoked')
	AND EXISTS (
		SELECT 1 FROM `session`
		WHERE `user_id` = NEW.`user_id` AND `id` <> NEW.`session_id`
	)
) OR (
	NEW.`action` = 'password_changed'
	AND EXISTS (
		SELECT 1 FROM `session`
		WHERE `id` = NEW.`session_id`
			AND (`password_confirmed_at` IS NOT NULL OR `confirmation_operation_id` IS NOT NULL)
	)
) OR (
	NEW.`action` = 'password_confirmed'
	AND NOT EXISTS (
		SELECT 1 FROM `session`
		WHERE `id` = NEW.`session_id` AND `confirmation_operation_id` = NEW.`id`
			AND `password_confirmed_at` = NEW.`created_at`
			AND `password_confirmed_at` <= CAST(strftime('%s', 'now') AS INTEGER)
			AND `password_confirmed_at` > CAST(strftime('%s', 'now') AS INTEGER) - 600
	)
)
BEGIN
	SELECT RAISE(ABORT, 'Incomplete account security operation');
END;
--> statement-breakpoint
CREATE TRIGGER `account_security_operation_immutable_update`
BEFORE UPDATE ON `account_security_operation`
BEGIN
	SELECT RAISE(ABORT, 'Account security operations are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `account_security_operation_immutable_delete`
BEFORE DELETE ON `account_security_operation`
BEGIN
	SELECT RAISE(ABORT, 'Account security operations are retained');
END;