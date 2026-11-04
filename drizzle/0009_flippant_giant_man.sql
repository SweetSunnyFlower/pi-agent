PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_outbound_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`inbound_event_id` text NOT NULL,
	`conversation_binding_id` text,
	`channel` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`provider_message_id` text,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbound_event_id`) REFERENCES `inbound_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_binding_id`) REFERENCES `conversation_bindings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_outbound_deliveries`("id", "workspace_id", "inbound_event_id", "conversation_binding_id", "channel", "target_type", "target_id", "payload_json", "status", "attempt_count", "provider_message_id", "last_error", "created_at", "updated_at", "sent_at") SELECT "id", "workspace_id", "inbound_event_id", "conversation_binding_id", "channel", "target_type", "target_id", "payload_json", "status", "attempt_count", "provider_message_id", "last_error", "created_at", "updated_at", "sent_at" FROM `outbound_deliveries`;--> statement-breakpoint
DROP TABLE `outbound_deliveries`;--> statement-breakpoint
ALTER TABLE `__new_outbound_deliveries` RENAME TO `outbound_deliveries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `outbound_deliveries_inbound_uq` ON `outbound_deliveries` (`inbound_event_id`);