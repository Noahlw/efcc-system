CREATE TABLE `business_rate_limit` (
	`count` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_rate_limit_key_unique` ON `business_rate_limit` (`key`);
--> statement-breakpoint
INSERT INTO `business_rate_limit` (`count`, `id`, `key`, `last_request`)
SELECT `count`, `id`, `key`, `last_request`
FROM `rate_limit`
WHERE `key` GLOB 'application:*';
