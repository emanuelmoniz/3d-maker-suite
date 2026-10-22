CREATE TABLE `logs` (
	`id` integer PRIMARY KEY NOT NULL,
	`time` text NOT NULL,
	`level` text NOT NULL,
	`module` text NOT NULL,
	`message` text NOT NULL,
	`detail` text,
	CONSTRAINT "logs_level_ck" CHECK("logs"."level" IN ('debug', 'info', 'success', 'warn', 'error'))
);
--> statement-breakpoint
CREATE INDEX `logs_time_idx` ON `logs` (`time`);