// Confirms python/engine.py's monte_carlo() (P10/P50/P90) agrees exactly with dist/model.mjs's
// monteCarlo() for the same config/seed/iterations. Skips (does not fail) when no Python
// interpreter is available, matching tests/js-python-parity.test.mjs's approach — this app has no
// backend and never calls python/engine.py at runtime.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BASE,monteCarlo} from '../dist/model.mjs';

const FIXTURES=[
 {config:BASE,seed:7,iterations:40},
 {config:{...BASE,chambers:2},seed:7,iterations:40}, // same seed as above: common-random-numbers check
 {config:{...BASE,demand:32,rework:30},seed:3,iterations:25}, // small demand + high rework: volatile outcomes
 {config:{...BASE,automatic:true},seed:99,iterations:15},
];

function findPython(){
 for(const bin of ['python3','python']){
  try{execFileSync(bin,['--version'],{stdio:'ignore'});return bin;}catch{}
 }
 return null;
}

const python=findPython();
if(!python){
 console.log('SKIP: no python3/python interpreter on PATH; JS/Python Monte Carlo parity was not re-verified by this run.');
 process.exit(0);
}

const root=fileURLToPath(new URL('..',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'satellite-factory-mc-parity-'));
try{
 FIXTURES.forEach((fixture,i)=>{
  const configPath=join(dir,`config-${i}.json`),outputPath=join(dir,`result-${i}.json`);
  writeFileSync(configPath,JSON.stringify(fixture.config));
  execFileSync(python,[join(root,'python/engine.py'),'--config',configPath,'--monte-carlo',
   '--seed',String(fixture.seed),'--iterations',String(fixture.iterations),'--output',outputPath],
   {cwd:root,stdio:'inherit'});
  const pythonResult=JSON.parse(readFileSync(outputPath,'utf8'));
  const jsResult=JSON.parse(JSON.stringify(monteCarlo(fixture.config,{seed:fixture.seed,iterations:fixture.iterations})));
  assert.deepEqual(pythonResult,jsResult,`JS/Python Monte Carlo mismatch for fixture #${i}: ${JSON.stringify(fixture)}`);
 });
 // Common random numbers must hold in the Python engine too: fixtures #0 and #1 share seed 7 and
 // only differ in `chambers`, a stage downstream of the rework check, so their P50 shipments must
 // differ (chambers relieves a bottleneck) while both were driven by the identical draw sequence
 // already proven equal to the JS side above.
 const a=JSON.parse(JSON.stringify(monteCarlo(FIXTURES[0].config,{seed:FIXTURES[0].seed,iterations:FIXTURES[0].iterations})));
 const b=JSON.parse(JSON.stringify(monteCarlo(FIXTURES[1].config,{seed:FIXTURES[1].seed,iterations:FIXTURES[1].iterations})));
 assert.notEqual(a.shipments.p50,b.shipments.p50,'the two shared-seed fixtures should still show a scenario difference');
 console.log(`PASS: JS (dist/model.mjs) and Python (python/engine.py) produced identical Monte Carlo P10/P50/P90 for ${FIXTURES.length} fixtures.`);
}finally{
 rmSync(dir,{recursive:true,force:true});
}
