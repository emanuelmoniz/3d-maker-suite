CREATE TABLE `import_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`type` text NOT NULL,
	`file_name` text,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`skipped` integer NOT NULL,
	`invalid` integer NOT NULL,
	`errors` text,
	`backup` text,
	`created_at` text NOT NULL,
	CONSTRAINT "import_runs_source_ck" CHECK("import_runs"."source" IN ('file', 'zip', 'integration'))
);
