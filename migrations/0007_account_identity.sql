CREATE TABLE `account_change_operation` (
	`action` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`identity_check` text,
	`operation_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`target_user_id` text NOT NULL,
	CONSTRAINT "account_change_operation_action_check" CHECK(action in ('own_phone_changed','staff_identity_corrected','staff_shared_phone_corrected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_change_operation_key_unique` ON `account_change_operation` (`actor_user_id`,`operation_key`);--> statement-breakpoint
CREATE INDEX `account_change_operation_target_idx` ON `account_change_operation` (`target_user_id`);--> statement-breakpoint
CREATE TRIGGER account_change_operation_immutable_update
BEFORE UPDATE ON account_change_operation
BEGIN SELECT RAISE(ABORT, 'Account changes are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER account_change_operation_immutable_delete
BEFORE DELETE ON account_change_operation
BEGIN SELECT RAISE(ABORT, 'Account change history is retained'); END;
