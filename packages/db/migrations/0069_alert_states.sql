CREATE TABLE `alert_states` (
	`alert_id` text NOT NULL,
	`user_id` text NOT NULL,
	`read_at` text,
	`snoozed_until` text,
	`dismissed_at` text,
	`updated_at` text,
	PRIMARY KEY(`alert_id`, `user_id`),
	FOREIGN KEY (`alert_id`) REFERENCES `alerts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alert_states_user_idx` ON `alert_states` (`user_id`);