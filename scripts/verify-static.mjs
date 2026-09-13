import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dist=resolve(root,'dist');
const html=readFileSync(resolve(dist,'index.html'),'utf8');
for(const match of html.matchAll(/(?:src|href)=["'](\.\/[^"']+)["']/g)){
 if(!existsSync(resolve(dist,match[1])))throw new Error(`Missing asset: ${match[1]}`);
}
for(const file of readdirSync(dist).filter(f=>f.endsWith('.mjs'))){
 const full=resolve(dist,file),source=readFileSync(full,'utf8');
 execFileSync(process.execPath,['--check',full],{stdio:'inherit'});
 for(const m of source.matchAll(/(?:from\s*|new URL\()\s*['"](\.\/[^'"]+)['"]/g)){
  if(!existsSync(resolve(dist,m[1])))throw new Error(`Missing module: ${m[1]}`);
 }
}
execFileSync(process.execPath,[resolve(root,'tests/model.test.mjs')],{stdio:'inherit'});
execFileSync(process.execPath,[resolve(root,'tests/simulation-client.test.mjs')],{stdio:'inherit'});
console.log('Render static package verified. Publish directory: dist');
