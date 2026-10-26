import {sqliteTable,integer,text,check,primaryKey} from 'drizzle-orm/sqlite-core';import {sql} from 'drizzle-orm';
export const relayQueue=sqliteTable('relay_queue',{updateId:integer('update_id').primaryKey(),sealed:text('sealed'),state:text('state').notNull().default('pending'),receivedAt:integer('received_at').notNull().default(sql`(unixepoch())`)},t=>[check('relay_state',sql`${t.state} IN ('pending','acked','expired')`)]);
// Arrival sequence is independent of Telegram update IDs; writes share one batch.
export const relayOrder=sqliteTable('relay_order',{sequence:integer('sequence').primaryKey({autoIncrement:true}),updateId:integer('update_id').notNull().unique()});

// Ciphertext-only native-reader projection; triggers keep it atomic with relay_queue.
export const relayChunks=sqliteTable('relay_chunks',{
 updateId:integer('update_id').notNull(),partIndex:integer('part_index').notNull(),partCount:integer('part_count').notNull(),totalLength:integer('total_length').notNull(),sealedPart:text('sealed_part').notNull()
},t=>[primaryKey({columns:[t.updateId,t.partIndex]}),check('chunk_bounds',sql`${t.partIndex} >= 0 AND ${t.partIndex} < ${t.partCount} AND ${t.partCount} BETWEEN 1 AND 200 AND ${t.totalLength} BETWEEN 1 AND 200000 AND ${t.partCount} = (${t.totalLength}+999)/1000 AND length(${t.sealedPart}) BETWEEN 1 AND 1000`)]);
