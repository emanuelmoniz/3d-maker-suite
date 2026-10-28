CREATE TABLE `device_root_folders` (
	`root_id` text NOT NULL,
	`folder` text NOT NULL,
	`digest` text NOT NULL,
	`scan` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`root_id`, `folder`),
	FOREIGN KEY (`root_id`) REFERENCES `roots`(`id`) ON UPDATE no action ON DELETE cascade
);
