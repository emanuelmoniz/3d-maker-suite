ALTER TABLE `integrations` ADD `preset_receive` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `integrations` ADD `preset_install` text;--> statement-breakpoint
ALTER TABLE `integrations` ADD `preset_state` text;