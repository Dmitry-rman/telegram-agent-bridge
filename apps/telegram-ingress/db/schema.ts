import {sqliteTable,integer,text,check} from 'drizzle-orm/sqlite-core';import {sql} from 'drizzle-orm';
export const relayQueue=sqliteTable('relay_queue',{updateId:integer('update_id').primaryKey(),sealed:text('sealed'),state:text('state').notNull().default('pending'),receivedAt:integer('received_at').notNull().default(sql`(unixepoch())`)},t=>[check('relay_state',sql`${t.state} IN ('pending','acked','expired')`)]);
// Arrival sequence is independent of Telegram update IDs; writes share one batch.
export const relayOrder=sqliteTable('relay_order',{sequence:integer('sequence').primaryKey({autoIncrement:true}),updateId:integer('update_id').notNull().unique()});
