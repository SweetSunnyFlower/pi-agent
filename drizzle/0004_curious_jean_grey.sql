CREATE TABLE `conversation_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`agent_version_id` text NOT NULL,
	`channel` text NOT NULL,
	`scope_key` text NOT NULL,
	`pi_conversation_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_version_id`) REFERENCES `agent_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_bindings_scope_uq` ON `conversation_bindings` (`workspace_id`,`agent_id`,`channel`,`scope_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_bindings_pi_id_uq` ON `conversation_bindings` (`pi_conversation_id`);