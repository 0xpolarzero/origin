CREATE TABLE `library_revision` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`item_id` text NOT NULL,
	`file` text NOT NULL,
	`content_hash` text NOT NULL,
	`canonical_text` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_library_revision_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `library_revision_project_item_created_idx` ON `library_revision` (`project_id`,`item_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `library_revision_project_hash_idx` ON `library_revision` (`project_id`,`content_hash`);
