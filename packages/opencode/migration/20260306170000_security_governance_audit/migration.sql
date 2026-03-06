ALTER TABLE `audit_event` ADD `adapter_id` text;
--> statement-breakpoint
ALTER TABLE `audit_event` ADD `action_id` text;
--> statement-breakpoint
CREATE INDEX `audit_event_dispatch_provenance_idx` ON `audit_event` (`dispatch_attempt_id`,`adapter_id`,`integration_id`,`action_id`);
