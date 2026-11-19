import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const root=fileURLToPath(new URL('../',import.meta.url))
const files=['index.js','client.js',...fs.readdirSync(path.join(root,'lib')).filter(name=>name.endsWith('.js')).map(name=>'lib/'+name)]
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{cwd:root,stdio:'inherit'});if(result.status!==0)process.exit(result.status??1)}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'))
for(const file of [pkg.main,pkg.exports['.'],pkg.exports['./client'],pkg.exports['./icon'],pkg.dsh.bundle.patch])if(!fs.existsSync(path.resolve(root,file)))throw new Error('Missing package entry: '+file)
for(const locale of ['en','zh']){const data=JSON.parse(fs.readFileSync(path.join(root,'locale',locale+'.json'),'utf8'));if(!data.meta?.title||!data.meta?.description)throw new Error('Missing display metadata: '+locale)}
if(pkg.dsh.client.platform!=='web'||!pkg.engines.dsh)throw new Error('Missing DSH compatibility metadata')
console.log('Syntax and manifest entries verified: '+files.length+' JavaScript files')
