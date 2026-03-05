ALTER TABLE `run` ADD `workflow_id` text;
--> statement-breakpoint
ALTER TABLE `run` ADD `run_workspace_root` text;
--> statement-breakpoint
ALTER TABLE `run` ADD `run_workspace_directory` text;
--> statement-breakpoint
ALTER TABLE `run` ADD `integration_candidate_base_change_id` text;
--> statement-breakpoint
ALTER TABLE `run` ADD `integration_candidate_change_ids` text;
--> statement-breakpoint
ALTER TABLE `run` ADD `integration_candidate_changed_paths` text;
--> statement-breakpoint
ALTER TABLE `run` ADD `cleanup_failed` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX `run_workflow_idx` ON `run` (`workflow_id`);
--> statement-breakpoint
CREATE INDEX `run_cleanup_failed_idx` ON `run` (`cleanup_failed`);
