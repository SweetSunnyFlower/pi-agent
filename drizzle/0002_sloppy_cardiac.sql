CREATE TABLE `agent_version_capabilities` (
	`workspace_id` text NOT NULL,
	`agent_version_id` text NOT NULL,
	`capability_version_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`config_json` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`agent_version_id`, `capability_version_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_version_id`) REFERENCES `agent_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`capability_version_id`) REFERENCES `capability_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capabilities_workspace_kind_slug_uq` ON `capabilities` (`workspace_id`,`kind`,`slug`);--> statement-breakpoint
CREATE TABLE `capability_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`capability_id` text NOT NULL,
	`version` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`runtime_name` text NOT NULL,
	`input_schema_json` text NOT NULL,
	`config_schema_json` text NOT NULL,
	`definition_json` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`capability_id`) REFERENCES `capabilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capability_versions_number_uq` ON `capability_versions` (`capability_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `capability_versions_runtime_name_uq` ON `capability_versions` (`workspace_id`,`runtime_name`);