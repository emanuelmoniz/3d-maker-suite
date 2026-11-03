CREATE TABLE `deleted_sources` (
	`entity` text NOT NULL,
	`source` text NOT NULL,
	`deleted_at` text NOT NULL,
	PRIMARY KEY(`entity`, `source`)
);
