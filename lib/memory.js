// Fixed local adapter roots, bounded text files, per-file ownership and backups.
// Remote data can select a registered adapter/path, never an arbitrary root.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { hash, token } from './protocol.js'

export function getMemoryAdapters(dshHome) {
  return [
    {id:'memory',root:path.join(dshHome,'.dsh-memory'),extensions:['.md','.json','.jsonl'],maxBytes:256*1024},
    {id:'persona',root:path.join(dshHome,'persona'),extensions:['.md','.json'],maxBytes:256*1024},
    {id:'soul',root:path.join(dshHome,'soul'),extensions:['.md','.json'],maxBytes:256*1024},
  ]
}
export const DEFAULT_ADAPTERS=getMemoryAdapters(path.join(os.homedir(),'.dsh'))
export function expandRoot(root,home=os.homedir()) { return path.resolve(root.startsWith('~/')?path.join(home,root.slice(2)):root) }

export function safePath(home,adapter,relativePath) {
  if(typeof relativePath!=='string'||!relativePath||relativePath.includes('\0')||relativePath.includes('\\'))throw new Error('invalid-relative-path')
  if(path.isAbsolute(relativePath)||/^[A-Za-z]:/.test(relativePath))throw new Error('absolute-path-rejected')
  if(relativePath.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('path-escape-rejected')
  const homePath=path.resolve(home)
  const root=expandRoot(adapter.root,home)
  const relativeRoot=path.relative(homePath,root)
  if(!relativeRoot||relativeRoot==='..'||relativeRoot.startsWith(`..${path.sep}`)||path.isAbsolute(relativeRoot))throw new Error('adapter-root-outside-home')
  // Check existing root ancestors before mkdir can follow an alias outside home.
  let ancestor=homePath
  for(const part of relativeRoot.split(path.sep)){
    ancestor=path.join(ancestor,part)
    try{const stat=fs.lstatSync(ancestor);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('symlink-escape-rejected')}
    catch(error){if(error.code!=='ENOENT')throw error}
  }
  // Missing roots are only created by the writer, never by a scan/check.
  if(fs.existsSync(root)) {
    const homeReal=fs.realpathSync(homePath)
    if(fs.realpathSync(root)!==path.resolve(homeReal,relativeRoot))throw new Error('symlink-escape-rejected')
  }
  const target=path.resolve(root,relativePath)
  let cursor=root
  for(const part of relativePath.split('/')) {
    cursor=path.join(cursor,part)
    try{const stat=fs.lstatSync(cursor);if(stat.isSymbolicLink())throw new Error('symlink-escape-rejected');if(cursor!==target&&!stat.isDirectory())throw new Error('non-directory-path-component')}
    catch(error){if(error.code!=='ENOENT')throw error}
  }
  return target
}
function readRegular(file,maxBytes) {
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0))
  try{const stat=fs.fstatSync(fd);if(!stat.isFile())throw new Error('not-a-regular-file');if(stat.nlink!==1)throw new Error('hardlink-path-rejected');if(stat.size>maxBytes)throw new Error('file-too-large');const data=fs.readFileSync(fd);if(data.byteLength>maxBytes)throw new Error('file-too-large');return data.toString('utf8')}
  finally{fs.closeSync(fd)}
}
function walk(dir,prefix='',depth=0,out=[]) {
  if(depth>3)return out
  const entries=fs.readdirSync(dir,{withFileTypes:true})
  for(const entry of entries){if(out.length>=512)break;const relative=prefix?`${prefix}/${entry.name}`:entry.name;if(entry.isDirectory())walk(path.join(dir,entry.name),relative,depth+1,out);else if(entry.isFile())out.push(relative)}
  return out
}
export function collectMemory({home=os.homedir(),adapters=DEFAULT_ADAPTERS,owner}={}) {
  const records=[],skipped=[]
  for(const adapter of adapters){
    const root=expandRoot(adapter.root,home)
    if(!fs.existsSync(root))continue
    let files
    try{safePath(home,adapter,'probe.md');files=walk(root)}catch(error){skipped.push({key:`${adapter.id}:*`,reason:error.message});continue}
    for(const relativePath of files){
      if(!adapter.extensions.includes(path.extname(relativePath).toLowerCase()))continue
      const key=`${adapter.id}:${relativePath}`
      try{
        const target=safePath(home,adapter,relativePath)
        const ownerPath=safePath(home,adapter,relativePath+'.owner')
        if(fs.existsSync(ownerPath)){
          const recordedOwner=readRegular(ownerPath,1024).trim()
          if(owner&&recordedOwner&&recordedOwner!==owner)throw new Error('owned-by-other-profile')
        }
        const content=readRegular(target,adapter.maxBytes)
        records.push({kind:'memory',key,adapterId:adapter.id,relativePath,schemaVersion:1,content,contentHash:hash({adapterId:adapter.id,relativePath,content})})
      }
      catch(error){skipped.push({key,reason:error.message})}
    }
  }
  return {records,skipped}
}
function unlinkCreated(file) { try{fs.unlinkSync(file)}catch(error){if(error.code!=='ENOENT')throw error} }

