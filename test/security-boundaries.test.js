import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { projectConfig, mergeConfigFields, getPath, setPath } from '../lib/config.js'
import { resourceHash, hash, validateResourceRecord } from '../lib/protocol.js'
import { createTransport } from '../lib/transport.js'
import { createSshTransport } from '../lib/ssh-transport.js'
import { exportSnapshot, parseSnapshot } from '../lib/snapshot.js'
import { collectMemory, writeMemory } from '../lib/memory.js'

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'sync-boundary-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const adapters=[{id:'memory',root:path.join(root,'memory'),extensions:['.md','.json'],maxBytes:4096}];fs.mkdirSync(adapters[0].root);return {root,adapters,dir:adapters[0].root}}
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
 test('owner sidecar symlink cannot mutate data or outside target',t=>{
  const {root,adapters,dir}=fixture(t);fs.writeFileSync(path.join(dir,'note.md'),'local');const outside=path.join(root,'outside');fs.writeFileSync(outside,'owner-value');fs.symlinkSync(outside,path.join(dir,'note.md.owner'))
  assert.throws(()=>writeMemory({home:root,adapters,adapterId:'memory',relativePath:'note.md',content:'remote',owner:'p'}),/symlink/)
  assert.equal(fs.readFileSync(outside,'utf8'),'owner-value');assert.equal(fs.readFileSync(path.join(dir,'note.md'),'utf8'),'local')
 })
 test('adapter root symlink cannot be read or written; missing scans create no root',t=>{
  const {root,adapters}=fixture(t);const outside=path.join(root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'private.md'),'hidden');const aliased=[{...adapters[0],root:path.join(root,'alias')}];fs.symlinkSync(outside,aliased[0].root)
  assert.equal(collectMemory({home:root,adapters:aliased}).records.length,0)
  assert.throws(()=>writeMemory({home:root,adapters:aliased,adapterId:'memory',relativePath:'x.md',content:'remote'}),/symlink/)
  const missing=[{...adapters[0],root:path.join(root,'missing')}];assert.deepEqual(collectMemory({home:root,adapters:missing}).records,[]);assert.equal(fs.existsSync(missing[0].root),false)
 })
 test('another profile cannot scan or export a file claimed by a different memory owner',t=>{
  const {root,adapters}=fixture(t)
  writeMemory({home:root,adapters,adapterId:'memory',relativePath:'private.md',content:'profile-a-private-body',expectedHash:null,owner:'profile-a'})
  const foreign=collectMemory({home:root,adapters,owner:'profile-b'})
  assert.deepEqual(foreign.records,[]);assert.equal(foreign.skipped[0].reason,'owned-by-other-profile')
  assert.equal(JSON.stringify(foreign).includes('profile-a-private-body'),false)
  assert.equal(collectMemory({home:root,adapters,owner:'profile-a'}).records.length,1)
 })
 test('memory collection rejects hard links to a file outside the adapter root',t=>{
  const {root,adapters,dir}=fixture(t);const outside=path.join(root,'private.md');fs.writeFileSync(outside,'outside-private-value');fs.linkSync(outside,path.join(dir,'linked.md'))
  const scanned=collectMemory({home:root,adapters});assert.equal(scanned.records.length,0);assert.equal(scanned.skipped[0].reason,'hardlink-path-rejected')
 })
 test('memory writers enforce type, create baseline and independent profile ownership',t=>{
  const {root,adapters,dir}=fixture(t);assert.throws(()=>writeMemory({home:root,adapters,adapterId:'memory',relativePath:'run.sh',content:'echo unsafe'}),/type/)
  writeMemory({home:root,adapters,adapterId:'memory',relativePath:'new.md',content:'first',expectedHash:null,owner:'profile-a'})
  assert.throws(()=>writeMemory({home:root,adapters,adapterId:'memory',relativePath:'new.md',content:'second',owner:'profile-b'}),/owned-by/)
  assert.throws(()=>writeMemory({home:root,adapters,adapterId:'memory',relativePath:'new.md',content:'second',expectedHash:null,owner:'profile-a'}),/baseline/)
  assert.equal(fs.readFileSync(path.join(dir,'new.md'),'utf8'),'first')
 })
 test('resource validation binds addresses to identities and actual payload hashes',()=>{
  const valid=plugin();assert.deepEqual(validateResourceRecord(valid),[])
  assert.ok(validateResourceRecord({...valid,source:{...valid.source,package:'@deepseek-ai/dsh'}}).length)
  assert.ok(validateResourceRecord({...valid,enabled:true}).some(x=>x.includes('Hash')))
  assert.ok(validateResourceRecord({kind:'memory',key:'memory:other.md',adapterId:'memory',relativePath:'note.md',content:'x',schemaVersion:1,contentHash:hash('fake')}).length)
 })
 test('offline import revalidates records even after attacker recomputes checksum',()=>{
  const state={identity:{deviceId:'node-a',profileId:'a'},revision:{number:1,hash:'rev:1',clock:{}},expected:[plugin()],expectedConfig:[],expectedMemory:[]}
  const snapshot=exportSnapshot(state);assert.equal(parseSnapshot(JSON.stringify(snapshot)).trust,'untrusted')
  snapshot.expected[0].source.package='file:/etc/passwd';const {manifest,...body}=snapshot;snapshot.manifest.digest=hash(body)
  assert.equal(parseSnapshot(JSON.stringify(snapshot)).ok,false)
  const signed=exportSnapshot(state,{secret:'test-peer-secret'});assert.equal(parseSnapshot(JSON.stringify(signed),'test-peer-secret').trust,'authenticated');assert.equal(parseSnapshot(JSON.stringify(signed)).reason,'unknown-signing-key')
 })
 test('HTTP transport rejects business errors, redirects, unsafe destinations and oversized body streams',async()=>{
  let options
  const transport=createTransport({fetchImpl:async(url,opts)=>{options=opts;return {ok:true,headers:new Headers(),text:async()=>JSON.stringify({error:'unauthorized'})}}})
  await assert.rejects(transport.send('http://127.0.0.1/state',{token:'fake-token'}),error=>error.code==='unauthorized');assert.equal(options.redirect,'error')
  await assert.rejects(transport.send('http://203.0.113.1/state',{token:'fake-token'}),/HTTPS/)
  const large=createTransport({fetchImpl:async()=>({ok:true,headers:new Headers({'content-length':String(600000)}),text:async()=>''})})
  await assert.rejects(large.send('http://127.0.0.1/state',{token:'fake-token'}),error=>error.code==='payload-too-large')
 })
 test('SSH uses direct TCP forwarding, complete HTTP target and no credential in local or remote argv',async()=>{
  let captured,input
  const spawnImpl=(command,args)=>{captured={command,args};const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin={end(value){input=value}};process.nextTick(()=>{const body='{"status":"ok"}';child.stdout.emit('data',Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`));child.emit('close',0)});return child}
  const ssh=createSshTransport({host:'example.com',user:'user',identityFile:'/keys/id_ed25519',knownHostsFile:'/keys/known_hosts',spawnImpl})
  assert.equal((await ssh.send('http://127.0.0.1:3010/plugin-sync/state',{token:'fake-peer-token',body:{hello:1}})).status,'ok')
  assert.ok(captured.args.includes('-W'));assert.ok(captured.args.includes('127.0.0.1:3010'));assert.equal(captured.args.join(' ').includes('fake-peer-token'),false);assert.equal(captured.args.join(' ').includes('curl'),false);assert.match(input,/^POST \/plugin-sync\/state HTTP\/1.1/);assert.match(input,/Authorization: Bearer fake-peer-token/)
  assert.throws(()=>createSshTransport({host:'-oProxyCommand=bad',user:'user',identityFile:'/keys/id',knownHostsFile:'/keys/known'}),/invalid/)
 })
 test('SSH deadline kills the subprocess and enforces response byte limits',async()=>{
  let killed=false
  const spawnImpl=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin={end(){}};child.kill=()=>{killed=true};return child}
  const ssh=createSshTransport({host:'example.com',user:'user',identityFile:'/keys/id',knownHostsFile:'/keys/known',timeoutMs:20,spawnImpl})
  await assert.rejects(ssh.send('http://127.0.0.1/state',{token:'fake-token'}),error=>error.code==='timeout');assert.equal(killed,true)
 })
