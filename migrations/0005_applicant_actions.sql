CREATE TABLE `applicant_operation` (
	`action` text NOT NULL,
	`application_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`operation_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`user_id` text NOT NULL,
	CONSTRAINT "applicant_operation_action_check" CHECK(action in ('application_corrected','application_withdrawn','application_resubmitted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applicant_operation_key_unique` ON `applicant_operation` (`user_id`,`operation_key`);--> statement-breakpoint
CREATE INDEX `applicant_operation_user_idx` ON `applicant_operation` (`user_id`);--> statement-breakpoint
CREATE TRIGGER applicant_operation_immutable_update
BEFORE UPDATE ON applicant_operation
BEGIN SELECT RAISE(ABORT, 'Applicant operations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER applicant_operation_immutable_delete
BEFORE DELETE ON applicant_operation
BEGIN SELECT RAISE(ABORT, 'Applicant operations are retained'); END;
