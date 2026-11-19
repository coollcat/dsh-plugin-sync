// A bounded local audit with monotonic sequence numbers across reloads.
const SECRET_KEYS=/(token|secret|password|passwd|pwd|authorization|auth|cookie|apikey|privatekey|accesskey|mac|credential|session|salt)/i
const BODY_KEYS=new Set(['content','snippet','config','payload'])
export function redact(value){
  if(value===null||value===undefined)return value
  if(Array.isArray(value))return value.map(redact)
  if(typeof value!=='object')return typeof value==='string'&&value.length>500?`${value.slice(0,500)}…`:value
  return Object.fromEntries(Object.entries(value).filter(([key])=>!['__proto__','prototype','constructor'].includes(key)).map(([key,item])=>[key,SECRET_KEYS.test(key.replace(/[-_.]/g,''))||BODY_KEYS.has(key)?'[redacted]':redact(item)]))
}
export function createAudit({now=()=>new Date().toISOString(),sink=null,limit=2000}={}){
  let entries=[],sequence=0
  return {
    entries:()=>structuredClone(entries),
    append(event){const entry={...redact(event),seq:++sequence,at:now()};entries.push(entry);if(entries.length>limit)entries.splice(0,entries.length-limit);sink?.write(entry);return entry},
    replaceLoaded(list){
      if(!Array.isArray(list))throw new Error('invalid-audit')
      sequence=0
      for(const entry of list){if(!Number.isSafeInteger(entry?.seq)||entry.seq<=sequence)throw new Error('invalid-audit-sequence');sequence=entry.seq}
      entries=list.slice(-limit).map(redact)
    },
  }
}