export function writeMemory({home=os.homedir(),adapters=DEFAULT_ADAPTERS,adapterId,relativePath,content,expectedHash,owner='unknown'}) {
  const adapter=adapters.find(item=>item.id===adapterId)
  if(!adapter)throw new Error('adapter-not-enabled')
  if(typeof content!=='string'||Buffer.byteLength(content,'utf8')>adapter.maxBytes)throw new Error('file-too-large')
  if(!adapter.extensions.includes(path.extname(relativePath??'').toLowerCase()))throw new Error('file-type-not-allowed')
  if(typeof owner!=='string'||!owner||owner.length>300||/[\r\n\0]/.test(owner))throw new Error('invalid-owner')
  const target=safePath(home,adapter,relativePath)
  const ownerPath=safePath(home,adapter,relativePath+'.owner')
  const lockPath=safePath(home,adapter,relativePath+'.sync-lock')
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700})
  safePath(home,adapter,relativePath)
  const lockFd=fs.openSync(lockPath,'wx',0o600)
  let temp=null,ownerTemp=null
  try{
    fs.writeSync(lockFd,String(process.pid))
    // Validate sidecars before modifying the data file, including dangling links.
    safePath(home,adapter,relativePath+'.owner')
    if(fs.existsSync(ownerPath)){const previousOwner=readRegular(ownerPath,1024).trim();if(previousOwner&&previousOwner!==owner)throw new Error('owned-by-other-profile')}
    const exists=fs.existsSync(target)
    let backup=null
    if(exists){
      const current=readRegular(target,adapter.maxBytes)
      const currentHash=hash({adapterId,relativePath,content:current})
      if(expectedHash===null||(expectedHash!==undefined&&expectedHash!==currentHash))throw new Error('memory-baseline-changed')
      backup=safePath(home,adapter,relativePath+`.bak-${Date.now()}-${token().slice(0,8)}`)
      fs.writeFileSync(backup,current,{mode:0o600,flag:'wx'})
    }else if(expectedHash!==undefined&&expectedHash!==null)throw new Error('memory-baseline-changed')
    temp=safePath(home,adapter,relativePath+`.${token().slice(0,16)}.tmp`)
    ownerTemp=safePath(home,adapter,relativePath+`.owner.${token().slice(0,16)}.tmp`)
    fs.writeFileSync(temp,content,{mode:0o600,flag:'wx'})
    fs.writeFileSync(ownerTemp,owner,{mode:0o600,flag:'wx'})
    safePath(home,adapter,relativePath)
    safePath(home,adapter,relativePath+'.owner')
    // Renaming replaces a hard-linked sidecar instead of modifying its other link.
    fs.renameSync(ownerTemp,ownerPath);ownerTemp=null
    fs.renameSync(temp,target);temp=null
    safePath(home,adapter,relativePath)
    if(readRegular(target,adapter.maxBytes)!==content)throw new Error('memory-verification-failed')
    return {status:'applied',detail:`memoryWrite:${adapterId}:${relativePath}`,backupCreated:Boolean(backup)}
  }finally{
    if(temp)unlinkCreated(temp)
    if(ownerTemp)unlinkCreated(ownerTemp)
    fs.closeSync(lockFd)
    unlinkCreated(lockPath)
  }
}
