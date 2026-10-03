CREATE TABLE `department` (
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `enrolment` (
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `program`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "enrolment_status_check" CHECK("status" in ('pending', 'waitlisted', 'approved', 'rejected', 'withdrawn', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `enrolment_user_id_idx` ON `enrolment` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `enrolment_program_user_unique` ON `enrolment` (`program_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `invitation` (
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`state` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `program`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "invitation_state_check" CHECK("state" in ('valid', 'revoked'))
);
--> statement-breakpoint
CREATE INDEX `invitation_user_id_idx` ON `invitation` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_program_user_unique` ON `invitation` (`program_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `program` (
	`created_at` integer NOT NULL,
	`department_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `program_department_id_idx` ON `program` (`department_id`);--> statement-breakpoint
CREATE TABLE `program_event` (
	`created_at` integer NOT NULL,
	`ends_at` integer,
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`title` text NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `program`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `program_event_program_id_idx` ON `program_event` (`program_id`);--> statement-breakpoint
CREATE INDEX `program_event_starts_at_idx` ON `program_event` (`starts_at`);--> statement-breakpoint
CREATE TABLE `account` (
	`access_token` text,
	`access_token_expires_at` integer,
	`account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`id_token` text,
	`password` text,
	`provider_id` text NOT NULL,
	`refresh_token` text,
	`refresh_token_expires_at` integer,
	`scope` text,
	`updated_at` integer NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`count` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);--> statement-breakpoint
CREATE TABLE `session` (
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`ip_address` text,
	`token` text NOT NULL,
	`updated_at` integer NOT NULL,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`created_at` integer NOT NULL,
	`display_username` text,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`image` text,
	`name` text NOT NULL,
	`updated_at` integer NOT NULL,
	`username` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);--> statement-breakpoint
CREATE TABLE `verification` (
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`updated_at` integer NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `person_profile` (
	`banned_at` integer,
	`created_at` integer NOT NULL,
	`membership_status` text NOT NULL,
	`name_lookup_key` text,
	`updated_at` integer NOT NULL,
	`user_id` text PRIMARY KEY NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "person_profile_membership_status_check" CHECK("membership_status" in ('pending', 'active', 'deactivated'))
);
--> statement-breakpoint
CREATE INDEX `person_profile_membership_status_idx` ON `person_profile` (`membership_status`);--> statement-breakpoint
CREATE INDEX `person_profile_name_lookup_key_idx` ON `person_profile` (`name_lookup_key`);--> statement-breakpoint
CREATE TABLE `department_manager_assignment` (
	`created_at` integer NOT NULL,
	`department_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `department_manager_assignment_user_id_idx` ON `department_manager_assignment` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `department_manager_assignment_unique` ON `department_manager_assignment` (`department_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `department_membership` (
	`created_at` integer NOT NULL,
	`department_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `department_membership_user_id_idx` ON `department_membership` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `department_membership_unique` ON `department_membership` (`department_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `notice` (
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`id` text PRIMARY KEY NOT NULL,
	`published_at` integer,
	`scope_id` text,
	`scope_type` text NOT NULL,
	`title` text NOT NULL,
	CONSTRAINT "notice_scope_type_check" CHECK("scope_type" in ('church', 'department', 'program')),
	CONSTRAINT "notice_scope_target_check" CHECK(("scope_type" = 'church' and "scope_id" is null) or ("scope_type" in ('department', 'program') and "scope_id" is not null and length("scope_id") > 0))
);
--> statement-breakpoint
CREATE INDEX `notice_scope_idx` ON `notice` (`scope_type`,`scope_id`);