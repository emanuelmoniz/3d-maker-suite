ALTER TABLE `project_slice_plates` ADD `slicer_integration_id` text REFERENCES integrations(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `project_slice_plates` ADD `sliced_integration_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `slicer_integration_id` text REFERENCES integrations(id) ON DELETE set null;