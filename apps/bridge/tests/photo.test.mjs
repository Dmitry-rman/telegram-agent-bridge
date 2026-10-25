import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{Repo,SQL,reply,replyPhoto,sendTyping,keepTyping} from '../worker/index.js';

// Synthetic one-pixel PNG, never user media.
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1cAAAAASUVORK5CYII=';
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 sqlite.exec("INSERT INTO inbox(update_id,message_id,chat_id,text) VALUES(1,11,'42','synthetic'),(2,12,'99','foreign')");
 const DB={prepare(sql){let args=[];return {
  bind(...values){args=values;return this;},
  async first(){return sqlite.prepare(sql).get(...args)??null;},
  async all(){return {results:sqlite.prepare(sql).all(...args)};},
  execute(){return {meta:{changes:sqlite.prepare(sql).run(...args).changes}};},
  async run(){return this.execute();}
 };},async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(s=>s.execute());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const env={DB,TELEGRAM_BOT_TOKEN:'123:SYNTHETIC_TOKEN',TELEGRAM_OWNER_ID:'42',SITE_OWNER_ID:'synthetic-owner'};
 const args={update_id:1,mime_type:'image/png',photo_base64:png,caption:'Synthetic caption'};
 const call=async(name,values=args,owner=env.SITE_OWNER_ID)=>{
  const request=new Request('https://bridge.example.invalid/mcp',{method:'POST',headers:{'oai-authenticated-user-id':owner},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:values}})});
  return (await worker.fetch(request,env)).json();
 };
 return {sqlite,env,args,repo:new Repo(DB),call};
}
const value=response=>JSON.parse(response.result.content[0].text);

