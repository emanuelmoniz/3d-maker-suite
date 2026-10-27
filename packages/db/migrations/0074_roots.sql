-- Project roots move from the `projectRoots` setting into a table, and projects point at a root plus a
-- folder relative to it (ADR-0014). Every existing root is a folder on this server: location `hub`.
CREATE TABLE `roots` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`location` text DEFAULT 'hub' NOT NULL,
	`path` text NOT NULL,
	`project_depth` integer DEFAULT 1 NOT NULL,
	`files_depth` integer,
	`auto_slice` integer DEFAULT true NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `roots_location_path_uq` ON `roots` (`location`,`path`);--> statement-breakpoint
-- Name: the last folder of the path (`rtrim` by every other character strips it, `replace` keeps it).
-- Id: a v4 UUID, like `crypto.randomUUID()`.
INSERT INTO `roots` (`id`, `name`, `location`, `path`, `project_depth`, `files_depth`, `auto_slice`, `position`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-'
		|| substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	coalesce(nullif(replace(r.n, rtrim(r.n, replace(r.n, '/', '')), ''), ''), r.path),
	'hub', r.path, r.project_depth, r.files_depth, r.auto_slice, r.position,
	strftime('%Y-%m-%dT%H:%M:%fZ'), strftime('%Y-%m-%dT%H:%M:%fZ')
FROM (
	SELECT json_extract(j.`value`, '$.path') AS path,
		rtrim(replace(json_extract(j.`value`, '$.path'), '\', '/'), '/') AS n,
		coalesce(json_extract(j.`value`, '$.projectDepth'), 1) AS project_depth,
		json_extract(j.`value`, '$.filesDepth') AS files_depth,
		coalesce(json_extract(j.`value`, '$.autoSlice'), 1) AS auto_slice,
		j.`key` AS position
	FROM `settings` s, json_each(s.`value`) j WHERE s.`key` = 'projectRoots'
) r;--> statement-breakpoint
ALTER TABLE `projects` ADD `root_id` text REFERENCES roots(id) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `projects` ADD `folder` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `unlinked_root_id` text REFERENCES roots(id) ON DELETE set null;--> statement-breakpoint
-- The deepest root a folder is strictly below, separators normalised. No match (a root removed
-- later, or the folder written another way): the project stays, unlinked.
-- ponytail: case-insensitive, so on Linux two roots that differ only in case are one; a realpath
-- fix-up in JS if that ever shows up.
UPDATE `projects` SET `root_id` = (
	SELECT r.`id` FROM `roots` r
	WHERE instr(lower(rtrim(replace(`projects`.`folder_path`, '\', '/'), '/')),
		lower(rtrim(replace(r.`path`, '\', '/'), '/')) || '/') = 1
	ORDER BY length(rtrim(replace(r.`path`, '\', '/'), '/')) DESC LIMIT 1
) WHERE `folder_path` IS NOT NULL;--> statement-breakpoint
UPDATE `projects` SET `folder` = substr(rtrim(replace(`folder_path`, '\', '/'), '/'),
	length(rtrim(replace((SELECT r.`path` FROM `roots` r WHERE r.`id` = `projects`.`root_id`), '\', '/'), '/')) + 2)
WHERE `root_id` IS NOT NULL;--> statement-breakpoint
-- The same for the folder a project was unlinked from and kept.
UPDATE `projects` SET `unlinked_root_id` = (
	SELECT r.`id` FROM `roots` r
	WHERE instr(lower(rtrim(replace(`projects`.`unlinked_folder`, '\', '/'), '/')),
		lower(rtrim(replace(r.`path`, '\', '/'), '/')) || '/') = 1
	ORDER BY length(rtrim(replace(r.`path`, '\', '/'), '/')) DESC LIMIT 1
) WHERE `unlinked_folder` IS NOT NULL;--> statement-breakpoint
UPDATE `projects` SET `unlinked_folder` = CASE WHEN `unlinked_root_id` IS NOT NULL THEN
	substr(rtrim(replace(`unlinked_folder`, '\', '/'), '/'),
		length(rtrim(replace((SELECT r.`path` FROM `roots` r WHERE r.`id` = `projects`.`unlinked_root_id`), '\', '/'), '/')) + 2)
	END
WHERE `unlinked_folder` IS NOT NULL;--> statement-breakpoint
-- The main model file becomes relative to the project folder, like every other file reference.
UPDATE `projects` SET `file_path` = CASE
	WHEN instr(replace(`file_path`, '\', '/'), rtrim(replace(`folder_path`, '\', '/'), '/') || '/') = 1
	THEN substr(replace(`file_path`, '\', '/'), length(rtrim(replace(`folder_path`, '\', '/'), '/')) + 2)
	END
WHERE `file_path` IS NOT NULL;--> statement-breakpoint
DROP INDEX `projects_folder_uq`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `folder_path`;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_root_folder_uq` ON `projects` (`root_id`,`folder`);--> statement-breakpoint
DELETE FROM `settings` WHERE `key` = 'projectRoots';
