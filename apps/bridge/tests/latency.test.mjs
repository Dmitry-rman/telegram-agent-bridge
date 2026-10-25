import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {Repo,SQL,seal,importRelayEnvelopes,poll,configureWebhook} from '../worker/index.js';
import {sealEnvelope} from '../../telegram-ingress/worker/index.js';

function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 const calls=[];
 let fail=()=>false;
 const DB={
  prepare(sql){let args=[];return {
   bind(...values){args=values;return this;},
   async first(){calls.push(sql);return sqlite.prepare(sql).get(...args)??null;},
   async all(){calls.push(sql);return {results:sqlite.prepare(sql).all(...args)};},
   async run(){calls.push(sql);return this.execute();},
   execute(){if(fail(sql,args))throw Error('Synthetic database failure');return {meta:{changes:sqlite.prepare(sql).run(...args).changes}};}
  };},
  async batch(statements){
   calls.push('batch');sqlite.exec('BEGIN');
   try{const results=statements.map(s=>s.execute());sqlite.exec('COMMIT');return results;}
   catch(e){sqlite.exec('ROLLBACK');throw e;}
  }
 };
 const env={DB,SITE_ORIGIN:'https://bridge.example.invalid',SITE_OWNER_ID:'test-owner',PRIVATE_INGEST_SECRET:'synthetic-relay-secret-at-least-32-characters',BRIDGE_MASTER_KEY:Buffer.alloc(32,4).toString('base64')};
 return {sqlite,env,calls,failWhen(predicate){fail=predicate;}};
}
const update=id=>({update_id:id,message:{message_id:id,chat:{id:42,type:'private'},from:{id:42},text:'synthetic text'}});
async function paired(f){f.sqlite.prepare('INSERT INTO credentials(id,sealed) VALUES(1,?)').run(await seal(f.env,{token:'123:TEST_ONLY',status:'ready',owner:'42'}));}
async function envelopes(env,ids){return Promise.all(ids.map(async id=>({update_id:id,sealed:await sealEnvelope(env,update(id))})));}

test('one or ten imported messages need four database calls, one credential read and one commit',async()=>{
 for(const size of [1,10]){
  const f=fixture();await paired(f);
  const result=await importRelayEnvelopes(f.env,{envelopes:await envelopes(f.env,Array.from({length:size},(_,i)=>i+1))});
  assert.equal(result.messages.length,size);
  assert.equal(result.ack_receipts.length,size);
  assert.equal(f.calls.length,4);
  assert.equal(f.calls.filter(sql=>sql.includes('FROM credentials')).length,1);
  assert.equal(f.calls.filter(sql=>sql==='batch').length,1);
  for(const elapsed of Object.values(result.timings_ms))assert.ok(Number.isInteger(elapsed)&&elapsed>=0);
  const encoder=new TextEncoder(),base=await crypto.subtle.importKey('raw',encoder.encode(f.env.PRIVATE_INGEST_SECRET),'HKDF',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode('dot-telegram-relay-v1'),info:encoder.encode('commit-receipt-hmac')},base,{name:'HMAC',hash:'SHA-256',length:256},false,['verify']);
  for(const receipt of result.ack_receipts)assert.equal(await crypto.subtle.verify('HMAC',key,Buffer.from(receipt.proof,'base64'),encoder.encode('telegram-private-commit-v1|'+receipt.update_id)),true);
 }
});

test('failed batch rolls back all messages, replay receipts and retention cleanup',async()=>{
 const f=fixture();await paired(f);
 await importRelayEnvelopes(f.env,{envelopes:await envelopes(f.env,[1])});
 f.sqlite.exec('UPDATE inbox SET created_at=0');
 f.failWhen((sql,args)=>sql.startsWith('INSERT OR IGNORE INTO webhook_receipts')&&args[0]===3);
 await assert.rejects(importRelayEnvelopes(f.env,{envelopes:await envelopes(f.env,[2,3])}),/Synthetic/);
 assert.deepEqual(f.sqlite.prepare('SELECT update_id FROM inbox').all().map(r=>r.update_id),[1]);
 assert.deepEqual(f.sqlite.prepare('SELECT update_id FROM webhook_receipts').all().map(r=>r.update_id),[1]);
 f.failWhen(()=>false);
 assert.deepEqual((await importRelayEnvelopes(f.env,{envelopes:await envelopes(f.env,[2,3])})).accepted_update_ids,[2,3]);
});

