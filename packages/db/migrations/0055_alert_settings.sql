ALTER TABLE `maintenance_types` ADD `warn_lead_days` integer;--> statement-breakpoint
ALTER TABLE `maintenance_types` ADD `warn_lead_hours` integer;--> statement-breakpoint
ALTER TABLE `maintenance_types` ADD `warn_lead_prints` integer;--> statement-breakpoint
ALTER TABLE `maintenance_types` ADD `warn_enabled` integer;--> statement-breakpoint
ALTER TABLE `maintenance_types` ADD `error_enabled` integer;--> statement-breakpoint
ALTER TABLE `spools` ADD `low_grams` real;--> statement-breakpoint
ALTER TABLE `spools` ADD `low_alert` integer;--> statement-breakpoint
ALTER TABLE `sync_policies` ADD `alert_severities` text;