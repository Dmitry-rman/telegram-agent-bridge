CREATE TABLE `relay_queue` (
	`update_id` integer PRIMARY KEY NOT NULL,
	`sealed` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`received_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "relay_state" CHECK("relay_queue"."state" IN ('pending','acked','expired'))
);
