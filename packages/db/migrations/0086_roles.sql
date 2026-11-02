CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`built_in` text,
	`disabled` integer DEFAULT false NOT NULL,
	`permissions` text NOT NULL,
	`project_rights` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "roles_built_in_ck" CHECK("roles"."built_in" IN ('admin', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_name_uq` ON `roles` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE UNIQUE INDEX `roles_built_in_uq` ON `roles` (`built_in`);--> statement-breakpoint
ALTER TABLE `users` ADD `role_id` text REFERENCES roles(id);--> statement-breakpoint
ALTER TABLE `users` ADD `permissions` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `project_rights` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- ADR-0016: Admin has everything; Editor and Viewer get exactly the ADR-0012 rights (core's BUILT_IN_RIGHTS).
INSERT INTO `roles` (`id`, `name`, `built_in`, `disabled`, `permissions`, `project_rights`, `created_at`, `updated_at`) VALUES
	('00000000-0000-4000-8000-000000000001', 'Admin', 'admin', 0,
		'{"printers":"manage","maintenance":"manage","filament":"manage","projects":"manage","prints":"manage","costs":"manage","stats":"read","integrations.sync":true,"integrations.review":true,"integrations.manage":true,"hub.manage":true,"settings.server":true,"settings.backup":true,"settings.logs":true,"settings.branding":true,"settings.alerts":true,"users.manage":true}',
		'{"projects.seeAll":true,"projects.editOthers":true,"projects.editOtherDevices":true}',
		strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('00000000-0000-4000-8000-000000000002', 'Editor', 'editor', 0,
		'{"printers":"write","maintenance":"write","filament":"write","projects":"write","prints":"write","costs":"write","stats":"read","integrations.sync":true,"integrations.review":true,"integrations.manage":false,"hub.manage":false,"settings.server":false,"settings.backup":false,"settings.logs":false,"settings.branding":false,"settings.alerts":false,"users.manage":false}',
		'{"projects.seeAll":true,"projects.editOthers":true,"projects.editOtherDevices":false}',
		strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('00000000-0000-4000-8000-000000000003', 'Viewer', 'viewer', 0,
		'{"printers":"read","maintenance":"read","filament":"read","projects":"read","prints":"read","costs":"read","stats":"read","integrations.sync":false,"integrations.review":false,"integrations.manage":false,"hub.manage":false,"settings.server":false,"settings.backup":false,"settings.logs":false,"settings.branding":false,"settings.alerts":false,"users.manage":false}',
		'{"projects.seeAll":true,"projects.editOthers":false,"projects.editOtherDevices":false}',
		strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));--> statement-breakpoint
UPDATE `users` SET `role_id` = CASE `role`
	WHEN 'admin' THEN '00000000-0000-4000-8000-000000000001'
	WHEN 'editor' THEN '00000000-0000-4000-8000-000000000002'
	ELSE '00000000-0000-4000-8000-000000000003' END;--> statement-breakpoint
-- An old switch becomes an override only where it differs from the new role's default and had an
-- effect: for editors all three, for viewers seeAll, for admins editOtherDevices off.
UPDATE `users` SET `project_rights` = json_patch(json_patch(json_patch('{}',
	CASE WHEN `role` IN ('editor', 'viewer') AND `projects_see_all` = 0 THEN '{"projects.seeAll":false}' ELSE '{}' END),
	CASE WHEN `role` = 'editor' AND `projects_edit_others` = 0 THEN '{"projects.editOthers":false}' ELSE '{}' END),
	CASE WHEN `role` = 'editor' AND `edit_other_devices` = 1 THEN '{"projects.editOtherDevices":true}'
		WHEN `role` = 'admin' AND `edit_other_devices` = 0 THEN '{"projects.editOtherDevices":false}'
		ELSE '{}' END);
