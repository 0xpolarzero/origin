CREATE TABLE `workflow_revision` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`file` text NOT NULL,
	`content_hash` text NOT NULL,
	`canonical_text` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_workflow_revision_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `workflow_revision_project_workflow_created_idx` ON `workflow_revision` (`project_id`,`workflow_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `workflow_revision_project_hash_idx` ON `workflow_revision` (`project_id`,`content_hash`);
--> statement-breakpoint
CREATE TABLE `run_snapshot` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`workflow_revision_id` text NOT NULL,
	`workflow_hash` text NOT NULL,
	`workflow_text` text NOT NULL,
	`graph_json` text NOT NULL,
	`input_json` text NOT NULL,
	`input_store_json` text NOT NULL,
	`trigger_metadata_json` text NOT NULL,
	`resource_materials_json` text NOT NULL,
	`material_root` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_run_snapshot_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_run_snapshot_workflow_revision_id_workflow_revision_id_fk` FOREIGN KEY (`workflow_revision_id`) REFERENCES `workflow_revision`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_snapshot_run_uq` ON `run_snapshot` (`run_id`);
--> statement-breakpoint
CREATE INDEX `run_snapshot_workflow_idx` ON `run_snapshot` (`workflow_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `run_snapshot_revision_idx` ON `run_snapshot` (`workflow_revision_id`);
--> statement-breakpoint
CREATE TABLE `run_node` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`node_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`skip_reason_code` text,
	`output_json` text,
	`error_json` text,
	`position` integer NOT NULL,
	`attempt_count` integer NOT NULL DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	CONSTRAINT `fk_run_node_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_run_node_snapshot_id_run_snapshot_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `run_snapshot`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_node_run_node_id_uq` ON `run_node` (`run_id`,`node_id`);
--> statement-breakpoint
CREATE INDEX `run_node_run_position_idx` ON `run_node` (`run_id`,`position`);
--> statement-breakpoint
CREATE INDEX `run_node_run_status_idx` ON `run_node` (`run_id`,`status`);
--> statement-breakpoint
CREATE INDEX `run_node_snapshot_idx` ON `run_node` (`snapshot_id`);
--> statement-breakpoint
CREATE TABLE `run_attempt` (
	`id` text PRIMARY KEY,
	`run_node_id` text NOT NULL,
	`attempt_index` integer NOT NULL,
	`status` text NOT NULL,
	`session_id` text,
	`input_json` text,
	`output_json` text,
	`error_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	CONSTRAINT `fk_run_attempt_run_node_id_run_node_id_fk` FOREIGN KEY (`run_node_id`) REFERENCES `run_node`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_run_attempt_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_attempt_node_index_uq` ON `run_attempt` (`run_node_id`,`attempt_index`);
--> statement-breakpoint
CREATE INDEX `run_attempt_status_idx` ON `run_attempt` (`status`);
--> statement-breakpoint
CREATE INDEX `run_attempt_session_idx` ON `run_attempt` (`session_id`);
--> statement-breakpoint
CREATE TABLE `run_event` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`run_node_id` text,
	`run_attempt_id` text,
	`sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_run_event_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_run_event_run_node_id_run_node_id_fk` FOREIGN KEY (`run_node_id`) REFERENCES `run_node`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_run_event_run_attempt_id_run_attempt_id_fk` FOREIGN KEY (`run_attempt_id`) REFERENCES `run_attempt`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_event_run_sequence_uq` ON `run_event` (`run_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `run_event_run_idx` ON `run_event` (`run_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `run_event_node_idx` ON `run_event` (`run_node_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `run_event_attempt_idx` ON `run_event` (`run_attempt_id`,`sequence`);
--> statement-breakpoint
CREATE TABLE `session_link` (
	`session_id` text PRIMARY KEY,
	`role` text NOT NULL,
	`visibility` text NOT NULL,
	`run_id` text,
	`run_node_id` text,
	`run_attempt_id` text,
	`readonly` integer NOT NULL DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_session_link_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_link_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_session_link_run_node_id_run_node_id_fk` FOREIGN KEY (`run_node_id`) REFERENCES `run_node`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_session_link_run_attempt_id_run_attempt_id_fk` FOREIGN KEY (`run_attempt_id`) REFERENCES `run_attempt`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `session_link_run_idx` ON `session_link` (`run_id`,`role`);
--> statement-breakpoint
CREATE INDEX `session_link_node_idx` ON `session_link` (`run_node_id`,`role`);
--> statement-breakpoint
CREATE INDEX `session_link_attempt_idx` ON `session_link` (`run_attempt_id`);
--> statement-breakpoint
CREATE INDEX `session_link_visibility_idx` ON `session_link` (`visibility`,`role`);
