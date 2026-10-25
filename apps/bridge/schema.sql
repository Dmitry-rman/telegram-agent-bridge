CREATE TABLE bridge_state(id INTEGER PRIMARY KEY CHECK(id=1),next_offset INTEGER NOT NULL DEFAULT 0,lock_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE inbox(update_id INTEGER PRIMARY KEY,message_id INTEGER NOT NULL,chat_id TEXT NOT NULL,text TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'text',voice_duration INTEGER,voice_sealed TEXT,created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE outbox(update_id INTEGER PRIMARY KEY REFERENCES inbox(update_id),text TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('sending','sent','uncertain')),telegram_message_id INTEGER);
CREATE TABLE credentials(id INTEGER PRIMARY KEY CHECK(id=1),sealed TEXT NOT NULL);
CREATE TABLE notifications(key TEXT PRIMARY KEY,digest TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('sending','sent','uncertain')),telegram_message_id INTEGER,created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE bridge_transport(id INTEGER PRIMARY KEY CHECK(id=1),mode TEXT NOT NULL DEFAULT 'polling' CHECK(mode IN ('polling','switching','webhook')));
CREATE TABLE webhook_receipts(update_id INTEGER PRIMARY KEY);
CREATE TABLE typing_runs(update_id INTEGER PRIMARY KEY,lease_until INTEGER NOT NULL DEFAULT 0,cooldown_until INTEGER NOT NULL DEFAULT 0);
