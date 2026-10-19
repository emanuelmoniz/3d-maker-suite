CREATE TABLE `order_projects` (
	`order_id` text NOT NULL,
	`project_id` text NOT NULL,
	PRIMARY KEY(`order_id`, `project_id`),
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `order_projects_project_idx` ON `order_projects` (`project_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`client_id` text,
	`quote_id` text,
	`price` integer NOT NULL,
	`status` text NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "orders_price_ck" CHECK("orders"."price" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_number_uq` ON `orders` (`number`);--> statement-breakpoint
CREATE INDEX `orders_client_idx` ON `orders` (`client_id`);--> statement-breakpoint
CREATE INDEX `orders_quote_idx` ON `orders` (`quote_id`);--> statement-breakpoint
ALTER TABLE `prints` ADD `order_id` text REFERENCES orders(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `prints_order_idx` ON `prints` (`order_id`);