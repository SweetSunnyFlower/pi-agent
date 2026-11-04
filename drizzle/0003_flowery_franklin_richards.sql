CREATE TABLE `agent_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`channel` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`config_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_channels_agent_channel_uq` ON `agent_channels` (`agent_id`,`channel`);--> statement-breakpoint
CREATE TABLE `channel_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_channel_id` text NOT NULL,
	`channel` text NOT NULL,
	`external_agent_id` text NOT NULL,
	`credentials_json` text NOT NULL,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`status_message` text,
	`display_name` text,
	`icon_url` text,
	`last_tested_at` integer,
	`connected_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_channel_id`) REFERENCES `agent_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_connections_agent_channel_uq` ON `channel_connections` (`agent_channel_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `channel_connections_external_agent_uq` ON `channel_connections` (`channel`,`external_agent_id`);