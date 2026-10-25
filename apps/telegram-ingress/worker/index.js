const response=status=>new Response(status===200?'OK':'Unavailable',{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const encode=b=>{const bytes=new Uint8Array(b);let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text);};
async function sameSecret(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length>256||b.length<32||b.length>256)return false;const encoder=new TextEncoder();const [x,y]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(a)),crypto.subtle.digest('SHA-256',encoder.encode(b))]);const p=new Uint8Array(x),q=new Uint8Array(y);let different=0;for(let i=0;i<p.length;i++)different|=p[i]^q[i];return different===0;}
export function directOwner(update,owner){const m=update?.message;return Number.isSafeInteger(update?.update_id)&&update.update_id>=0&&m?.chat?.type==='private'&&Number.isSafeInteger(m.from?.id)&&m.from.id>0&&m.from.id===m.chat.id&&String(m.from.id)===owner&&Number.isSafeInteger(m.message_id)&&m.message_id>0&&!m.from.is_bot&&!m.forward_origin&&!m.forward_from&&!m.forward_from_chat&&!m.forward_sender_name&&!m.forward_date&&!m.sender_chat&&!m.via_bot;}
async function readBounded(request,maximum=131072){const reader=request.body?.getReader();if(!reader)throw Error('Body required');let text='',size=0;const decoder=new TextDecoder();while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maximum){await reader.cancel();throw Error('Body too large');}text+=decoder.decode(part.value,{stream:true});}return text+decoder.decode();}
async function envelopeKey(secret){if(typeof secret!=='string'||secret.length<32||secret.length>256)throw Error('Key unavailable');const encoder=new TextEncoder();const base=await crypto.subtle.importKey('raw',encoder.encode(secret),'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode('dot-telegram-relay-v1'),info:encoder.encode('envelope-aes-gcm')},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
export async function sealEnvelope(env,update){const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('telegram-relay-v1|'+update.update_id)},await envelopeKey(env.PRIVATE_INGEST_SECRET),new TextEncoder().encode(JSON.stringify(update)));return JSON.stringify({v:1,iv:encode(iv),data:encode(data)});}
async function expire(env){await env.DB.prepare("UPDATE relay_queue SET sealed=NULL,state='expired' WHERE state='pending' AND received_at<unixepoch()-86400").run();}
export async function receive(request,env){
 if(!env.DB||!env.PRIVATE_INGEST_SECRET||!/^[1-9]\d*$/.test(env.TELEGRAM_OWNER_ID||''))return response(503);
 if(!await sameSecret(request.headers.get('x-telegram-bot-api-secret-token'),env.TELEGRAM_WEBHOOK_SECRET))return response(403);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return response(415);
 try{const update=JSON.parse(await readBounded(request));if(!directOwner(update,env.TELEGRAM_OWNER_ID))return response(200);if(typeof update.message.text!=='string'&&!update.message.voice)return response(200);
  const sealed=await sealEnvelope(env,update);
  // Sequence and ciphertext commit together. Duplicate webhooks retain their order.
  const [inserted]=await env.DB.batch([
   env.DB.prepare("INSERT OR IGNORE INTO relay_queue(update_id,sealed,state) VALUES(?,?,'pending')").bind(update.update_id,sealed),
   env.DB.prepare('INSERT INTO relay_order(update_id) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM relay_order WHERE update_id=?)').bind(update.update_id,update.update_id)
  ]);
  await expire(env);
  const message=update.message;
  const startup=typeof message.text==='string'&&/^\/start(?:@\w+)?(?:\s|$)/i.test(message.text);
  const text=typeof message.text==='string'&&message.text.trim().length>0;
  const voice=message.voice&&typeof message.voice.file_id==='string'&&message.voice.file_id.length>0&&typeof message.voice.file_unique_id==='string'&&message.voice.file_unique_id.length>0&&Number.isSafeInteger(message.voice.duration)&&message.voice.duration>=0;
  // Telegram may execute one Bot API method from the webhook response. This is a
  // brief initial processing indicator, not a wake-up or a confirmed method result.
  if(env.INITIAL_TYPING!=='false'&&inserted.meta?.changes===1&&!startup&&(text||voice))return Response.json({method:'sendChatAction',chat_id:env.TELEGRAM_OWNER_ID,action:'typing'},{headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
  return response(200);
 }catch{return response(503);}
}
export default {async fetch(request,env){const url=new URL(request.url);if(request.method!=='POST'||url.pathname!=='/telegram-webhook'||url.origin!==env.RECEIVER_ORIGIN)return response(404);return receive(request,env);}};
