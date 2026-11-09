CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`preview` text NOT NULL,
	`scope` text DEFAULT 'full' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_active_idx` ON `api_keys` (`active`);--> statement-breakpoint
CREATE TABLE `request_log` (
	`id` text PRIMARY KEY NOT NULL,
	`key_id` text,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`status` integer NOT NULL,
	`ms` integer NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `request_log_at_idx` ON `request_log` (`at`);