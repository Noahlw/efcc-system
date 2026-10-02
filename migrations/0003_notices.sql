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
	`title` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notice_scope_idx` ON `notice` (`scope_type`,`scope_id`);