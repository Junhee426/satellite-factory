// Promotes the JS/Python parity claim in README.md and PERFORMANCE.md ("8개 시나리오에서 JS와
// Python의 ... 전체 결과가 일치") from a manual `python benchmarks/compare.py` run into an
// automated check. Runs on `npm test` when a Python interpreter is available; otherwise it skips
// with a clear message instead of failing a build that has no reason to have Python installed
// (this app has no backend and never calls python/engine.py at runtime).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {simulate} from '../dist/model.mjs';

// Mirrors benchmarks/compare.py's fixture list exactly, which is where the README's
// "8 scenarios" figure comes from: 3 named scenarios (benchmarks/scenarios.json) plus 5 more
// that stress validation edges (no rework, extra chamber, automatic inspection, minimum demand,
// every LIMITS field pushed to its opposite extreme).
const FIXTURES=[
 {},
 {demand:256},
 {demand:256,lines:1,workers:4,batch:1,rework:30,assemblyDays:30,environmentDays:30},
 {rework:0},
 {chambers:2},
 {automatic:true},
 {demand:16},
 {demand:256,workers:40,lines:10,chambers:6,batch:8,assemblyDays:1,functionDays:1,environmentDays:1},
];

function findPython(){
 for(const bin of ['python3','python']){
  try{execFileSync(bin,['--version'],{stdio:'ignore'});return bin;}catch{}
 }
 return null;
}

const python=findPython();
if(!python){
 console.log('SKIP: no python3/python interpreter on PATH; JS/Python parity was not re-verified by this run. Run `python benchmarks/compare.py` before relying on python/engine.py after changing the model.');
 process.exit(0);
}

const root=fileURLToPath(new URL('..',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'satellite-factory-parity-'));
try{
 const configPath=join(dir,'fixtures.json'),outputPath=join(dir,'results.json');
 writeFileSync(configPath,JSON.stringify(FIXTURES));
 execFileSync(python,[join(root,'python/engine.py'),'--config',configPath,'--output',outputPath],{cwd:root,stdio:'inherit'});
 const pythonResults=JSON.parse(readFileSync(outputPath,'utf8'));
 assert.equal(pythonResults.length,FIXTURES.length,'Python must return one result per fixture');
 FIXTURES.forEach((config,i)=>{
  // Round-trip the JS result through JSON so int/float formatting differences between the two
  // languages (e.g. Python's json.dumps writing 30.0 where JS writes 30) don't cause false failures.
  const jsResult=JSON.parse(JSON.stringify(simulate(config)));
  assert.deepEqual(pythonResults[i],jsResult,`JS/Python mismatch for fixture #${i}: ${JSON.stringify(config)}`);
 });
 console.log(`PASS: JS (dist/model.mjs) and Python (python/engine.py) produced identical results for ${FIXTURES.length} scenarios.`);
}finally{
 rmSync(dir,{recursive:true,force:true});
}
