CREATE TABLE `audit_event` (
	`id` text PRIMARY KEY,
	`event_type` text NOT NULL,
	`actor_type` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`workspace_id` text NOT NULL,
	`session_id` text,
	`run_id` text,
	`operation_id` text,
	`draft_id` text,
	`integration_id` text,
	`integration_attempt_id` text,
	`policy_id` text,
	`policy_version` text,
	`decision_id` text,
	`decision_reason_code` text,
	`event_payload` text NOT NULL,
	CONSTRAINT `fk_audit_event_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_audit_event_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_audit_event_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_audit_event_operation_id_operation_id_fk` FOREIGN KEY (`operation_id`) REFERENCES `operation`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_audit_event_draft_id_draft_id_fk` FOREIGN KEY (`draft_id`) REFERENCES `draft`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_audit_event_integration_attempt_id_integration_attempt_id_fk` FOREIGN KEY (`integration_attempt_id`) REFERENCES `integration_attempt`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `draft` (
	`id` text PRIMARY KEY,
	`run_id` text,
	`workspace_id` text NOT NULL,
	`status` text NOT NULL,
	`integration_id` text NOT NULL,
	`policy_id` text,
	`policy_version` text,
	`decision_id` text,
	`decision_reason_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_draft_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_draft_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `integration_attempt` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`state` text NOT NULL,
	`replay_index` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_integration_attempt_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_integration_attempt_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `operation` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`session_id` text,
	`workspace_id` text NOT NULL,
	`status` text NOT NULL,
	`trigger_type` text NOT NULL,
	`workflow_id` text,
	`integration_attempt_id` text,
	`ready_for_integration_at` integer,
	`jj_base_change_id` text,
	`jj_result_change_ids` text,
	`jj_operation_ids` text,
	`jj_operation_phases` text,
	`jj_commit_ids` text,
	`changed_paths` text,
	`source_operation_id` text,
	`integration_head_change_id_before_apply` text,
	`integration_head_change_id_after_apply` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_operation_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_operation_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_operation_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_operation_source_operation_id_operation_id_fk` FOREIGN KEY (`source_operation_id`) REFERENCES `operation`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `run` (
	`id` text PRIMARY KEY,
	`status` text NOT NULL,
	`trigger_type` text NOT NULL,
	`workspace_id` text NOT NULL,
	`session_id` text,
	`ready_for_integration_at` integer,
	`failure_code` text,
	`reason_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	CONSTRAINT `fk_run_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_run_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `audit_event_workspace_occurred_idx` ON `audit_event` (`workspace_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_event_session_occurred_idx` ON `audit_event` (`session_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_event_run_occurred_idx` ON `audit_event` (`run_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_event_operation_occurred_idx` ON `audit_event` (`operation_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_event_draft_occurred_idx` ON `audit_event` (`draft_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_event_integration_occurred_idx` ON `audit_event` (`integration_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_event_attempt_occurred_idx` ON `audit_event` (`integration_attempt_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_event_type_occurred_idx` ON `audit_event` (`event_type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_event_policy_lineage_idx` ON `audit_event` (`policy_id`,`policy_version`,`decision_id`,`decision_reason_code`);--> statement-breakpoint
CREATE INDEX `draft_workspace_status_idx` ON `draft` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `draft_run_idx` ON `draft` (`run_id`);--> statement-breakpoint
CREATE INDEX `draft_integration_status_idx` ON `draft` (`integration_id`,`status`);--> statement-breakpoint
CREATE INDEX `draft_policy_lineage_idx` ON `draft` (`policy_id`,`policy_version`,`decision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `integration_attempt_run_id_id_uq` ON `integration_attempt` (`run_id`,`id`);--> statement-breakpoint
CREATE INDEX `integration_attempt_workspace_state_idx` ON `integration_attempt` (`workspace_id`,`state`);--> statement-breakpoint
CREATE INDEX `integration_attempt_run_state_idx` ON `integration_attempt` (`run_id`,`state`);--> statement-breakpoint
CREATE INDEX `operation_run_idx` ON `operation` (`run_id`);--> statement-breakpoint
CREATE INDEX `operation_workspace_idx` ON `operation` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `operation_status_idx` ON `operation` (`status`);--> statement-breakpoint
CREATE INDEX `operation_source_idx` ON `operation` (`source_operation_id`);--> statement-breakpoint
CREATE INDEX `operation_attempt_idx` ON `operation` (`integration_attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `operation_attempt_uq` ON `operation` (`integration_attempt_id`);--> statement-breakpoint
CREATE INDEX `run_status_idx` ON `run` (`status`);--> statement-breakpoint
CREATE INDEX `run_session_idx` ON `run` (`session_id`);--> statement-breakpoint
CREATE INDEX `run_workspace_status_idx` ON `run` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `run_queue_idx` ON `run` (`workspace_id`,`status`,`ready_for_integration_at`,`id`);--> statement-breakpoint
CREATE TRIGGER `run_ready_for_integration_at_immutable`
BEFORE UPDATE OF `ready_for_integration_at` ON `run`
FOR EACH ROW
WHEN OLD.`ready_for_integration_at` IS NOT NULL
 AND NEW.`ready_for_integration_at` IS NOT OLD.`ready_for_integration_at`
BEGIN
  SELECT RAISE(ABORT, 'run.ready_for_integration_at is immutable once set');
END;
