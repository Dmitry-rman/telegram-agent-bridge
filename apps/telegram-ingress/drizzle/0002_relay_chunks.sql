CREATE TABLE `relay_chunks` (
	`update_id` integer NOT NULL,
	`part_index` integer NOT NULL,
	`part_count` integer NOT NULL,
	`total_length` integer NOT NULL,
	`sealed_part` text NOT NULL,
	PRIMARY KEY(`update_id`, `part_index`),
	CONSTRAINT "chunk_bounds" CHECK("relay_chunks"."part_index" >= 0 AND "relay_chunks"."part_index" < "relay_chunks"."part_count" AND "relay_chunks"."part_count" BETWEEN 1 AND 200 AND "relay_chunks"."total_length" BETWEEN 1 AND 200000 AND "relay_chunks"."part_count" = ("relay_chunks"."total_length"+999)/1000 AND length("relay_chunks"."sealed_part") BETWEEN 1 AND 1000)
);

--> statement-breakpoint
-- Maintain bounded ciphertext-only projections in the same transaction as queue writes.
CREATE TRIGGER relay_chunks_insert AFTER INSERT ON relay_queue
WHEN NEW.state='pending' AND NEW.sealed IS NOT NULL
BEGIN
 INSERT INTO relay_chunks(update_id,part_index,part_count,total_length,sealed_part)
 SELECT NEW.update_id,n,(length(NEW.sealed)+999)/1000,length(NEW.sealed),substr(NEW.sealed,n*1000+1,1000)
 FROM (WITH RECURSIVE parts(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM parts WHERE (n+1)*1000<length(NEW.sealed)) SELECT n FROM parts);
END;
--> statement-breakpoint
CREATE TRIGGER relay_chunks_update AFTER UPDATE OF sealed,state ON relay_queue
BEGIN
 DELETE FROM relay_chunks WHERE update_id=NEW.update_id;
 INSERT INTO relay_chunks(update_id,part_index,part_count,total_length,sealed_part)
 SELECT NEW.update_id,n,(length(NEW.sealed)+999)/1000,length(NEW.sealed),substr(NEW.sealed,n*1000+1,1000)
 FROM (WITH RECURSIVE parts(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM parts WHERE (n+1)*1000<length(NEW.sealed)) SELECT n FROM parts)
 WHERE NEW.state='pending' AND NEW.sealed IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER relay_chunks_delete AFTER DELETE ON relay_queue
BEGIN
 DELETE FROM relay_chunks WHERE update_id=OLD.update_id;
END;
--> statement-breakpoint
-- Backfill from complete server-side ciphertext, never from truncated connector output.
WITH RECURSIVE chunks(update_id,part_index,part_count,total_length,sealed_part) AS (
 SELECT update_id,0,(length(sealed)+999)/1000,length(sealed),substr(sealed,1,1000)
 FROM relay_queue WHERE state='pending' AND sealed IS NOT NULL
 UNION ALL
 SELECT c.update_id,c.part_index+1,c.part_count,c.total_length,substr(q.sealed,(c.part_index+1)*1000+1,1000)
 FROM chunks c JOIN relay_queue q ON q.update_id=c.update_id WHERE c.part_index+1<c.part_count
)
INSERT INTO relay_chunks SELECT c.* FROM chunks c
WHERE NOT EXISTS (SELECT 1 FROM relay_chunks r WHERE r.update_id=c.update_id AND r.part_index=c.part_index);
