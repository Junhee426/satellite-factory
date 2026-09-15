// Save/load: serializeState()/parseState()/importState() in dist/persistence.mjs. Confirms saved
// files round-trip through model.mjs's existing `validate` (no parallel validator), and that an
// invalid or malformed import is rejected cleanly without ever touching the caller's current state.
import assert from 'node:assert/strict';
import {BASE,simulate,validate} from '../dist/model.mjs';
import {SCHEMA_VERSION,serializeState,parseState,importState} from '../dist/persistence.mjs';

// --- round trip ---
{
 const saved=serializeState({config:BASE,baseline:{...BASE,chambers:2},day:125});
 assert.equal(saved.schemaVersion,SCHEMA_VERSION);
 assert(typeof saved.savedAt==='string'&&!Number.isNaN(Date.parse(saved.savedAt)));
 const asFile=JSON.stringify(saved); // exercises the string-input path, as a real loaded file would
 const parsed=parseState(asFile);
 assert.deepEqual(parsed.config,validate(BASE));
 assert.deepEqual(parsed.baseline,validate({...BASE,chambers:2}));
 assert.equal(parsed.day,125);
 // parseState also accepts an already-parsed object (e.g. re-parsing a save made in-session).
 assert.deepEqual(parseState(saved),parsed);
}

// --- day is normalized/rounded, and its range is enforced ---
{
 const saved=serializeState({config:BASE,baseline:BASE,day:12.6});
 assert.equal(parseState(saved).day,13);
 assert.throws(()=>parseState({...saved,day:-1}),/day/);
 assert.throws(()=>parseState({...saved,day:251}),/day/);
 assert.throws(()=>parseState({...saved,day:NaN}),/day/);
 assert.throws(()=>parseState({...saved,day:'125'}),/day/);
}

// --- malformed / invalid files are rejected with a clear error, one case at a time ---
{
 assert.throws(()=>parseState('not json'),/JSON/);
 assert.throws(()=>parseState('null'),/형식/);
 assert.throws(()=>parseState('[]'),/형식/);
 assert.throws(()=>parseState('"just a string"'),/형식/);
 assert.throws(()=>parseState({}),/schemaVersion/);
 assert.throws(()=>parseState({schemaVersion:99,config:BASE,baseline:BASE,day:0}),/schemaVersion/);
 assert.throws(()=>parseState({schemaVersion:SCHEMA_VERSION,baseline:BASE,day:0}),/config/);
 assert.throws(()=>parseState({schemaVersion:SCHEMA_VERSION,config:BASE,day:0}),/baseline/);
 // Invalid field values must be caught by model.mjs's real `validate`, not a shortcut check.
 assert.throws(()=>parseState({schemaVersion:SCHEMA_VERSION,config:{...BASE,chambers:0},baseline:BASE,day:0}),/config\.chambers/);
 assert.throws(()=>parseState({schemaVersion:SCHEMA_VERSION,config:BASE,baseline:{...BASE,workers:4.5},day:0}),/baseline\.workers/);
}

// --- importState: only computes/returns simulation results once parseState has fully succeeded ---
{
 const good=serializeState({config:{...BASE,chambers:2},baseline:BASE,day:80});
 const {config,baseline,day,result,baseResult}=importState(good);
 assert.deepEqual(config,validate({...BASE,chambers:2}));
 assert.deepEqual(baseline,validate(BASE));
 assert.equal(day,80);
 assert.deepEqual(result,simulate({...BASE,chambers:2}));
 assert.deepEqual(baseResult,simulate(BASE));

 assert.throws(()=>importState({schemaVersion:SCHEMA_VERSION,config:{...BASE,demand:0},baseline:BASE,day:0}));
 assert.throws(()=>importState('{not valid json'));
}

// --- the guarantee the review asked for: a bad import must never clobber currently-displayed,
// valid state. Model the exact gate app.mjs uses (parse+compute fully, THEN assign) and confirm
// a thrown error leaves every field of the "current" state byte-for-byte untouched. ---
{
 const current={config:{...BASE,lines:6},baseline:{...BASE},day:200,result:simulate({...BASE,lines:6}),baseResult:simulate(BASE)};
 const snapshotBefore=JSON.parse(JSON.stringify(current));
 const badFiles=[
  'this is not json at all',
  JSON.stringify({schemaVersion:SCHEMA_VERSION,config:{...BASE,chambers:99},baseline:BASE,day:10}),
  JSON.stringify({schemaVersion:2,config:BASE,baseline:BASE,day:10}),
  JSON.stringify({schemaVersion:SCHEMA_VERSION,config:BASE,baseline:BASE,day:999}),
 ];
 for(const raw of badFiles){
  let threw=false;
  try{
   const next=importState(raw); // must throw before this line completes for every case above
   current.config=next.config;current.baseline=next.baseline;current.day=next.day;
   current.result=next.result;current.baseResult=next.baseResult;
  }catch(error){
   threw=true;
   assert(error instanceof Error&&error.message.length>0,'a clear error message must be available to show the user');
  }
  assert.equal(threw,true,`expected a throw for malformed input: ${raw.slice(0,60)}`);
  assert.deepEqual(current,snapshotBefore,'current state must be untouched after a rejected import');
 }
}

console.log('PASS: save/load schema round trip, malformed/invalid file rejection via the real validate(), and current state left untouched on a failed import.');
