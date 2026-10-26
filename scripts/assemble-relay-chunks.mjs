// Native authenticated database pages only. No HTTP, credentials, plaintext or decryption.
export function assembleRelayChunks(pages, updateId){
 if(!Number.isSafeInteger(updateId)||updateId<0||!Array.isArray(pages)||!pages.length)throw Error('Invalid chunk request');
 const parts=new Map();let expected=null,total=null;
 for(const page of pages){
  const p=page?.model_projection;
  if(!p||p.truncated!==false||p.truncated_values!==0||p.omitted_rows!==0||p.omitted_columns!==0||!Array.isArray(page.rows))throw Error('Incomplete native database projection');
  for(const row of page.rows){
   if(row.update_id!==updateId)continue;
   const {part_index:i,part_count:n,total_length:length,sealed_part:part}=row;
   if(!Number.isSafeInteger(n)||n<1||n>200||!Number.isSafeInteger(length)||length<1||length>200000||n!==Math.ceil(length/1000)||!Number.isSafeInteger(i)||i<0||i>=n||typeof part!=='string'||!/^[\x20-\x7e]+$/.test(part)||part.length!==Math.min(1000,length-i*1000))throw Error('Malformed ciphertext chunk');
   if(parts.has(i))throw Error('Duplicate ciphertext chunk');
   if(expected!==null&&(expected!==n||total!==length))throw Error('Inconsistent ciphertext chunks');
   expected=n;total=length;parts.set(i,part);
  }
 }
 if(expected===null||parts.size!==expected)throw Error('Missing ciphertext chunks');
 const sealed=Array.from({length:expected},(_,i)=>{if(!parts.has(i))throw Error('Missing ciphertext chunk');return parts.get(i);}).join('');
 if(sealed.length!==total)throw Error('Ciphertext length mismatch');
 // The unchanged private importer must authenticate/decrypt this exact envelope.
 return {update_id:updateId,sealed};
}
