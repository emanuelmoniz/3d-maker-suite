ALTER TABLE `projects` ADD `description_file` text;--> statement-breakpoint
-- Descriptions are now empty unless the user wrote one or linked a file: drop the ones the
-- scanner filled in from readme/.md/.txt and the user never edited.
UPDATE `projects` SET `description` = NULL
WHERE `description` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM json_each(`projects`.`edited_fields`) WHERE value = 'description');
