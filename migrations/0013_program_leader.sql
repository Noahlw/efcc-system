CREATE TABLE `program_leader_assignment` (
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `program`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `program_leader_assignment_user_id_idx` ON `program_leader_assignment` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `program_leader_assignment_unique` ON `program_leader_assignment` (`program_id`,`user_id`);
--> statement-breakpoint
DROP TRIGGER user_preserves_church_history_delete;
--> statement-breakpoint
DROP TRIGGER role_assignment_history_immutable_update;
--> statement-breakpoint
DROP TRIGGER role_assignment_history_immutable_delete;
--> statement-breakpoint
CREATE TABLE `__new_role_assignment_history` (
	`action` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`scope_id` text NOT NULL,
	`scope_name` text NOT NULL,
	`target_user_id` text NOT NULL,
	CONSTRAINT "role_assignment_history_action_check" CHECK("action" in ('granted', 'withdrawn')),
	CONSTRAINT "role_assignment_history_role_check" CHECK("role" in ('department_manager', 'program_leader'))
);
--> statement-breakpoint
INSERT INTO `__new_role_assignment_history`("action", "actor_user_id", "created_at", "id", "role", "scope_id", "scope_name", "target_user_id") SELECT "action", "actor_user_id", "created_at", "id", "role", "scope_id", "scope_name", "target_user_id" FROM `role_assignment_history`;
--> statement-breakpoint
DROP TABLE `role_assignment_history`;
--> statement-breakpoint
ALTER TABLE `__new_role_assignment_history` RENAME TO `role_assignment_history`;
--> statement-breakpoint
CREATE INDEX `role_assignment_history_recipient_idx` ON `role_assignment_history` (`target_user_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `role_assignment_history_scope_idx` ON `role_assignment_history` (`role`,`scope_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER role_assignment_history_immutable_update
BEFORE UPDATE ON role_assignment_history
BEGIN SELECT RAISE(ABORT, 'Role assignment history is retained'); END;
--> statement-breakpoint
CREATE TRIGGER role_assignment_history_immutable_delete
BEFORE DELETE ON role_assignment_history
BEGIN SELECT RAISE(ABORT, 'Role assignment history is retained'); END;
--> statement-breakpoint
DROP TRIGGER role_change_operation_immutable_update;
--> statement-breakpoint
DROP TRIGGER role_change_operation_immutable_delete;
--> statement-breakpoint
CREATE TABLE `__new_role_change_operation` (
	`action` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`operation_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`role` text NOT NULL,
	`scope_id` text NOT NULL,
	`scope_name` text NOT NULL,
	`target_user_id` text NOT NULL,
	CONSTRAINT "role_change_operation_action_check" CHECK("action" in ('granted', 'withdrawn')),
	CONSTRAINT "role_change_operation_role_check" CHECK("role" in ('department_manager', 'program_leader'))
);
--> statement-breakpoint
INSERT INTO `__new_role_change_operation`("action", "actor_user_id", "created_at", "id", "operation_key", "request_hash", "role", "scope_id", "scope_name", "target_user_id") SELECT "action", "actor_user_id", "created_at", "id", "operation_key", "request_hash", "role", "scope_id", "scope_name", "target_user_id" FROM `role_change_operation`;
--> statement-breakpoint
DROP TABLE `role_change_operation`;
--> statement-breakpoint
ALTER TABLE `__new_role_change_operation` RENAME TO `role_change_operation`;
--> statement-breakpoint
CREATE UNIQUE INDEX `role_change_operation_key_unique` ON `role_change_operation` (`actor_user_id`,`operation_key`);
--> statement-breakpoint
CREATE INDEX `role_change_operation_target_idx` ON `role_change_operation` (`target_user_id`);
--> statement-breakpoint
CREATE TRIGGER role_change_operation_immutable_update
BEFORE UPDATE ON role_change_operation
BEGIN SELECT RAISE(ABORT, 'Role change receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER role_change_operation_immutable_delete
BEFORE DELETE ON role_change_operation
BEGIN SELECT RAISE(ABORT, 'Role change receipts are retained'); END;
--> statement-breakpoint
CREATE TRIGGER user_preserves_church_history_delete
BEFORE DELETE ON user
WHEN EXISTS(SELECT 1 FROM enrolment WHERE user_id=OLD.id)
 OR EXISTS(SELECT 1 FROM invitation WHERE user_id=OLD.id)
 OR EXISTS(SELECT 1 FROM department_membership WHERE user_id=OLD.id)
 OR EXISTS(SELECT 1 FROM department_manager_assignment WHERE user_id=OLD.id)
 OR EXISTS(SELECT 1 FROM program_leader_assignment WHERE user_id=OLD.id)
 OR EXISTS(SELECT 1 FROM role_assignment_history WHERE target_user_id=OLD.id)
 OR EXISTS(SELECT 1 FROM person_profile WHERE user_id=OLD.id AND banned_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Church business history or Security Ban prevents deletion'); END;
