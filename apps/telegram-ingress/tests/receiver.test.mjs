import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import worker from '../worker/index.js';
function db(){const d=new DatabaseSync(':memory:');d.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));return {prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return d.prepare(sql).get(...args)??null;},async all(){return {results:d.prepare(sql).all(...args)};},execute(){return {meta:{changes:d.prepare(sql).run(...args).changes}};},async run(){return this.execute();}};},async batch(statements){d.exec('BEGIN');try{const out=statements.map(s=>s.execute());d.exec('COMMIT');return out;}catch(e){d.exec('ROLLBACK');throw e;}}};}
const base={RECEIVER_ORIGIN:'https://receiver.example',PRIVATE_INGEST_SECRET:'i'.repeat(43),TELEGRAM_WEBHOOK_SECRET:'t'.repeat(43),TELEGRAM_OWNER_ID:'42'};
const update=(id=1,owner=42)=>({update_id:id,message:{message_id:id+1,from:{id:owner},chat:{id:owner,type:'private'},text:'synthetic private content'}});
const req=(u=update(),secret=base.TELEGRAM_WEBHOOK_SECRET)=>new Request(base.RECEIVER_ORIGIN+'/telegram-webhook',{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':secret},body:JSON.stringify(u)});
test('ONLY secretchecked webhook is reachable; all read/admin/MCP paths404 even forged owner headers',async()=>{const env={...base,DB:db()};for(const method of ['GET','POST'])for(const path of ['/','/mcp','/setup','/status','/receiver_drain','/receiver_ack','/api/data']){const request=new Request(base.RECEIVER_ORIGIN+path,{method,headers:{'oai-authenticated-user-id':'forged-owner','authorization':'Bearer forged','x-telegram-bot-api-secret-token':base.TELEGRAM_WEBHOOK_SECRET},...(method==='POST'?{body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'receiver_drain'}})}:{})});assert.equal((await worker.fetch(request,env)).status,404);}assert.equal((await worker.fetch(new Request(base.RECEIVER_ORIGIN+'/telegram-webhook'),env)).status,404);});
test('webhook secret+owner validation and encrypted durable queue, no outbound fetch',async()=>{const env={...base,DB:db()};assert.equal((await worker.fetch(req(update(),'wrong'),env)).status,403);assert.equal((await worker.fetch(req(update(1,99)),env)).status,200);assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM relay_queue').first()).n,0);assert.equal((await worker.fetch(req(),env)).status,200);const row=await env.DB.prepare('SELECT * FROM relay_queue').first();assert.ok(!row.sealed.includes('synthetic private content'));assert.equal(row.state,'pending');assert.equal((await worker.fetch(req(),env)).status,200);assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM relay_queue').first()).n,1);});
test('24hour cleanup on next accepted webhook removes ciphertext, retains dedup tombstone',async()=>{const env={...base,DB:db()};await worker.fetch(req(),env);await env.DB.prepare('UPDATE relay_queue SET received_at=0').run();await worker.fetch(req(update(2)),env);const row=await env.DB.prepare('SELECT * FROM relay_queue WHERE update_id=1').first();assert.equal(row.state,'expired');assert.equal(row.sealed,null);await worker.fetch(req(),env);assert.equal((await env.DB.prepare('SELECT state FROM relay_queue WHERE update_id=1').first()).state,'expired');});
test('DB failure returns non2xx so Telegram retains its retry',async()=>{const env={...base,DB:{prepare(){throw Error('private DB');}}};const r=await worker.fetch(req(),env);assert.equal(r.status,503);assert.equal(await r.text(),'Unavailable');});
test('voice metadata encrypted at rest without transcription/download',async()=>{const env={...base,DB:db()},u=update();delete u.message.text;u.message.voice={file_id:'PRIVATE_TEST_FILE_ID',file_unique_id:'test-unique',duration:3};assert.equal((await worker.fetch(req(u),env)).status,200);const row=await env.DB.prepare('SELECT sealed FROM relay_queue').first();assert.ok(!row.sealed.includes('PRIVATE_TEST_FILE_ID'));});
test('new durable owner text and voice request one initial typing action in webhook response',async()=>{const env={...base,DB:db()};const text=await worker.fetch(req(),env);assert.equal(text.headers.get('content-type'),'application/json');assert.deepEqual(await text.json(),{method:'sendChatAction',chat_id:base.TELEGRAM_OWNER_ID,action:'typing'});assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM relay_queue').first()).n,1);const voice=update(2);delete voice.message.text;voice.message.voice={file_id:'SYNTHETIC_FILE',file_unique_id:'synthetic-unique',duration:2};assert.equal((await (await worker.fetch(req(voice),env)).json()).action,'typing');});
test('duplicates, startup, unsupported, malformed voice and unauthorized updates never request typing',async()=>{const env={...base,DB:db()};await worker.fetch(req(),env);assert.equal(await (await worker.fetch(req(),env)).text(),'OK');const startup=update(2);startup.message.text='/start@synthetic_bot challenge';assert.equal(await (await worker.fetch(req(startup),env)).text(),'OK');const unsupported=update(3);delete unsupported.message.text;unsupported.message.photo=[{file_id:'synthetic'}];assert.equal(await (await worker.fetch(req(unsupported),env)).text(),'OK');const malformed=update(4);delete malformed.message.text;malformed.message.voice={};assert.equal(await (await worker.fetch(req(malformed),env)).text(),'OK');assert.equal((await worker.fetch(req(update(5),'wrong'),env)).status,403);assert.equal(await (await worker.fetch(req(update(6,99)),env)).text(),'OK');});
test('typing is not returned before durable insertion or when persistence fails',async()=>{let release;const gate=new Promise(resolve=>{release=resolve;});const underlying=db();let insertEntered;const entered=new Promise(resolve=>{insertEntered=resolve;});const env={...base,DB:{...underlying,async batch(statements){insertEntered();await gate;return underlying.batch(statements);}}};let settled=false;const pending=worker.fetch(req(),env).then(r=>{settled=true;return r;});await entered;await new Promise(resolve=>setTimeout(resolve,5));assert.equal(settled,false);release();assert.equal((await (await pending).json()).action,'typing');const failed={...base,DB:{prepare(){return{bind(){return this;},async run(){throw Error('storage failed');}};}}};const failure=await worker.fetch(req(),failed);assert.equal(failure.status,503);assert.equal(await failure.text(),'Unavailable');});

test('initial typing can be disabled without disabling durable reception',async()=>{
 const env={...base,DB:db(),INITIAL_TYPING:'false'};
 assert.equal(await (await worker.fetch(req(),env)).text(),'OK');
 assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM relay_queue').first()).n,1);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM relay_order').first()).n,1);
});

