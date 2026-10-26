import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {assembleRelayChunks} from '../../../scripts/assemble-relay-chunks.mjs';
const sql=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const page=rows=>({rows,model_projection:{truncated:false,truncated_values:0,omitted_rows:0,omitted_columns:0,next_offset:null}});
const chunks=(d,id)=>d.prepare('SELECT * FROM relay_chunks WHERE update_id=? ORDER BY part_index').all(id);
function fresh(){const d=new DatabaseSync(':memory:');d.exec(sql('schema.sql'));return d;}
function insert(d,id,sealed){d.prepare("INSERT INTO relay_queue(update_id,sealed,state) VALUES(?,?,'pending')").run(id,sealed);}
function payload(length){return 'a'.repeat(length);}
test('migration backfills exact existing ciphertext, preserves queue/order and skips tombstones',()=>{
 const d=new DatabaseSync(':memory:');d.exec(sql('drizzle/0000_light_ego.sql'));insert(d,1,payload(6037));d.prepare("INSERT INTO relay_queue(update_id,state) VALUES(2,'expired')").run();d.exec(sql('drizzle/0001_relay_order.sql'));const before=d.prepare('SELECT * FROM relay_queue').all(),order=d.prepare('SELECT * FROM relay_order').all();d.exec(sql('drizzle/0002_relay_chunks.sql'));
 assert.deepEqual(d.prepare('SELECT * FROM relay_queue').all(),before);assert.deepEqual(d.prepare('SELECT * FROM relay_order').all(),order);assert.deepEqual(chunks(d,2),[]);assert.equal(assembleRelayChunks([page(chunks(d,1))],1).sealed,before[0].sealed);
});
test('long envelopes assemble losslessly across pages; duplicates preserve chunks and original ciphertext',()=>{
 const d=fresh(),sealed=payload(99001);insert(d,3,sealed);const rows=chunks(d,3);assert.equal(rows.length,100);assert.ok(rows.every(r=>r.sealed_part.length<=1000));const pages=Array.from({length:10},(_,i)=>page(rows.slice(i*10,i*10+10)));assert.equal(assembleRelayChunks(pages,3).sealed,sealed);
 d.prepare("INSERT OR IGNORE INTO relay_queue(update_id,sealed) VALUES(3,'replacement')").run();assert.deepEqual(chunks(d,3),rows);
});
test('expiry removes chunks atomically without deleting replay/order rows or resurrecting duplicates',()=>{
 const d=fresh();insert(d,1,payload(5000));d.prepare('INSERT INTO relay_order(update_id) VALUES(1)').run();d.exec("UPDATE relay_queue SET sealed=NULL,state='expired' WHERE update_id=1");assert.equal(chunks(d,1).length,0);assert.equal(d.prepare('SELECT COUNT(*) n FROM relay_order').get().n,1);assert.equal(d.prepare('SELECT COUNT(*) n FROM relay_queue').get().n,1);d.prepare("INSERT OR IGNORE INTO relay_queue(update_id,sealed) VALUES(1,'new')").run();assert.equal(chunks(d,1).length,0);
});
test('queue/chunk writes roll back together and sealed replacement cannot mix old parts',()=>{
 const d=fresh();d.exec("CREATE TRIGGER fail_chunk BEFORE INSERT ON relay_chunks WHEN NEW.part_index=1 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");assert.throws(()=>insert(d,1,payload(2001)));assert.equal(d.prepare('SELECT COUNT(*) n FROM relay_queue').get().n,0);assert.equal(chunks(d,1).length,0);d.exec('DROP TRIGGER fail_chunk');insert(d,1,payload(3001));d.prepare('UPDATE relay_queue SET sealed=? WHERE update_id=1').run('b'.repeat(1001));assert.equal(assembleRelayChunks([page(chunks(d,1))],1).sealed,'b'.repeat(1001));assert.throws(()=>d.prepare('UPDATE relay_queue SET sealed=? WHERE update_id=1').run(payload(200001)));assert.equal(assembleRelayChunks([page(chunks(d,1))],1).sealed,'b'.repeat(1001));
});
test('assembler rejects missing duplicate malformed inconsistent and truncated chunks',()=>{
 const d=fresh();insert(d,1,payload(2001));const rows=chunks(d,1);assert.throws(()=>assembleRelayChunks([page(rows.slice(1))],1));assert.throws(()=>assembleRelayChunks([page([...rows,rows[0]])],1));assert.throws(()=>assembleRelayChunks([page(rows)],99));
 for(const patch of [{part_index:-1},{part_index:'0'},{part_count:201},{part_count:2},{total_length:2000000},{sealed_part:'x'},{sealed_part:'я'.repeat(1000)},{sealed_part:'\u0000'.repeat(1000)}])assert.throws(()=>assembleRelayChunks([page([{...rows[0],...patch},...rows.slice(1)])],1));
 for(const [key,value] of [['truncated',true],['truncated_values',1],['omitted_rows',1],['omitted_columns',1]]){const p=page(rows);p.model_projection[key]=value;assert.throws(()=>assembleRelayChunks([p],1));}assert.throws(()=>assembleRelayChunks([{rows}],1));
});
test('boundary lengths and unrelated rows cannot alter selected envelope',()=>{
 const d=fresh();for(const length of [1,999,1000,1001,200000]){insert(d,length,payload(length));assert.equal(assembleRelayChunks([page(chunks(d,length))],length).sealed.length,length);}const mixed=[...chunks(d,999),...chunks(d,1001)];assert.equal(assembleRelayChunks([page(mixed)],1001).sealed,payload(1001));assert.throws(()=>assembleRelayChunks([page(mixed)],'1001'));
});
test('real encrypted envelope round-trips exactly and modified chunk fails AEAD authentication',async()=>{
 const {sealEnvelope}=await import('../worker/index.js');const env={PRIVATE_INGEST_SECRET:'synthetic'.repeat(6)};const update={update_id:12,message:{text:'Synthetic long message '.repeat(300)}};const sealed=await sealEnvelope(env,update),d=fresh();insert(d,12,sealed);const assembled=assembleRelayChunks([page(chunks(d,12))],12);assert.equal(assembled.sealed,sealed);
 const encoder=new TextEncoder(),base=await crypto.subtle.importKey('raw',encoder.encode(env.PRIVATE_INGEST_SECRET),'HKDF',false,['deriveKey']);const key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode('dot-telegram-relay-v1'),info:encoder.encode('envelope-aes-gcm')},base,{name:'AES-GCM',length:256},false,['decrypt']);const parsed=JSON.parse(assembled.sealed),decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));const bytes=decode(parsed.data);assert.deepEqual(JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(parsed.iv),additionalData:encoder.encode('telegram-relay-v1|12')},key,bytes))),update);bytes[0]^=1;await assert.rejects(crypto.subtle.decrypt({name:'AES-GCM',iv:decode(parsed.iv),additionalData:encoder.encode('telegram-relay-v1|12')},key,bytes));
});
test('migration backfill tolerates a live writer between trigger installation and backfill',()=>{
 const d=new DatabaseSync(':memory:');d.exec(sql('drizzle/0000_light_ego.sql'));insert(d,1,payload(2001));d.exec(sql('drizzle/0001_relay_order.sql'));const statements=sql('drizzle/0002_relay_chunks.sql').split('--> statement-breakpoint');for(const statement of statements.slice(0,-1))d.exec(statement);insert(d,2,'b'.repeat(3001));d.exec(statements.at(-1));assert.equal(assembleRelayChunks([page(chunks(d,1))],1).sealed,payload(2001));assert.equal(assembleRelayChunks([page(chunks(d,2))],2).sealed,'b'.repeat(3001));assert.equal(chunks(d,2).length,4);
});
