DROP TRIGGER role_change_operation_immutable_update;--> statement-breakpoint
DROP TRIGGER role_change_operation_immutable_delete;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_role_change_operation` (
	`action` text,
	`actor_user_id` text NOT NULL,
	`aggregate_result` text,
	`authority_kind` text,
	`command_family` text DEFAULT 'single' NOT NULL,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`operation_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`resulting_global_role` text,
	`role` text,
	`scope_id` text,
	`scope_name` text,
	`target_user_id` text,
	CONSTRAINT "role_change_operation_authority_kind_check" CHECK("authority_kind" is null or ("authority_kind" = 'department_manager' and "command_family" in ('single', 'program_grants') and "role" is not null and "role" = 'program_leader')),
	CONSTRAINT "role_change_operation_shape_check" CHECK((
        "command_family" = 'single' and "aggregate_result" is null
        and "target_user_id" is not null
        and "action" is not null and "action" in ('granted', 'withdrawn')
        and "role" is not null and "role" in ('admin', 'department_manager', 'program_leader', 'role_assigner', 'staff')
        and "scope_id" is not null and "scope_name" is not null
        and (("role" in ('staff', 'admin') and "resulting_global_role" is not null and "resulting_global_role" in ('member', 'staff', 'admin'))
          or ("role" not in ('staff', 'admin') and "resulting_global_role" is null))
      ) or (
        "command_family" = 'person_scoped' and "aggregate_result" is not null
        and "target_user_id" is not null
        and json_valid("aggregate_result")
        and "action" is null and "role" is null
        and "scope_id" is null and "scope_name" is null
        and "resulting_global_role" is null
      ) or (
        "command_family" = 'program_grants' and "target_user_id" is null
        and "authority_kind" is not null and "authority_kind" = 'department_manager'
        and "action" is not null and "action" = 'granted'
        and "role" is not null and "role" = 'program_leader'
        and "scope_id" is not null and "scope_name" is not null
        and "resulting_global_role" is null and "aggregate_result" is not null
        and json_valid("aggregate_result") and json_type("aggregate_result") = 'array'
        and json_array_length("aggregate_result") between 1 and 7
      ))
);
--> statement-breakpoint
INSERT INTO `__new_role_change_operation`("action", "actor_user_id", "aggregate_result", "authority_kind", "command_family", "created_at", "id", "operation_key", "request_hash", "resulting_global_role", "role", "scope_id", "scope_name", "target_user_id") SELECT "action", "actor_user_id", "aggregate_result", "authority_kind", "command_family", "created_at", "id", "operation_key", "request_hash", "resulting_global_role", "role", "scope_id", "scope_name", "target_user_id" FROM `role_change_operation`;--> statement-breakpoint
DROP TABLE `role_change_operation`;--> statement-breakpoint
ALTER TABLE `__new_role_change_operation` RENAME TO `role_change_operation`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `role_change_operation_key_unique` ON `role_change_operation` (`actor_user_id`,`operation_key`);--> statement-breakpoint
CREATE INDEX `role_change_operation_target_idx` ON `role_change_operation` (`target_user_id`);
--> statement-breakpoint
CREATE TRIGGER role_change_operation_immutable_update
BEFORE UPDATE ON role_change_operation
BEGIN SELECT RAISE(ABORT, 'Role change receipts are immutable'); END;--> statement-breakpoint
CREATE TRIGGER role_change_operation_immutable_delete
BEFORE DELETE ON role_change_operation
BEGIN SELECT RAISE(ABORT, 'Role change receipts are retained'); END;