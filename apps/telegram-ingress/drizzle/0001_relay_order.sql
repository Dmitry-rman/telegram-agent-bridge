CREATE TABLE `relay_order` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`update_id` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relay_order_update_id_unique` ON `relay_order` (`update_id`);
--> statement-breakpoint
-- Backfill all replay IDs, including expired rows; no ciphertext is read or changed.
INSERT INTO relay_order(update_id)
SELECT update_id FROM relay_queue ORDER BY received_at,update_id;