test('photo reply uploads exact bytes only to paired owner and stores digest without payload',async()=>{
 const f=fixture();let calls=0;
 const api=async(env,method,form)=>{
  calls++;assert.equal(method,'sendPhoto');assert.ok(form instanceof FormData);
  assert.equal(form.get('chat_id'),'42');assert.deepEqual(JSON.parse(form.get('reply_parameters')),{message_id:11});
  assert.equal(form.get('caption'),f.args.caption);assert.equal(form.get('parse_mode'),null);
  const image=form.get('photo');assert.equal(image.name,'image.png');assert.equal(image.type,'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()),Buffer.from(png,'base64'));
  assert.equal((await f.repo.first(SQL.outgoing,1)).state,'sending');return {message_id:81};
 };
 assert.deepEqual(await replyPhoto(f.env,f.repo,{...f.args,chat_id:'99',photo_url:'https://untrusted.example.invalid'},api),{state:'sent',message_id:81});
 assert.equal((await replyPhoto(f.env,f.repo,f.args,api)).state,'sent');assert.equal(calls,1);
 const row=await f.repo.first(SQL.outgoing,1);assert.equal(row.kind,'photo');assert.match(row.text,/^[0-9a-f]{64}$/);
 assert.ok(!JSON.stringify(row).includes(png));assert.ok(!JSON.stringify(row).includes(f.args.caption));
});

test('MCP exposes and sends multipart photo with safe diagnostics and no content-type override',async()=>{
 const f=fixture(),oldFetch=globalThis.fetch,oldLog=console.log,logs=[];let calls=0;
 f.env.TRANSPORT_DIAGNOSTICS='true';
 globalThis.fetch=async(url,options)=>{
  calls++;assert.equal(url,'https://api.telegram.org/bot123:SYNTHETIC_TOKEN/sendPhoto');
  assert.deepEqual(options.headers,{});assert.equal(options.redirect,'manual');assert.ok(options.signal);
  // Exercise Fetch's multipart encoder and parser, including its generated boundary.
  const encoded=new Request(url,options);assert.match(encoded.headers.get('content-type'),/^multipart\/form-data; boundary=/);
  const decoded=await encoded.formData();assert.deepEqual(Buffer.from(await decoded.get('photo').arrayBuffer()),Buffer.from(png,'base64'));
  return Response.json({ok:true,result:{message_id:82}});
 };
 console.log=line=>logs.push(JSON.parse(line));
 try{
  const discovery=await (await worker.fetch(new Request('https://bridge.example.invalid/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:0,method:'tools/list'})}),f.env)).json();
  const schema=discovery.result.tools.find(t=>t.name==='send_photo_reply').inputSchema;
  assert.ok(schema.required.includes('photo_base64'));assert.equal(schema.additionalProperties,false);
  assert.equal(schema.properties.photo_base64.maxLength,6666668);
  const result=value(await f.call('send_photo_reply'));assert.equal(result.state,'sent');assert.equal(calls,1);
  const end=result.transport_diagnostics.events.find(e=>e.event==='telegram_http_end');assert.equal(end.method,'sendPhoto');assert.equal(end.outcome,'ok');
  for(const secret of [png,f.args.caption,f.env.TELEGRAM_BOT_TOKEN,f.env.SITE_OWNER_ID])assert.ok(!JSON.stringify(logs).includes(secret));
  assert.ok(!JSON.stringify(result).includes(png));
 }finally{globalThis.fetch=oldFetch;console.log=oldLog;}
});

test('foreign callers and unknown/foreign messages cannot upload or reserve a photo',async()=>{
 const f=fixture(),old=globalThis.fetch;globalThis.fetch=async()=>assert.fail('No network');
 try{
  for(const owner of ['','other-owner'])assert.equal((await f.call('send_photo_reply',f.args,owner)).result.isError,true);
  for(const update_id of [2,999])await assert.rejects(replyPhoto(f.env,f.repo,{...f.args,update_id},async()=>assert.fail()),/Unknown authorized/);
  assert.equal((await f.repo.first('SELECT COUNT(*) AS n FROM outbox')).n,0);
 }finally{globalThis.fetch=old;}
});

test('invalid base64, MIME, sizes, caption and headers fail before reservation',async()=>{
 const f=fixture();
 const variants=[
  {photo_base64:''},{photo_base64:'abcd\n==='},{photo_base64:'===='},{photo_base64:'AB=='},
  {photo_base64:'https://image.example.invalid/file.png'},{photo_base64:'/tmp/synthetic.png'},
  {photo_base64:'data:image/png;base64,'+png},{photo_base64:'A'.repeat(6666672)},
  {photo_base64:Buffer.alloc(5000001).toString('base64')},{photo_base64:Buffer.from('<svg/>').toString('base64')},
  {mime_type:'image/svg+xml'},{mime_type:'image/jpeg'},{caption:'a'.repeat(1025)},{caption:42},{update_id:-1},{update_id:1.5}
 ];
 for(const patch of variants)await assert.rejects(replyPhoto(f.env,f.repo,{...f.args,...patch},async()=>assert.fail('No send')));
 assert.equal((await f.repo.first('SELECT COUNT(*) AS n FROM outbox')).n,0);
 const error=await f.call('send_photo_reply',{...f.args,photo_base64:'PRIVATE_INVALID_PAYLOAD'});
 assert.equal(error.result.isError,true);assert.ok(!JSON.stringify(error).includes('PRIVATE_INVALID_PAYLOAD'));
});

test('photo dimensions enforce positive sizes, sum and aspect ratio before Telegram',async()=>{
 const f=fixture();
 for(const [width,height] of [[0,1],[1,0],[5001,5000],[21,1]]){
  const bytes=Buffer.from(png,'base64');bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);
  await assert.rejects(replyPhoto(f.env,f.repo,{...f.args,photo_base64:bytes.toString('base64')},async()=>assert.fail()),/dimensions/);
 }
 assert.equal((await f.repo.first('SELECT COUNT(*) AS n FROM outbox')).n,0);
});

test('JPEG header parser handles metadata segments and rejects truncation without decoding pixels',async()=>{
 // Synthetic JPEG header fixture, not a claim of decodable pixel data.
 const header=Buffer.from([255,216,255,224,0,4,0,0,255,192,0,8,8,0,1,0,1,0,255,217]);
 const f=fixture();let calls=0;
 const api=async(e,m,form)=>{calls++;assert.equal(form.get('photo').name,'image.jpg');assert.equal(form.get('photo').type,'image/jpeg');assert.equal(form.get('caption'),null);return {message_id:83};};
 assert.equal((await replyPhoto(f.env,f.repo,{...f.args,mime_type:'image/jpeg',photo_base64:header.toString('base64'),caption:undefined},api)).state,'sent');
 for(const bytes of [header.subarray(0,12),Buffer.from([255,216,255,224,255,255,255,217]),Buffer.from([255,216,255,218,255,217])]){
  const fresh=fixture();await assert.rejects(replyPhoto(fresh.env,fresh.repo,{...fresh.args,mime_type:'image/jpeg',photo_base64:bytes.toString('base64')},api));
 }
 assert.equal(calls,1);
});

test('photo failures stay uncertain and identical retries never send again',async()=>{
 for(const api of [async()=>{throw Error('PRIVATE_UPSTREAM_URL_TOKEN');},async()=>({}),async()=>({message_id:'bad'})]){
  const f=fixture();let calls=0;const wrapped=async(...a)=>{calls++;return api(...a);};
  const first=await replyPhoto(f.env,f.repo,f.args,wrapped);assert.equal(first.state,'uncertain');
  assert.ok(!JSON.stringify(first).includes('PRIVATE_UPSTREAM'));
  assert.equal((await replyPhoto(f.env,f.repo,f.args,wrapped)).state,'uncertain');assert.equal(calls,1);
 }
});

test('HTTP rejection, rate limit, bad JSON and network failure do not cause an automatic photo retry',async()=>{
 for(const fetcher of [async()=>Response.json({ok:false},{status:403}),async()=>Response.json({ok:false,error_code:429,parameters:{retry_after:2}},{status:429}),async()=>new Response('bad-json'),async()=>{throw Error('PRIVATE_UPSTREAM');}]){
  const f=fixture(),old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return fetcher();};
  try{assert.equal(value(await f.call('send_photo_reply')).state,'uncertain');assert.equal(value(await f.call('send_photo_reply')).state,'uncertain');assert.equal(calls,1);}
  finally{globalThis.fetch=old;}
 }
});

test('text and photo share one reservation; changed caption or image cannot bypass it',async()=>{
 const f=fixture();await replyPhoto(f.env,f.repo,f.args,async()=>({message_id:84}));
 await assert.rejects(reply(f.env,f.repo,{update_id:1,text:(await f.repo.first(SQL.outgoing,1)).text},async()=>assert.fail()),/different text/);
 await assert.rejects(replyPhoto(f.env,f.repo,{...f.args,caption:'changed'},async()=>assert.fail()),/different content/);
 const changed=Buffer.from(png,'base64');changed[changed.length-1]^=1;
 await assert.rejects(replyPhoto(f.env,f.repo,{...f.args,photo_base64:changed.toString('base64')},async()=>assert.fail()),/different content/);
 const other=fixture();await reply(other.env,other.repo,{update_id:1,text:'text reply'},async()=>({message_id:85}));
 await assert.rejects(replyPhoto(other.env,other.repo,other.args,async()=>assert.fail()),/different content/);
});

test('failed sent-state persistence preserves an uncertain photo reservation without resending',async()=>{
 const f=fixture(),run=f.repo.run.bind(f.repo);let calls=0,failed=false;
 f.repo.run=async(sql,...args)=>{
  if(sql===SQL.status&&args[0]==='sent'&&!failed){failed=true;throw Error('Synthetic database failure');}
  return run(sql,...args);
 };
 const api=async()=>{calls++;return {message_id:87};};
 assert.equal((await replyPhoto(f.env,f.repo,f.args,api)).state,'uncertain');
 assert.equal((await f.repo.first(SQL.outgoing,1)).state,'uncertain');
 assert.equal((await replyPhoto(f.env,f.repo,f.args,api)).state,'uncertain');assert.equal(calls,1);
});

test('missing photo migration prevents upload without altering legacy text reply behavior',async()=>{
 const f=fixture();f.sqlite.exec('ALTER TABLE outbox DROP COLUMN kind');
 await assert.rejects(replyPhoto(f.env,f.repo,f.args,async()=>assert.fail('No upload before migration')));
 assert.equal((await f.repo.first('SELECT COUNT(*) AS n FROM outbox')).n,0);
 assert.equal((await reply(f.env,f.repo,{update_id:1,text:'legacy'},async()=>({message_id:88}))).state,'sent');
 assert.equal((await reply(f.env,f.repo,{update_id:1,text:'legacy'},async()=>assert.fail('No repeat'))).state,'sent');
});

test('in-flight duplicate and text races send only one reply and stop typing',async()=>{
 const f=fixture();let release,started,calls=0;
 const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
 const api=async()=>{calls++;started();await gate;return {message_id:86};};
 const pending=replyPhoto(f.env,f.repo,f.args,api);await entered;
 assert.equal((await replyPhoto(f.env,f.repo,f.args,api)).state,'sending');
 await assert.rejects(reply(f.env,f.repo,{update_id:1,text:'race'},api),/different text/);
 const noTyping=async()=>assert.fail('No chat action after photo reservation');
 assert.equal((await sendTyping(f.env,f.repo,{update_id:1},noTyping)).typing,false);
 assert.equal((await keepTyping(f.env,f.repo,{update_id:1},noTyping)).reason,'reply_attempted');
 release();assert.equal((await pending).state,'sent');assert.equal(calls,1);
 assert.deepEqual(await f.repo.pendingImported([1],'42'),[]);
});

test('photo migration retains existing text attempts and upgrades fresh schemas consistently',()=>{
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['0000_free_saracen','0001_youthful_madrox','0002_superb_sway','0003_melted_hydra','0004_bored_cerebro'])sqlite.exec(readFileSync(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8'));
 sqlite.exec("INSERT INTO inbox(update_id,message_id,chat_id,text) VALUES(1,11,'42','synthetic'); INSERT INTO outbox(update_id,text,state,telegram_message_id) VALUES(1,'previous','uncertain',NULL)");
 sqlite.exec(readFileSync(new URL('../drizzle/0005_photo_reply.sql',import.meta.url),'utf8'));
 assert.deepEqual({...sqlite.prepare('SELECT * FROM outbox').get()},{update_id:1,text:'previous',state:'uncertain',telegram_message_id:null,kind:'text'});
 // Legacy fresh SQL omits explicit NOT NULL on INTEGER PRIMARY KEY; normalize that spelling.
 const columns=db=>db.prepare('PRAGMA table_info(outbox)').all().map(r=>[r.name,r.type,r.notnull||r.pk,r.dflt_value,r.pk]);
 assert.deepEqual(columns(sqlite),columns(fixture().sqlite));
});
