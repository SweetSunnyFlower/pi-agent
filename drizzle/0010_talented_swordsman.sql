CREATE TABLE `ui_interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`conversation_binding_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`kind` text NOT NULL,
	`request_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`response_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`answered_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_binding_id`) REFERENCES `conversation_bindings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ui_interactions_tool_call_uq` ON `ui_interactions` (`conversation_binding_id`,`tool_call_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ui_interactions_pending_uq` ON `ui_interactions` (`conversation_binding_id`) WHERE "ui_interactions"."status" = 'pending';