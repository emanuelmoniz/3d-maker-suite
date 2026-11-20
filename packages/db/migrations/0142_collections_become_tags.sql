-- Collections become tags (6.2.0 Step 3d): a tag of the same name (an existing one, case-insensitive,
-- is reused) on the same projects. Descriptions are dropped; no screen showed them.
INSERT INTO `tags` (`id`, `name`, `color`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
  min(`name`), '#3b82f6', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `collections`
WHERE NOT EXISTS (SELECT 1 FROM `tags` WHERE `tags`.`name` = `collections`.`name` COLLATE NOCASE)
GROUP BY lower(`name`);--> statement-breakpoint
INSERT OR IGNORE INTO `taggings` (`tag_id`, `entity_type`, `entity_id`)
SELECT `tags`.`id`, 'project', `collection_projects`.`project_id`
FROM `collection_projects`
JOIN `collections` ON `collections`.`id` = `collection_projects`.`collection_id`
JOIN `tags` ON `tags`.`name` = `collections`.`name` COLLATE NOCASE;--> statement-breakpoint
INSERT OR REPLACE INTO `settings` (`key`, `value`)
SELECT 'tagsEnabled', 'true' WHERE EXISTS (SELECT 1 FROM `collections`);--> statement-breakpoint
DROP TABLE `collection_projects`;--> statement-breakpoint
DROP TABLE `collections`;
