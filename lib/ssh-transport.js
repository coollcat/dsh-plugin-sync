// SSH direct TCP forwarding. No remote shell or curl process is involved:
// the bearer header is written into the encrypted stream through stdin.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { MAX_PAYLOAD_BYTES } from './protocol.js'
import { TransportError } from './transport.js'

const METHODS = new Set(['POST','GET','HEAD'])
const MAX_HEADERS = 16 * 1024
const MAX_WIRE = MAX_PAYLOAD_BYTES * 2 + MAX_HEADERS
function boundedPort(value) { return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 65535 }
function decodeChunked(buffer) {
  const chunks=[]; let cursor=0, bytes=0
  for (;;) {
    const end=buffer.indexOf('\r\n',cursor)
    if(end<0) throw new TransportError('bad-http','Incomplete chunk header')
    const sizeText=buffer.subarray(cursor,end).toString('ascii').split(';')[0]
    if(!/^[0-9a-f]+$/i.test(sizeText)) throw new TransportError('bad-http','Invalid chunk size')
    const size=parseInt(sizeText,16); cursor=end+2
    if(size===0) break
    bytes+=size
    if(bytes>MAX_PAYLOAD_BYTES || cursor+size+2>buffer.length) throw new TransportError('payload-too-large','Invalid response size')
    if(buffer[cursor+size]!==13 || buffer[cursor+size+1]!==10) throw new TransportError('bad-http','Invalid chunk terminator')
    chunks.push(buffer.subarray(cursor,cursor+size)); cursor+=size+2
  }
  return Buffer.concat(chunks)
}
function parseResponse(buffer) {
  const separator=buffer.indexOf('\r\n\r\n')
  if(separator<0 || separator>MAX_HEADERS) throw new TransportError('bad-http','Invalid response headers')
  const lines=buffer.subarray(0,separator).toString('latin1').split('\r\n')
  const status=/^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(lines.shift())
  if(!status) throw new TransportError('bad-http','Invalid response status')
  const headers={}
  for(const line of lines) { const index=line.indexOf(':'); if(index<1) throw new TransportError('bad-http','Invalid response header'); headers[line.slice(0,index).toLowerCase()]=line.slice(index+1).trim() }
  let body=buffer.subarray(separator+4)
  if(headers['transfer-encoding']) {
    if(headers['transfer-encoding'].toLowerCase()!=='chunked') throw new TransportError('bad-http','Unsupported transfer encoding')
    body=decodeChunked(body)
  } else if(headers['content-length']!==undefined && (!/^\d+$/.test(headers['content-length']) || Number(headers['content-length'])!==body.length)) {
    throw new TransportError('bad-http','Incomplete response')
  }
  if(body.length>MAX_PAYLOAD_BYTES) throw new TransportError('payload-too-large','Response exceeds protocol limit')
  let data;try{data=body.length?JSON.parse(body.toString('utf8')):null}catch{throw new TransportError('bad-json','Endpoint returned invalid JSON')}
  if(Number(status[1])<200 || Number(status[1])>=300) throw new TransportError(`http-${status[1]}`, 'Remote endpoint rejected request')
  if(data?.error || data?.ok===false) throw new TransportError(data.error??'remote-error','Remote sync rejected request')
  return data
}

export function createSshTransport({host,port=22,user,identityFile,knownHostsFile,timeoutMs=15000,spawnImpl=spawn}={}) {
  if(typeof host!=='string' || !/^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/.test(host) || typeof user!=='string' || !/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(user)) throw new Error('invalid-ssh-host-or-user')
  if(!boundedPort(port)) throw new Error('invalid-ssh-port')
  if(![identityFile,knownHostsFile].every(value=>typeof value==='string' && path.isAbsolute(value) && !/[\r\n\0]/.test(value))) throw new Error('ssh-requires-absolute-identity-and-known-hosts-paths')
  if(!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>120000)throw new Error('invalid-ssh-timeout')
  return {async send(url,{method='POST',token,body,signal}={}) {
    if(!METHODS.has(method)) throw new Error('ssh-transport-method-not-allowed')
    const parsed=new URL(url)
    if(parsed.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(parsed.hostname) || parsed.username || parsed.password) throw new Error('ssh-transport-only-for-loopback-endpoints')
    if(parsed.hash || /[\r\n\0]/.test(parsed.pathname+parsed.search))throw new Error('unsafe-remote-path')
    const remotePort=Number(parsed.port||80)
    if(!boundedPort(remotePort))throw new Error('invalid-remote-port')
    if(typeof token!=='string' || !/^[A-Za-z0-9_-]{1,256}$/.test(token)) throw new Error('invalid-peer-token')
    const payload=body===undefined?'':JSON.stringify(body)
    if(Buffer.byteLength(payload)>MAX_PAYLOAD_BYTES)throw new TransportError('payload-too-large','Request exceeds protocol limit')
    if(signal?.aborted)throw new TransportError('aborted','Request cancelled')
    const args=['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',`UserKnownHostsFile=${knownHostsFile}`,'-o',`ConnectTimeout=${Math.max(1,Math.ceil(timeoutMs/1000))}`,'-o','ExitOnForwardFailure=yes','-i',identityFile,'-p',String(port),'-W',`127.0.0.1:${remotePort}`,'--',`${user}@${host}`]
    const request=`${method} ${parsed.pathname}${parsed.search} HTTP/1.1\r\nHost: 127.0.0.1:${remotePort}\r\nAuthorization: Bearer ${token}\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(payload)}\r\nConnection: close\r\n\r\n${payload}`
    return await new Promise((resolve,reject)=>{
      const child=spawnImpl('ssh',args,{stdio:['pipe','pipe','pipe']})
      const chunks=[];let bytes=0,finished=false
      const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value)}
      const abort=()=>{child.kill?.('SIGKILL');finish(new TransportError('aborted','Request cancelled'))}
      const timer=setTimeout(()=>{child.kill?.('SIGKILL');finish(new TransportError('timeout','SSH request timed out'))},timeoutMs)
      signal?.addEventListener('abort',abort,{once:true})
      child.stdout.on('data',chunk=>{const data=Buffer.from(chunk);bytes+=data.length;if(bytes>MAX_WIRE){child.kill?.('SIGKILL');finish(new TransportError('payload-too-large','Response exceeds protocol limit'))}else chunks.push(data)})
      // Do not return ssh stderr: paths, banners and remote diagnostics may be private.
      child.stderr.on('data',()=>{})
      child.on('error',()=>finish(new TransportError('network','Unable to start SSH client')))
      child.stdin.on?.('error',()=>finish(new TransportError('network','SSH stream closed')))
      child.on('close',code=>{if(finished)return;if(code!==0){finish(new TransportError('ssh-failed',`SSH exited with status ${code}`));return}try{finish(null,parseResponse(Buffer.concat(chunks)))}catch(error){finish(error)}})
      child.stdin.end(request)
    })
  }}
}
