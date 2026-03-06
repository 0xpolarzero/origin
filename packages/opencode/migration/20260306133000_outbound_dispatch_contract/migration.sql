DROP TABLE IF EXISTS `audit_event`;
--> statement-breakpoint
DROP TABLE IF EXISTS `draft`;
--> statement-breakpoint
CREATE TABLE `draft` (
	`id` text PRIMARY KEY,
	`run_id` text,
	`workspace_id` text NOT NULL,
	`status` text NOT NULL,
	`source_kind` text NOT NULL,
	`adapter_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`action_id` text NOT NULL,
	`target` text NOT NULL,
	`payload_json` text NOT NULL,
	`payload_schema_version` integer NOT NULL,
	`preview_text` text NOT NULL,
	`material_hash` text NOT NULL,
	`block_reason_code` text,
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
CREATE TABLE `outbound_integration` (
	`id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`adapter_id` text NOT NULL,
	`enabled` integer NOT NULL DEFAULT 1,
	`auth_state` text NOT NULL,
	`allowed_targets` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	CONSTRAINT `fk_outbound_integration_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `dispatch_attempt` (
	`id` text PRIMARY KEY,
	`draft_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`state` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`remote_reference` text,
	`block_reason_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_dispatch_attempt_draft_id_draft_id_fk` FOREIGN KEY (`draft_id`) REFERENCES `draft`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_dispatch_attempt_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
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
	`dispatch_attempt_id` text,
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
	CONSTRAINT `fk_audit_event_dispatch_attempt_id_dispatch_attempt_id_fk` FOREIGN KEY (`dispatch_attempt_id`) REFERENCES `dispatch_attempt`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_audit_event_integration_attempt_id_integration_attempt_id_fk` FOREIGN KEY (`integration_attempt_id`) REFERENCES `integration_attempt`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `draft_workspace_status_idx` ON `draft` (`workspace_id`,`status`);
--> statement-breakpoint
CREATE INDEX `draft_run_idx` ON `draft` (`run_id`);
--> statement-breakpoint
CREATE INDEX `draft_integration_status_idx` ON `draft` (`integration_id`,`status`);
--> statement-breakpoint
CREATE INDEX `draft_workspace_updated_idx` ON `draft` (`workspace_id`,`updated_at`,`id`);
--> statement-breakpoint
CREATE INDEX `draft_policy_lineage_idx` ON `draft` (`policy_id`,`policy_version`,`decision_id`);
--> statement-breakpoint
CREATE INDEX `outbound_integration_workspace_adapter_idx` ON `outbound_integration` (`workspace_id`,`adapter_id`);
--> statement-breakpoint
CREATE INDEX `outbound_integration_workspace_enabled_idx` ON `outbound_integration` (`workspace_id`,`enabled`);
--> statement-breakpoint
CREATE UNIQUE INDEX `dispatch_attempt_draft_uq` ON `dispatch_attempt` (`draft_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `dispatch_attempt_idempotency_key_uq` ON `dispatch_attempt` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `dispatch_attempt_workspace_state_idx` ON `dispatch_attempt` (`workspace_id`,`state`);
--> statement-breakpoint
CREATE INDEX `dispatch_attempt_integration_state_idx` ON `dispatch_attempt` (`integration_id`,`state`);
--> statement-breakpoint
CREATE INDEX `audit_event_workspace_occurred_idx` ON `audit_event` (`workspace_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `audit_event_session_occurred_idx` ON `audit_event` (`session_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `audit_event_run_occurred_idx` ON `audit_event` (`run_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `audit_event_operation_occurred_idx` ON `audit_event` (`operation_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `audit_event_draft_occurred_idx` ON `audit_event` (`draft_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `audit_event_integration_occurred_idx` ON `audit_event` (`integration_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `audit_event_dispatch_attempt_occurred_idx` ON `audit_event` (`dispatch_attempt_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `audit_event_attempt_occurred_idx` ON `audit_event` (`integration_attempt_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `audit_event_type_occurred_idx` ON `audit_event` (`event_type`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `audit_event_policy_lineage_idx` ON `audit_event` (`policy_id`,`policy_version`,`decision_id`,`decision_reason_code`);
