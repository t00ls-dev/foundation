CREATE TABLE `bookmark` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`description` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "bookmark_tags_array" CHECK(json_valid("bookmark"."tags") AND json_type("bookmark"."tags") = 'array')
);
--> statement-breakpoint
CREATE INDEX `bookmark_user_created_id_idx` ON `bookmark` (`user_id`,`created_at`,`id`);
