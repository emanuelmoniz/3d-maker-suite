-- Cloud prints were numbered newest-first; give them their own numbers back oldest-first.
-- A cloud print's number never came from a file (cloud rows have none); a manual print's may
-- have, or was typed by hand, so manual numbers stay as they are.
CREATE TEMP TABLE `print_renumber` AS
SELECT p.`id`, s.`number` FROM
	(SELECT `id`, row_number() OVER (ORDER BY `started_at`, `rowid`) AS `k`
		FROM `prints` WHERE `origin` = 'integration' AND `number` IS NOT NULL) p
	JOIN
	(SELECT `number`, row_number() OVER (ORDER BY `number`) AS `k`
		FROM `prints` WHERE `origin` = 'integration' AND `number` IS NOT NULL) s
	USING (`k`);--> statement-breakpoint
-- Negative first: the unique index is checked row by row during an UPDATE.
UPDATE `prints` SET `number` = -`number` WHERE `id` IN (SELECT `id` FROM `print_renumber`);--> statement-breakpoint
UPDATE `prints` SET `number` = (SELECT r.`number` FROM `print_renumber` r WHERE r.`id` = `prints`.`id`)
	WHERE `id` IN (SELECT `id` FROM `print_renumber`);--> statement-breakpoint
DROP TABLE `print_renumber`;
