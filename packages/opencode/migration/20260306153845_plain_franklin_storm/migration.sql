ALTER TABLE `run` ADD `trigger_metadata_json` text;
--> statement-breakpoint
CREATE TABLE `workflow_signal_dedupe` (
	`id` text PRIMARY KEY,
	`trigger_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`provider_event_id` text,
	`fallback_hash` text,
	`event_time` integer NOT NULL,
	`payload_json` text NOT NULL,
	`source_json` text,
	`first_run_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_workflow_signal_dedupe_trigger_id_workflow_trigger_id_fk` FOREIGN KEY (`trigger_id`) REFERENCES `workflow_trigger`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workflow_signal_dedupe_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workflow_signal_dedupe_first_run_id_run_id_fk` FOREIGN KEY (`first_run_id`) REFERENCES `run`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_trigger` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`trigger_type` text NOT NULL,
	`trigger_value` text NOT NULL,
	`timezone` text,
	`enabled_at` integer NOT NULL,
	`cursor_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_workflow_trigger_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_signal_dedupe_trigger_key_uq` ON `workflow_signal_dedupe` (`trigger_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `workflow_signal_dedupe_workspace_workflow_idx` ON `workflow_signal_dedupe` (`workspace_id`,`workflow_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workflow_signal_dedupe_run_idx` ON `workflow_signal_dedupe` (`first_run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_trigger_workspace_workflow_type_uq` ON `workflow_trigger` (`workspace_id`,`workflow_id`,`trigger_type`);--> statement-breakpoint
CREATE INDEX `workflow_trigger_workspace_type_idx` ON `workflow_trigger` (`workspace_id`,`trigger_type`);--> statement-breakpoint
CREATE INDEX `workflow_trigger_workspace_value_idx` ON `workflow_trigger` (`workspace_id`,`trigger_type`,`trigger_value`);
