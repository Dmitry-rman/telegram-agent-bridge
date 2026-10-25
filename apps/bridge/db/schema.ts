import {sqliteTable,integer,text,check} from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';
export const bridgeState=sqliteTable('bridge_state',{
 id:integer('id').primaryKey(),nextOffset:integer('next_offset').notNull().default(0),lockUntil:integer('lock_until').notNull().default(0)
},t=>[check('singleton',sql`${t.id}=1`)]);
export const inbox=sqliteTable('inbox',{
 updateId:integer('update_id').primaryKey(),messageId:integer('message_id').notNull(),chatId:text('chat_id').notNull(),text:text('text').notNull(),kind:text('kind').notNull().default('text'),voiceDuration:integer('voice_duration'),voiceSealed:text('voice_sealed'),createdAt:integer('created_at').notNull().default(sql`(unixepoch())`)
});
export const outbox=sqliteTable('outbox',{
 updateId:integer('update_id').primaryKey().references(()=>inbox.updateId),text:text('text').notNull(),state:text('state').notNull(),telegramMessageId:integer('telegram_message_id'),kind:text('kind').notNull().default('text')
},t=>[check('reply_state',sql`${t.state} IN ('sending','sent','uncertain')`)]);
export const credentials=sqliteTable('credentials',{id:integer('id').primaryKey(),sealed:text('sealed').notNull()},t=>[check('credential_singleton',sql`${t.id}=1`)]);
export const notifications=sqliteTable('notifications',{
 key:text('key').primaryKey(),digest:text('digest').notNull(),state:text('state').notNull(),telegramMessageId:integer('telegram_message_id'),createdAt:integer('created_at').notNull().default(sql`(unixepoch())`)
},t=>[check('notification_state',sql`${t.state} IN ('sending','sent','uncertain')`)]);
export const transport=sqliteTable('bridge_transport',{id:integer('id').primaryKey(),mode:text('mode').notNull().default('polling')},t=>[check('transport_singleton',sql`${t.id}=1`),check('transport_mode',sql`${t.mode} IN ('polling','switching','webhook')`)]);
export const webhookReceipts=sqliteTable('webhook_receipts',{updateId:integer('update_id').primaryKey()});
export const typingRuns=sqliteTable('typing_runs',{updateId:integer('update_id').primaryKey(),leaseUntil:integer('lease_until').notNull().default(0),cooldownUntil:integer('cooldown_until').notNull().default(0)});
