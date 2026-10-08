CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	`resolved_at` text,
	CONSTRAINT "alerts_kind_ck" CHECK("alerts"."kind" IN ('maintenance_due', 'spool_low', 'sync_failed', 'print_failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_open_uq` ON `alerts` (`kind`,`entity_type`,`entity_id`) WHERE "alerts"."resolved_at" IS NULL;--> statement-breakpoint
CREATE TABLE `collection_projects` (
	`collection_id` text NOT NULL,
	`project_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`collection_id`, `project_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `filament_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`brand` text NOT NULL,
	`material` text NOT NULL,
	`name` text NOT NULL,
	`color_hex` text NOT NULL,
	`diameter_mm` real DEFAULT 1.75 NOT NULL,
	`density_gcm3` real NOT NULL,
	`price_per_kg` integer,
	`archived_at` text,
	`origin` text DEFAULT 'manual' NOT NULL,
	`integration_id` text,
	`external_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "filament_profiles_origin_ck" CHECK("filament_profiles"."origin" IN ('manual', 'integration'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `filament_profiles_external_uq` ON `filament_profiles` (`integration_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`adapter_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`secrets` text,
	`status` text DEFAULT 'new' NOT NULL,
	`last_sync_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `maintenance_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`printer_id` text NOT NULL,
	`type_id` text NOT NULL,
	`done_at` text NOT NULL,
	`printer_runtime_sec_at` integer NOT NULL,
	`printer_prints_at` integer NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`type_id`) REFERENCES `maintenance_types`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `maintenance_tasks_latest_idx` ON `maintenance_tasks` (`printer_id`,`type_id`,`done_at`);--> statement-breakpoint
CREATE TABLE `maintenance_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`interval_sec` integer,
	`interval_prints` integer,
	`interval_days` integer,
	`applies_to_model` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `print_filament_usages` (
	`id` text PRIMARY KEY NOT NULL,
	`print_id` text NOT NULL,
	`spool_id` text,
	`profile_id` text,
	`grams` real NOT NULL,
	`slot` integer,
	FOREIGN KEY (`print_id`) REFERENCES `prints`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`spool_id`) REFERENCES `spools`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`profile_id`) REFERENCES `filament_profiles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `print_filament_usages_print_idx` ON `print_filament_usages` (`print_id`);--> statement-breakpoint
CREATE INDEX `print_filament_usages_spool_idx` ON `print_filament_usages` (`spool_id`);--> statement-breakpoint
CREATE INDEX `print_filament_usages_profile_idx` ON `print_filament_usages` (`profile_id`);--> statement-breakpoint
CREATE TABLE `printers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`brand` text NOT NULL,
	`model` text NOT NULL,
	`serial` text,
	`nozzle_diameter_mm` real DEFAULT 0.4 NOT NULL,
	`runtime_offset_sec` integer DEFAULT 0 NOT NULL,
	`prints_offset` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`origin` text DEFAULT 'manual' NOT NULL,
	`integration_id` text,
	`external_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "printers_origin_ck" CHECK("printers"."origin" IN ('manual', 'integration'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `printers_external_uq` ON `printers` (`integration_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `prints` (
	`id` text PRIMARY KEY NOT NULL,
	`printer_id` text NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`plate` integer,
	`started_at` text NOT NULL,
	`duration_sec` integer,
	`outcome` text NOT NULL,
	`failure_reason` text,
	`notes` text,
	`energy_wh` real,
	`energy_source` text,
	`cost_snapshot` text,
	`origin` text DEFAULT 'manual' NOT NULL,
	`integration_id` text,
	`external_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "prints_origin_ck" CHECK("prints"."origin" IN ('manual', 'integration')),
	CONSTRAINT "prints_outcome_ck" CHECK("prints"."outcome" IN ('success', 'failed', 'cancelled')),
	CONSTRAINT "prints_failure_reason_ck" CHECK("prints"."outcome" <> 'success' OR "prints"."failure_reason" IS NULL),
	CONSTRAINT "prints_energy_source_ck" CHECK("prints"."energy_source" IN ('estimated', 'measured')),
	CONSTRAINT "prints_energy_pair_ck" CHECK(("prints"."energy_wh" IS NULL) = ("prints"."energy_source" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `prints_started_idx` ON `prints` (`started_at`);--> statement-breakpoint
CREATE INDEX `prints_printer_started_idx` ON `prints` (`printer_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `prints_project_idx` ON `prints` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `prints_external_uq` ON `prints` (`integration_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`file_path` text,
	`source_url` text,
	`thumbnail_path` text,
	`meta` text DEFAULT '{}' NOT NULL,
	`archived_at` text,
	`origin` text DEFAULT 'manual' NOT NULL,
	`integration_id` text,
	`external_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "projects_origin_ck" CHECK("projects"."origin" IN ('manual', 'integration'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_external_uq` ON `projects` (`integration_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spools` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`initial_grams` real NOT NULL,
	`remaining_grams` real NOT NULL,
	`price_paid` integer,
	`purchased_at` text,
	`opened_at` text,
	`location` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `filament_profiles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `spools_profile_idx` ON `spools` (`profile_id`);--> statement-breakpoint
CREATE TABLE `taggings` (
	`tag_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	PRIMARY KEY(`tag_id`, `entity_type`, `entity_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "taggings_entity_type_ck" CHECK("taggings"."entity_type" IN ('project', 'print', 'spool'))
);
--> statement-breakpoint
CREATE INDEX `taggings_entity_idx` ON `taggings` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_uq` ON `tags` ("name" COLLATE NOCASE);