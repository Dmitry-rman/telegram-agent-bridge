import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.js';
import {sealEnvelope} from '../../telegram-ingress/worker/index.js';

function fixture(enabled='true'){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 sqlite.exec("INSERT INTO inbox(update_id,message_id,chat_id,text) VALUES(1,11,'42','PRIVATE_INCOMING_TEXT'),(2,12,'42','PRIVATE_OTHER_TEXT')");
 const DB={prepare(sql){let args=[];return {
  bind(...a){args=a;return this;},
  async first(){return sqlite.prepare(sql).get(...args)??null;},
  async all(){return {results:sqlite.prepare(sql).all(...args)};},
  execute(){return {meta:{changes:sqlite.prepare(sql).run(...args).changes}};},
  async run(){return this.execute();}
 };},async batch(statements){sqlite.exec('BEGIN');try{const out=statements.map(statement=>statement.execute());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const env={DB,TELEGRAM_BOT_TOKEN:'123:PRIVATE_TEST_TOKEN',TELEGRAM_OWNER_ID:'42',SITE_OWNER_ID:'PRIVATE_TEST_OWNER',SITE_ORIGIN:'https://private.example.invalid',PRIVATE_INGEST_SECRET:'synthetic-private-relay-key-with-32-characters',TRANSPORT_DIAGNOSTICS:enabled};
 const call=async(name,args={},options={})=>{
  const request=new Request(env.SITE_ORIGIN+'/mcp',{method:'POST',headers:{'oai-authenticated-user-id':options.owner??env.SITE_OWNER_ID},body:JSON.stringify({jsonrpc:'2.0',id:'PRIVATE_RPC_ID',method:'tools/call',params:{name,arguments:args}})});
  return (await worker.fetch(request,env,options.ctx)).json();
 };
 return {env,sqlite,call};
}
const payload=response=>JSON.parse(response.result.content[0].text);
function privacy(value){
 const text=JSON.stringify(value);
 for(const marker of ['PRIVATE_TEST_TOKEN','PRIVATE_TEST_OWNER','PRIVATE_INCOMING_TEXT','PRIVATE_OTHER_TEXT','PRIVATE_REPLY_TEXT','PRIVATE_RPC_ID','PRIVATE_UPSTREAM_ERROR','private.example.invalid','synthetic-private-relay-key'])assert.ok(!text.includes(marker),marker);
 for(const key of ['chat_id','update_id','message_id','token','url','body','arguments'])assert.ok(!text.includes('"'+key+'":'),key);
}
async function captured(fetcher,action){
 const originalFetch=globalThis.fetch,originalLog=console.log,logs=[];
 globalThis.fetch=fetcher;console.log=value=>logs.push(JSON.parse(value));
 try{await action(logs);}finally{globalThis.fetch=originalFetch;console.log=originalLog;}
}

test('diagnostics are opt-in and cannot be enabled by tool arguments or foreign callers',async()=>{
 await captured(async()=>Response.json({ok:true,result:{message_id:99}}),async logs=>{
  for(const flag of [undefined,'false','TRUE']){
   const f=fixture('false');f.env.TRANSPORT_DIAGNOSTICS=flag;
   const result=payload(await f.call('send_reply',{update_id:1,text:'PRIVATE_REPLY_TEXT',TRANSPORT_DIAGNOSTICS:true}));
   assert.equal(result.state,'sent');assert.equal(result.transport_diagnostics,undefined);
  }
  const f=fixture();const denied=await f.call('send_reply',{update_id:1,text:'PRIVATE_REPLY_TEXT'},{owner:'foreign'});
  assert.equal(denied.result.isError,true);assert.equal(denied.result.content.length,1);
  assert.deepEqual(logs,[]);
 });
});

test('reply trace separates fetch start, headers, full body and durable sent state without secrets',async()=>{
 let releaseFetch,releaseBody,notifyStart,notifyBody;
 const started=new Promise(resolve=>{notifyStart=resolve;}),bodyStarted=new Promise(resolve=>{notifyBody=resolve;});
 const fetchGate=new Promise(resolve=>{releaseFetch=resolve;}),bodyGate=new Promise(resolve=>{releaseBody=resolve;});
 await captured(async()=>{notifyStart();await fetchGate;return {status:200,ok:true,json:async()=>{notifyBody();await bodyGate;return {ok:true,result:{message_id:99}};}};},async logs=>{
  const f=fixture(),pending=f.call('send_reply',{update_id:1,text:'PRIVATE_REPLY_TEXT'});
  await started;
  assert.ok(logs.some(e=>e.event==='telegram_http_start'));
  assert.ok(!logs.some(e=>e.event==='telegram_http_headers'));
  releaseFetch();await bodyStarted;
  assert.ok(logs.some(e=>e.event==='telegram_http_headers'));
  assert.ok(!logs.some(e=>e.event==='telegram_http_end'));
  releaseBody();const result=payload(await pending),trace=result.transport_diagnostics;
  assert.equal(result.state,'sent');
  assert.deepEqual(trace.events.map(e=>e.event),['handler_start','reply_reserved','telegram_http_start','telegram_http_headers','telegram_http_end','reply_state_saved','handler_end']);
  const end=trace.events.find(e=>e.event==='telegram_http_end');
  assert.equal(end.method,'sendMessage');assert.equal(end.http_status,200);assert.equal(end.outcome,'ok');assert.ok(end.duration_ms>=0);
  assert.ok(Number.isInteger(trace.handler_started_at_ms));assert.ok(trace.handler_elapsed_ms>=0);
  assert.ok(logs.every(e=>e.trace_id===trace.trace_id));privacy(logs);privacy(trace);
  const repeated=payload(await f.call('send_reply',{update_id:1,text:'PRIVATE_REPLY_TEXT'}));
  assert.equal(repeated.state,'sent');assert.ok(!repeated.transport_diagnostics.events.some(e=>e.event==='telegram_http_start'));
 });
});

test('network, JSON, rate-limit and HTTP errors get safe outcomes and never retry uncertain replies',async()=>{
 const cases=[
  ['fetch_error',null,async()=>{throw Error('PRIVATE_UPSTREAM_ERROR');}],
  ['invalid_response',200,async()=>new Response('PRIVATE_UPSTREAM_ERROR')],
  ['rate_limited',429,async()=>Response.json({ok:false,error_code:429,description:'PRIVATE_UPSTREAM_ERROR',parameters:{retry_after:9}},{status:429})],
  ['not_confirmed',403,async()=>Response.json({ok:false,description:'PRIVATE_UPSTREAM_ERROR'},{status:403})]
 ];
 for(const [outcome,status,fetcher]of cases){let calls=0;
  await captured(async()=>{calls++;return fetcher();},async logs=>{
   const f=fixture();
   const first=payload(await f.call('send_reply',{update_id:1,text:'PRIVATE_REPLY_TEXT'}));
   assert.equal(first.state,'uncertain');
   const end=first.transport_diagnostics.events.find(e=>e.event==='telegram_http_end');
   assert.equal(end.outcome,outcome);assert.equal(end.http_status,status);
   assert.equal(payload(await f.call('send_reply',{update_id:1,text:'PRIVATE_REPLY_TEXT'})).state,'uncertain');
   assert.equal(calls,1);privacy(logs);privacy(first.transport_diagnostics);
  });
 }
});

test('background typing logs after import response retain its trace ID and expose actual termination',async()=>{
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 await captured(async()=>{await gate;return Response.json({ok:false,error_code:429,description:'PRIVATE_UPSTREAM_ERROR',parameters:{retry_after:9}},{status:429});},async logs=>{
  const f=fixture(),tasks=[];f.env.TYPING_ON_IMPORT='true';
  const update={update_id:3,message:{message_id:13,chat:{id:42,type:'private'},from:{id:42},text:'PRIVATE_INCOMING_TEXT'}};
  const result=payload(await f.call('import_relay_envelopes',{envelopes:[{update_id:3,sealed:await sealEnvelope(f.env,update)}]},{ctx:{waitUntil(p){tasks.push(p);}}}));
  assert.equal(result.typing.scheduled,true);
  const trace=result.transport_diagnostics;
  assert.ok(!trace.events.some(e=>e.event==='typing_background_end'));
  release();await Promise.all(tasks);
  assert.ok(logs.some(e=>e.event==='telegram_http_end'&&e.method==='sendChatAction'&&e.outcome==='rate_limited'));
  assert.ok(logs.some(e=>e.event==='typing_run_end'&&e.reason==='rate_limited'));
  assert.equal(logs.at(-1).event,'typing_background_end');
  assert.ok(logs.every(e=>e.trace_id===trace.trace_id));privacy(logs);privacy(trace);
 });
});

test('concurrent requests sharing an environment have separate trace IDs and request counters',async()=>{
 await captured(async()=>Response.json({ok:true,result:true}),async logs=>{
  const f=fixture();const results=await Promise.all([1,2].map(id=>f.call('send_typing',{update_id:id}).then(payload)));
  const traces=results.map(r=>r.transport_diagnostics);assert.notEqual(traces[0].trace_id,traces[1].trace_id);
  for(const trace of traces){assert.equal(trace.events.filter(e=>e.event==='telegram_http_start').length,1);assert.equal(trace.events.find(e=>e.event==='telegram_http_start').request_id,1);}
  privacy(logs);
 });
});

test('tool errors retain original content and append a diagnostic block only for the owner',async()=>{
 await captured(async()=>{assert.fail('No network request expected');},async logs=>{
  const f=fixture(),response=await f.call('send_reply',{update_id:999,text:'PRIVATE_REPLY_TEXT'});
  assert.equal(response.result.isError,true);assert.equal(response.result.content[0].text,'Unknown authorized incoming message');
  const trace=JSON.parse(response.result.content[1].text).transport_diagnostics;
  assert.equal(trace.events.at(-1).outcome,'error');privacy(trace);privacy(logs);
 });
});

test('logging failure cannot turn a successful reply into uncertain delivery',async()=>{
 const originalFetch=globalThis.fetch,originalLog=console.log;
 globalThis.fetch=async()=>Response.json({ok:true,result:{message_id:99}});
 console.log=()=>{throw Error('Synthetic log failure');};
 try{const f=fixture(),result=payload(await f.call('send_reply',{update_id:1,text:'PRIVATE_REPLY_TEXT'}));assert.equal(result.state,'sent');assert.equal(f.sqlite.prepare('SELECT state FROM outbox WHERE update_id=1').get().state,'sent');}
 finally{globalThis.fetch=originalFetch;console.log=originalLog;}
});
