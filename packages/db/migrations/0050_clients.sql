CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mobile` text NOT NULL,
	`vat` text,
	`email` text,
	`address` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_vat_uq` ON `clients` (`vat`) WHERE "clients"."vat" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `clients_mobile_uq` ON `clients` (`mobile`);--> statement-breakpoint
CREATE UNIQUE INDEX `clients_email_uq` ON `clients` ("email" COLLATE NOCASE) WHERE "clients"."email" IS NOT NULL;