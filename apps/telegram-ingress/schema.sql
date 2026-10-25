CREATE TABLE relay_queue(update_id INTEGER PRIMARY KEY,sealed TEXT,state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','acked','expired')),received_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE relay_order(sequence INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,update_id INTEGER NOT NULL);
CREATE UNIQUE INDEX relay_order_update_id_unique ON relay_order(update_id);