test('import-only activity purges expired plaintext and replay never resurrects it',async()=>{
 const f=fixture();await paired(f);
 const first=await envelopes(f.env,[1]);
 await importRelayEnvelopes(f.env,{envelopes:first});
 f.sqlite.exec('UPDATE inbox SET created_at=0');
 const result=await importRelayEnvelopes(f.env,{envelopes:[...first,...await envelopes(f.env,[2])]});
 assert.deepEqual(result.messages.map(m=>m.update_id),[2]);
 assert.equal(f.sqlite.prepare('SELECT * FROM inbox WHERE update_id=1').get(),undefined);
 assert.ok(f.sqlite.prepare('SELECT * FROM webhook_receipts WHERE update_id=1').get());
});

test('malformed later envelope cannot partially import an otherwise valid request',async()=>{
 const f=fixture();await paired(f);
 await assert.rejects(importRelayEnvelopes(f.env,{envelopes:[...await envelopes(f.env,[1]),{update_id:2,sealed:null}]}),/Invalid relay envelope/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM inbox').get().count,0);
});

test('batch import retains the private ingest plaintext bound after decryption',async()=>{
 const f=fixture();await paired(f);
 const large=update(1);large.message.text='x'.repeat(132000);
 const result=await importRelayEnvelopes(f.env,{envelopes:[{update_id:1,sealed:await sealEnvelope(f.env,large)}]});
 assert.deepEqual(result.failed_update_ids,[1]);
 assert.deepEqual(result.ack_receipts,[]);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM inbox').get().count,0);
});

test('IDs below the legacy polling cursor are reported as skipped without false commit receipts',async()=>{
 const f=fixture();await paired(f);f.sqlite.exec('INSERT INTO bridge_state(id,next_offset) VALUES(1,1000)');
 const result=await importRelayEnvelopes(f.env,{envelopes:await envelopes(f.env,[10,1001])});
 assert.deepEqual(result.skipped_update_ids,[10]);
 assert.deepEqual(result.accepted_update_ids,[1001]);
 assert.deepEqual(result.ack_receipts.map(r=>r.update_id),[1001]);
 assert.equal(f.sqlite.prepare('SELECT next_offset FROM bridge_state').get().next_offset,1000);
});

test('polling checks webhook replay receipts in one read for a hundred updates',async()=>{
 const f=fixture(),live={...f.env,TELEGRAM_BOT_TOKEN:'123:TEST_ONLY',TELEGRAM_OWNER_ID:'42'};
 f.sqlite.exec('INSERT INTO webhook_receipts(update_id) VALUES(50)');
 const result=await poll(live,new Repo(f.env.DB),async()=>Array.from({length:100},(_,i)=>update(i+1)));
 assert.equal(result.messages.length,99);
 assert.equal(result.messages.some(m=>m.update_id===50),false);
 assert.equal(f.calls.filter(sql=>sql.includes('FROM webhook_receipts')).length,1);
 assert.equal(f.sqlite.prepare(SQL.cursor).get().next_offset,101);
});

test('unchanged webhook URL cannot confirm a failed secret registration',async()=>{
 for(const outcome of ['rate_limit','timeout','false']){
  const f=fixture(),repo=new Repo(f.env.DB),live={...f.env,TELEGRAM_BOT_TOKEN:'123:TEST_ONLY',TELEGRAM_OWNER_ID:'42',TELEGRAM_WEBHOOK_URL:'https://receiver.example.invalid/telegram-webhook',TELEGRAM_WEBHOOK_SECRET:'synthetic_secret_more_than_32_characters'};
  await assert.rejects(configureWebhook(live,repo,async(env,method)=>{
   if(method==='getWebhookInfo')return {url:live.TELEGRAM_WEBHOOK_URL};
   if(outcome==='rate_limit')throw Object.assign(Error('Synthetic limit'),{code:'RATE_LIMIT',retryAfter:9});
   if(outcome==='timeout')throw Error('Synthetic timeout');
   return false;
  }),error=>outcome==='rate_limit'?error.code==='RATE_LIMIT':/unconfirmed/.test(error.message));
  assert.equal(f.sqlite.prepare('SELECT mode FROM bridge_transport').get().mode,'switching');
  assert.equal(f.sqlite.prepare('SELECT lock_until FROM bridge_state').get().lock_until,0);
 }
});
