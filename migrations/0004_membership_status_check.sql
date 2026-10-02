PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_person_profile` (
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
INSERT INTO `__new_person_profile`("banned_at", "created_at", "membership_status", "name_lookup_key", "updated_at", "user_id") SELECT "banned_at", "created_at", "membership_status", "name_lookup_key", "updated_at", "user_id" FROM `person_profile`;--> statement-breakpoint
DROP TABLE `person_profile`;--> statement-breakpoint
ALTER TABLE `__new_person_profile` RENAME TO `person_profile`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `person_profile_membership_status_idx` ON `person_profile` (`membership_status`);--> statement-breakpoint
CREATE INDEX `person_profile_name_lookup_key_idx` ON `person_profile` (`name_lookup_key`);