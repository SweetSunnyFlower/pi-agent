CREATE TABLE `inbound_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`agent_channel_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`channel` text NOT NULL,
	`external_event_id` text NOT NULL,
	`external_thread_id` text NOT NULL,
	`sender_external_id` text NOT NULL,
	`chat_type` text NOT NULL,
	`reply_target_type` text NOT NULL,
	`reply_target_id` text NOT NULL,
	`content_text` text NOT NULL,
	`raw_metadata_json` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`conversation_binding_id` text,
	`submission_id` text,
	`response_text` text,
	`error` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_channel_id`) REFERENCES `agent_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `channel_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_binding_id`) REFERENCES `conversation_bindings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_events_external_uq` ON `inbound_events` (`agent_channel_id`,`external_event_id`);--> statement-breakpoint
CREATE TABLE `outbound_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`inbound_event_id` text NOT NULL,
	`conversation_binding_id` text NOT NULL,
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
CREATE UNIQUE INDEX `outbound_deliveries_inbound_uq` ON `outbound_deliveries` (`inbound_event_id`);