ALTER TABLE `person_profile` ADD `name_lookup_key` text;--> statement-breakpoint
CREATE INDEX `person_profile_name_lookup_key_idx` ON `person_profile` (`name_lookup_key`);