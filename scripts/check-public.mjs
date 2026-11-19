// Public release gate. Reports locations and rule names, never secret contents.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const root=fileURLToPath(new URL('../',import.meta.url))
const skip=new Set(['.git','node_modules','coverage'])
const rules=[
  ['machine-home',/(?:\/home\/|\/Users\/|[A-Z]:\\Users\\)[A-Za-z0-9_-]+/],
  ['private-network',/\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/],
  ['github-credential',/\b(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['private-key',/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]{80,}-----END (?:[A-Z ]*PRIVATE KEY)-----/],
  ['cloud-credential',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['model-credential',/\bsk-[A-Za-z0-9]{24,}\b/],
  ['credential-url',/https?:\/\/[^\s/@:]+:[^\s/@]+@/],
]
let files=0,historyFiles=0
const failures=[]
function scan(text,label){for(const [name,regex]of rules){const match=regex.exec(text);if(match)failures.push({file:label,line:text.slice(0,match.index).split('\n').length,rule:name})}}
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  if(skip.has(entry.name)||entry.name.startsWith('.verify')||entry.name.startsWith('.audit'))continue
  const file=path.join(dir,entry.name),relative=path.relative(root,file)
  if(entry.isSymbolicLink()){failures.push({file:relative,rule:'symlink-not-allowed'});continue}
  if(entry.isDirectory()){walk(file);continue}
  if(/\.(?:tgz|log|tmp|png|jpg|webp)$/.test(entry.name))continue
  const stat=fs.statSync(file);if(stat.size>1024*1024){failures.push({file:relative,rule:'oversized-source'});continue}
  scan(fs.readFileSync(file,'utf8'),relative);files++
}}
walk(root)
const git=(args)=>spawnSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024})
const repository=git(['rev-parse','--show-toplevel'])
let history='uninitialized'
if(repository.status===0&&path.resolve(repository.stdout.trim())===path.resolve(root)){
  const listing=git(['rev-list','--objects','--all'])
  if(listing.status!==0)throw new Error('Cannot enumerate release history')
  const seen=new Set()
  for(const line of listing.stdout.trim().split('\n').filter(Boolean)){
    const index=line.indexOf(' ');if(index<0)continue
    const sha=line.slice(0,index),label=line.slice(index+1)
    if(seen.has(sha))continue;seen.add(sha)
    const kind=git(['cat-file','-t',sha]);if(kind.stdout.trim()!=='blob')continue
    const contents=git(['cat-file','blob',sha]);if(contents.status!==0)throw new Error('Cannot scan historical blob')
    scan(contents.stdout,'history:'+sha.slice(0,12)+':'+label);historyFiles++
  }
  history='scanned'
}
if(failures.length){console.error(JSON.stringify({status:'failed',failures},null,2));process.exit(1)}
console.log(JSON.stringify({status:'passed',workingTreeFiles:files,history,historyFiles}))
