CREATE TABLE `bridge_transport` (
	`id` integer PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'polling' NOT NULL,
	CONSTRAINT "transport_singleton" CHECK("bridge_transport"."id"=1),
	CONSTRAINT "transport_mode" CHECK("bridge_transport"."mode" IN ('polling','switching','webhook'))
);
--> statement-breakpoint
CREATE TABLE `webhook_receipts` (
	`update_id` integer PRIMARY KEY NOT NULL
);