test('arrival checkpoint skips old pages, tolerates lower update IDs and retains duplicate order',async()=>{
 const env={...base,DB:db()};
 for(let id=100;id<112;id++)assert.equal((await worker.fetch(req(update(id)),env)).status,200);
 const checkpoint=(await env.DB.prepare('SELECT MAX(sequence) AS n FROM relay_order').first()).n;
 await worker.fetch(req(update(2)),env);await worker.fetch(req(update(100)),env);
 const {results}=await env.DB.prepare("SELECT o.sequence,q.update_id,q.sealed FROM relay_order o JOIN relay_queue q ON q.update_id=o.update_id WHERE o.sequence>? AND q.state='pending' AND q.sealed IS NOT NULL ORDER BY o.sequence LIMIT 10").bind(checkpoint).all();
 assert.deepEqual(results.map(r=>r.update_id),[2]);assert.ok(results[0].sequence>checkpoint);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM relay_order').first()).n,13);
 await env.DB.prepare('UPDATE relay_queue SET received_at=0 WHERE update_id=2').run();
 await worker.fetch(req(update(3)),env);
 const expired=await env.DB.prepare('SELECT q.sealed,q.state,o.sequence FROM relay_queue q JOIN relay_order o USING(update_id) WHERE q.update_id=2').first();
 assert.equal(expired.state,'expired');assert.equal(expired.sealed,null);assert.equal(expired.sequence,results[0].sequence);
});

test('queue and arrival order roll back together on sequence write failure',async()=>{
 const underlying=db(),env={...base,DB:{...underlying,batch(statements){return underlying.batch([statements[0],underlying.prepare('INSERT INTO missing_table VALUES(1)')]);}}};
 assert.equal((await worker.fetch(req(),env)).status,503);
 assert.equal((await underlying.prepare('SELECT COUNT(*) AS n FROM relay_queue').first()).n,0);
 assert.equal((await underlying.prepare('SELECT COUNT(*) AS n FROM relay_order').first()).n,0);
 assert.equal((await worker.fetch(req(),{...base,DB:underlying})).status,200);
});

test('migration backfills existing ciphertext and tombstones without changing them',()=>{
 const d=new DatabaseSync(':memory:');
 d.exec(readFileSync(new URL('../drizzle/0000_light_ego.sql',import.meta.url),'utf8'));
 d.exec("INSERT INTO relay_queue VALUES(9,'SYNTHETIC_ENVELOPE','pending',10),(2,NULL,'expired',9)");
 const before=d.prepare('SELECT * FROM relay_queue ORDER BY update_id').all();
 d.exec(readFileSync(new URL('../drizzle/0001_relay_order.sql',import.meta.url),'utf8'));
 assert.deepEqual(d.prepare('SELECT * FROM relay_queue ORDER BY update_id').all(),before);
 assert.deepEqual(d.prepare('SELECT update_id FROM relay_order ORDER BY sequence').all().map(r=>r.update_id),[2,9]);
 assert.throws(()=>d.exec('INSERT INTO relay_order(update_id) VALUES(9)'));
});
