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
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
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
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
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
CREATE INDEX `program_event_starts_at_idx` ON `program_event` (`starts_at`);