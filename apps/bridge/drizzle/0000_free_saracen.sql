CREATE TABLE `bridge_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`next_offset` integer DEFAULT 0 NOT NULL,
	`lock_until` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "singleton" CHECK("bridge_state"."id"=1)
);
--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` integer PRIMARY KEY NOT NULL,
	`sealed` text NOT NULL,
	CONSTRAINT "credential_singleton" CHECK("credentials"."id"=1)
);
--> statement-breakpoint
CREATE TABLE `inbox` (
	`update_id` integer PRIMARY KEY NOT NULL,
	`message_id` integer NOT NULL,
	`chat_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`update_id` integer PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`state` text NOT NULL,
	`telegram_message_id` integer,
	FOREIGN KEY (`update_id`) REFERENCES `inbox`(`update_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reply_state" CHECK("outbox"."state" IN ('sending','sent','uncertain'))
);
