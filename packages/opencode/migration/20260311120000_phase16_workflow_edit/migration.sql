CREATE TABLE `workflow_edit` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`workflow_revision_id` text NOT NULL,
	`previous_workflow_revision_id` text,
	`session_id` text,
	`action` text NOT NULL,
	`node_id` text,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_workflow_edit_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workflow_edit_workflow_revision_id_workflow_revision_id_fk` FOREIGN KEY (`workflow_revision_id`) REFERENCES `workflow_revision`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workflow_edit_previous_workflow_revision_id_workflow_revision_id_fk` FOREIGN KEY (`previous_workflow_revision_id`) REFERENCES `workflow_revision`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_workflow_edit_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_edit_project_workflow_created_idx` ON `workflow_edit` (`project_id`,`workflow_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `workflow_edit_revision_idx` ON `workflow_edit` (`workflow_revision_id`);
--> statement-breakpoint
CREATE INDEX `workflow_edit_session_idx` ON `workflow_edit` (`session_id`,`created_at`);
