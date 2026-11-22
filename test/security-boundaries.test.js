import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { projectConfig, mergeConfigFields, getPath, setPath } from '../lib/config.js'
import { resourceHash, hash, validateResourceRecord } from '../lib/protocol.js'
import { createTransport } from '../lib/transport.js'
import { createSshTransport } from '../lib/ssh-transport.js'
import { exportSnapshot, parseSnapshot } from '../lib/snapshot.js'

const plugin=()=>{const record={kind:'plugin',key:'example-plugin',enabled:false,source:{type:'registry',package:'example-plugin',version:'1.0.0'}};return {...record,contentHash:resourceHash(record)}}

 test('config export includes only explicitly approved safe paths and preserves dotted array paths',()=>{
  const current={service:{url:'https://example.com',key:'fake-local-key',nested:{enabled:true,extra:7}}, 'api.secret':'private', list:[{label:'hello',password:'local'}],value:'generic unreviewed secret'}
  const safe=projectConfig(current,[['service','url'],['list','0','label']])
  assert.deepEqual(safe,{service:{url:'https://example.com'},list:[{label:'hello'}]})
  assert.equal(JSON.stringify(safe).includes('fake-local-key'),false)
  assert.equal(getPath(safe,['list','0','label']),'hello')
  const merged=mergeConfigFields(current,{service:{url:'https://new.example.com',key:'attacker',nested:{enabled:false}},list:[{label:'changed'}]},[['service'],['list','0','label']])
  assert.equal(merged.service.key,'fake-local-key');assert.equal(merged.service.nested.extra,7);assert.equal(merged.list[0].password,'local');assert.equal(merged.list[0].label,'changed');assert.equal(merged.value,current.value)
 })
 test('remote prototype paths cannot pollute objects and secret URL values are not exported',()=>{
  const polluted=JSON.parse('{"__proto__":{"isAdmin":true},"normal":1}')
  assert.equal(projectConfig(polluted,[['__proto__','isAdmin']]).isAdmin,undefined)
  assert.throws(()=>setPath({},['__proto__','x'],1),/unsafe-config/)
  assert.equal({}.isAdmin,undefined)
  const credentialUrl=new URL('https://example.com');credentialUrl.username='user';credentialUrl.password='password'
  assert.deepEqual(projectConfig({url:credentialUrl.href,endpoint:'https://example.com/?token=fake'},[['url'],['endpoint']]),{})
 })
 test('resource validation binds addresses to identities and actual payload hashes',()=>{
  const valid=plugin();assert.deepEqual(validateResourceRecord(valid),[])
  assert.ok(validateResourceRecord({...valid,source:{...valid.source,package:'@deepseek-ai/dsh'}}).length)
  assert.ok(validateResourceRecord({...valid,enabled:true}).some(x=>x.includes('Hash')))
  // The removed memory domain has no resource schema and must fail closed.
  assert.deepEqual(validateResourceRecord({kind:'memory',key:'memory:other.md',adapterId:'memory',relativePath:'note.md',content:'x',schemaVersion:1,contentHash:hash('fake')}),['unsupported resource kind'])
 })
 test('offline import revalidates records even after attacker recomputes checksum',()=>{
  const state={identity:{deviceId:'node-a',profileId:'a'},revision:{number:1,hash:'rev:1',clock:{}},expected:[plugin()],expectedConfig:[]}
  const snapshot=exportSnapshot(state);assert.equal(parseSnapshot(JSON.stringify(snapshot)).trust,'untrusted')
  snapshot.expected[0].source.package='file:/etc/passwd';const {manifest,...body}=snapshot;snapshot.manifest.digest=hash(body)
  assert.equal(parseSnapshot(JSON.stringify(snapshot)).ok,false)
  const signed=exportSnapshot(state,{secret:'test-peer-secret'});assert.equal(parseSnapshot(JSON.stringify(signed),'test-peer-secret').trust,'authenticated');assert.equal(parseSnapshot(JSON.stringify(signed)).reason,'unknown-signing-key')
 })
 test('HTTP transport rejects business errors, redirects, unsafe destinations and oversized body streams',async()=>{
  let options
  const transport=createTransport({fetchImpl:async(url,opts)=>{options=opts;return {ok:true,headers:new Headers(),text:async()=>JSON.stringify({error:'unauthorized'})}}})
  await assert.rejects(transport.send('http://127.0.0.1/state',{token:'fake-token'}),error=>error.code==='unauthorized');assert.equal(options.redirect,'error')
  // Plain HTTP to a non-loopback host is allowed for LAN pairing; the bearer token is the credential.
  await assert.rejects(transport.send('http://203.0.113.1/state',{token:'fake-token'}),error=>error.code==='unauthorized')
  await assert.rejects(transport.send('https://user@lan-host.local/state',{token:'fake-token'}),error=>error.code==='bad-url')
  const large=createTransport({fetchImpl:async()=>({ok:true,headers:new Headers({'content-length':String(600000)}),text:async()=>''})})
  await assert.rejects(large.send('http://127.0.0.1/state',{token:'fake-token'}),error=>error.code==='payload-too-large')
 })
 test('SSH uses direct TCP forwarding, complete HTTP target and no credential in local or remote argv',async()=>{
  let captured,input
  const spawnImpl=(command,args)=>{captured={command,args};const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin={end(value){input=value}};process.nextTick(()=>{const body='{"status":"ok"}';child.stdout.emit('data',Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`));child.emit('close',0)});return child}
  const ssh=createSshTransport({host:'example.com',user:'user',identityFile:'/keys/id_ed25519',spawnImpl})
  assert.equal((await ssh.send('http://127.0.0.1:3010/plugin-sync/state',{token:'fake-peer-token',body:{hello:1}})).status,'ok')
  assert.ok(captured.args.includes('-W'));assert.ok(captured.args.includes('127.0.0.1:3010'));assert.ok(captured.args.includes('StrictHostKeyChecking=accept-new'));assert.equal(captured.args.join(' ').includes('fake-peer-token'),false);assert.equal(captured.args.join(' ').includes('curl'),false);assert.match(input,/^POST \/plugin-sync\/state HTTP\/1.1/);assert.match(input,/Authorization: Bearer fake-peer-token/)
  assert.throws(()=>createSshTransport({host:'-oProxyCommand=bad',user:'user',identityFile:'/keys/id',knownHostsFile:'/keys/known'}),/invalid/)
 })
 test('SSH deadline kills the subprocess and enforces response byte limits',async()=>{
  let killed=false
  const spawnImpl=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin={end(){}};child.kill=()=>{killed=true};return child}
  const ssh=createSshTransport({host:'example.com',user:'user',identityFile:'/keys/id',knownHostsFile:'/keys/known',timeoutMs:20,spawnImpl})
  await assert.rejects(ssh.send('http://127.0.0.1/state',{token:'fake-token'}),error=>error.code==='timeout');assert.equal(killed,true)
 })
