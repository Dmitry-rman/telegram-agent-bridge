ALTER TABLE `inbox` ADD `kind` text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE `inbox` ADD `voice_duration` integer;--> statement-breakpoint
ALTER TABLE `inbox` ADD `voice_sealed` text;