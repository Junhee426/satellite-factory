import assert from 'node:assert/strict';
import {BASE,simulate,snapshot} from '../dist/model.mjs';
import {satelliteStatus,trackingSteps,SeatMap,chamberBatches,stationStatus,pickTracked,cumulativeWait,satName} from '../dist/twin-state.mjs';

assert.equal(satName(7),'SAT-007');

for(const config of [BASE,{...BASE,chambers:2,batch:6,demand:64},{...BASE,rework:30},{...BASE,demand:256,lines:1,workers:4,batch:1,rework:30}]){
 const r=simulate(config);
 for(const day of [0,30.5,125,249.75,r.finish]){
  const shot=snapshot(r,day);
  // Per-satellite status must agree with the station snapshot the rest of the UI already uses.
  shot.stages.forEach((st,s)=>{
   for(const a of st.active){const x=satelliteStatus(r.jobs[a.id-1],day);assert.equal(x.phase,'active');assert.equal(x.stage,s);assert(Math.abs(x.progress-a.progress)<1e-12);assert.equal(x.retry,a.retry);}
   for(const id of st.queue){const x=satelliteStatus(r.jobs[id-1],day);assert.equal(x.phase,'queue');assert.equal(x.stage,s);}
  });
  const counts={pending:0,shipped:0,active:0,queue:0};
  for(const j of r.jobs)counts[satelliteStatus(j,day).phase]++;
  assert.equal(counts.shipped,shot.completed);
  assert.equal(counts.pending,r.jobs.length-shot.released);
  assert.equal(counts.active+counts.queue,shot.wip);

  // Chamber batches never exceed the batch size and never need more chambers than exist.
  const batches=chamberBatches(r,shot.stages[3].active.map(a=>a.id),day);
  assert(batches.every(b=>b.ids.length>=1&&b.ids.length<=config.batch));
  assert(batches.length<=config.chambers,`${batches.length} batches for ${config.chambers} chambers`);
  assert.equal(batches.reduce((n,b)=>n+b.ids.length,0),shot.stages[3].active.length);
  for(let s=0;s<5;s++)assert(['bottleneck','idle','full','running'].includes(stationStatus(r,shot,s)));
 }

 const reworked=r.jobs.find(j=>j.reworked);
 if(reworked){
  const failedAt=reworked.queues[reworked.segments.findIndex(s=>s.retry&&s.stage===1)].start;
  const before=trackingSteps(reworked,failedAt-.25),during=trackingSteps(reworked,failedAt);
  assert(!before.steps[1].rework,'Rework stays hidden until the functional test fails');
  assert.equal(before.steps[2].state,'current');
  assert(during.steps[1].rework);
  assert.equal(during.steps[1].state,'current');
  assert.equal(during.steps[2].state,'upcoming','Functional test is re-run after rework');
 }
 const j=r.jobs[0];
 const pending=trackingSteps(j,j.release-1);
 if(j.release>0)assert(pending.steps.every(s=>s.state==='upcoming'));
 const done=trackingSteps(j,j.done);
 assert(done.steps.every(s=>s.state==='done'));
 assert.equal(done.steps[4].time,j.done);
 assert.equal(cumulativeWait(j,j.done),j.queues.reduce((n,q)=>n+q.end-q.start,0));
 const mid=trackingSteps(j,j.segments[2].start);
 assert.deepEqual(mid.steps.map(s=>s.state),['done','done','current','upcoming','upcoming']);
}

const seats=new SeatMap();
assert.deepEqual([...seats.assign([5,9,12],3)],[[5,0],[9,1],[12,2]]);
assert.deepEqual([...seats.assign([9,12,20],3)].sort((a,b)=>a[0]-b[0]),[[9,1],[12,2],[20,0]],'Remaining spacecraft keep their seats; a newcomer takes the freed one');
assert.deepEqual([...seats.assign([12],2)],[[12,0]],'A seat beyond a reduced count moves to a free seat in range');

const r=simulate(BASE);
const first=pickTracked(r,125,null);
assert(first);
assert.equal(pickTracked(r,125,first),first,'A tracked spacecraft still in the factory stays tracked');
const shipped=r.jobs.find(j=>j.done<=125).id;
assert.notEqual(pickTracked(r,125,shipped),shipped,'A shipped spacecraft hands tracking to one still in work');
assert.equal(pickTracked(r,r.finish,null),null);
console.log('PASS: twin status agrees with snapshots, tracking steps incl. rework, stable seats, chamber batches, tracked-satellite handoff.');
