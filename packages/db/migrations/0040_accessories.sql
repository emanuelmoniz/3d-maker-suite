CREATE TABLE `accessories` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`serial` text,
	`purchased_at` text,
	`purchase_price` integer,
	`warranty_ends_at` text,
	`warranty_notes` text,
	`state` text DEFAULT 'working' NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accessories_number_uq` ON `accessories` (`number`);--> statement-breakpoint
CREATE TABLE `accessory_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`accessory_id` text NOT NULL,
	`body` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`accessory_id`) REFERENCES `accessories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "accessory_comments_status_ck" CHECK("accessory_comments"."status" IN ('open', 'resolved'))
);
--> statement-breakpoint
CREATE INDEX `accessory_comments_accessory_idx` ON `accessory_comments` (`accessory_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `accessory_installs` (
	`id` text PRIMARY KEY NOT NULL,
	`accessory_id` text NOT NULL,
	`printer_id` text NOT NULL,
	`installed_at` text NOT NULL,
	`removed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`accessory_id`) REFERENCES `accessories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "accessory_installs_dates_ck" CHECK("accessory_installs"."removed_at" IS NULL OR "accessory_installs"."removed_at" >= "accessory_installs"."installed_at")
);
--> statement-breakpoint
CREATE INDEX `accessory_installs_accessory_idx` ON `accessory_installs` (`accessory_id`,`installed_at`);--> statement-breakpoint
CREATE INDEX `accessory_installs_printer_idx` ON `accessory_installs` (`printer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accessory_installs_open_uq` ON `accessory_installs` (`accessory_id`) WHERE "accessory_installs"."removed_at" IS NULL;