CREATE TABLE `typing_runs` (
	`update_id` integer PRIMARY KEY NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`cooldown_until` integer DEFAULT 0 NOT NULL
);
