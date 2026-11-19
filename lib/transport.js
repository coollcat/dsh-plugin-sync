// Bounded authenticated JSON transport. Redirects never forward a peer token.
import { MAX_PAYLOAD_BYTES } from './protocol.js'

export class TransportError extends Error {
  constructor(code,message) { super(message);this.code=code }
}

export function createTransport({fetchImpl=globalThis.fetch,timeoutMs=10000}={}) {
  return {async send(url,{method='POST',token,body,signal}={}) {
    let parsed
    try { parsed=new URL(url) } catch { throw new TransportError('bad-url','Invalid peer endpoint') }
    const loopback=['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)
    if(!['http:','https:'].includes(parsed.protocol) || (parsed.protocol==='http:'&&!loopback) || parsed.username || parsed.password || parsed.hash)throw new TransportError('bad-url','Use HTTPS or a loopback SSH endpoint without URL credentials')
    if(typeof token!=='string' || !/^[A-Za-z0-9_-]{1,256}$/.test(token))throw new TransportError('bad-token','Peer credential is unavailable')
    const headers={accept:'application/json',authorization:`Bearer ${token}`}
    const payload=body===undefined?undefined:JSON.stringify(body)
    if(payload!==undefined){if(Buffer.byteLength(payload)>MAX_PAYLOAD_BYTES)throw new TransportError('payload-too-large','Request exceeds protocol limit');headers['content-type']='application/json'}
    const controller=new AbortController()
    const cancel=()=>controller.abort()
    if(signal?.aborted)cancel()
    signal?.addEventListener('abort',cancel,{once:true})
    const timer=setTimeout(cancel,timeoutMs)
    try {
      const response=await fetchImpl(url,{method,headers,body:payload,signal:controller.signal,redirect:'error'})
      const length=Number(response.headers?.get?.('content-length')??0)
      if(length>MAX_PAYLOAD_BYTES)throw new TransportError('payload-too-large','Response exceeds protocol limit')
      let text
      if(response.body?.getReader){
        const reader=response.body.getReader();const chunks=[];let size=0
        try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_PAYLOAD_BYTES){await reader.cancel();throw new TransportError('payload-too-large','Response exceeds protocol limit')}chunks.push(Buffer.from(value))}text=Buffer.concat(chunks).toString('utf8')}
        finally{reader.releaseLock()}
      }else{text=await response.text();if(Buffer.byteLength(text)>MAX_PAYLOAD_BYTES)throw new TransportError('payload-too-large','Response exceeds protocol limit')}
      let data=null
      try{if(text)data=JSON.parse(text)}catch{throw new TransportError('bad-json','Peer returned invalid JSON')}
      if(!response.ok)throw new TransportError(`http-${response.status}`,'Peer rejected request')
      if(data?.error || data?.ok===false)throw new TransportError(typeof data.error==='string'&&/^[a-z0-9-]{1,80}$/.test(data.error)?data.error:'remote-error','Peer rejected sync operation')
      return data
    }catch(error){
      if(error instanceof TransportError)throw error
      throw new TransportError(controller.signal.aborted?'timeout':'network',controller.signal.aborted?'Peer request timed out':'Peer request failed')
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
  }}
}

export function bearerFrom(header) {
  if(typeof header!=='string')return null
  return /^Bearer\s+([A-Za-z0-9_-]{1,256})$/i.exec(header.trim())?.[1]??null
}
