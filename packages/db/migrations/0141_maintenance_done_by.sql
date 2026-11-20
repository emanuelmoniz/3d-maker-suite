ALTER TABLE `maintenance_tasks` ADD `done_by` text REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `maintenance_tasks_done_by_idx` ON `maintenance_tasks` (`done_by`);