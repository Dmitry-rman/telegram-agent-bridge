CREATE TABLE `notifications` (
	`key` text PRIMARY KEY NOT NULL,
	`digest` text NOT NULL,
	`state` text NOT NULL,
	`telegram_message_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "notification_state" CHECK("notifications"."state" IN ('sending','sent','uncertain'))
);
