ALTER TABLE `operation` ADD `actor_type` text NOT NULL DEFAULT 'system';
--> statement-breakpoint
CREATE INDEX `run_workspace_created_idx` ON `run` (`workspace_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `run_workspace_trigger_created_idx` ON `run` (`workspace_id`,`trigger_type`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `operation_workspace_created_idx` ON `operation` (`workspace_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `operation_workspace_actor_created_idx` ON `operation` (`workspace_id`,`actor_type`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `operation_workspace_trigger_created_idx` ON `operation` (`workspace_id`,`trigger_type`,`created_at`,`id`);
