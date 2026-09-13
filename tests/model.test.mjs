import assert from 'node:assert/strict';
import {BASE,simulate,snapshot,validate} from '../dist/model.mjs';

const base=simulate(BASE);
assert.deepEqual(simulate(BASE),base,'Runs must be reproducible');
assert.equal(simulate({...BASE,workers:20}).shipments,base.shipments,'Staff above cell staffing requirements must not create extra capacity');
assert(simulate({...BASE,chambers:2}).shipments>base.shipments,'Adding a bottleneck chamber must improve this baseline');
assert.equal(simulate({...BASE,rework:0}).reworkCount,0);
assert.throws(()=>validate({...BASE,chambers:0}));
assert.throws(()=>validate({...BASE,demand:NaN}));
assert.throws(()=>validate({...BASE,workers:4.5}));

const scenarios=[BASE,{...BASE,rework:0},{...BASE,chambers:2},{...BASE,automatic:true},{...BASE,demand:16},{...BASE,demand:256,lines:1,workers:4,batch:1,rework:30,assemblyDays:30,environmentDays:30},{...BASE,demand:256,lines:10,workers:40,chambers:6,batch:8,assemblyDays:1,functionDays:1,environmentDays:1}];
for(const config of scenarios){
 const r=simulate(config);
 assert.equal(r.jobs.length,config.demand);
 assert(r.jobs.every(j=>Number.isFinite(j.done)&&j.done>j.release));
 assert.equal(r.shipments,r.jobs.filter(j=>j.done<=250).length);
 assert.equal(r.finish,Math.max(...r.jobs.map(j=>j.done)));
 assert(r.util.every(v=>v>=0&&v<=1));
 assert(r.avgWait.every(v=>v>=0));
 assert.equal(r.monthly.at(-1),r.shipments);
 for(const j of r.jobs){
  assert.equal(j.segments.filter(s=>s.stage===3).length,1);
  assert.equal(j.segments.filter(s=>s.stage===4).length,1);
  assert.equal(j.segments.filter(s=>s.stage===1).length,j.reworked?2:1);
  assert.equal(j.queues.length,j.segments.length);
  const processing=j.segments.reduce((s,v)=>s+v.end-v.start,0);
  const waiting=j.queues.reduce((s,v)=>s+v.end-v.start,0);
  assert.equal(processing+waiting,j.done-j.release,'Every day in the system must be accounted for');
  j.segments.forEach((seg,i)=>{assert(seg.start>=j.release);assert(seg.end>seg.start);if(i>0)assert(seg.start>=j.segments[i-1].end);});
 }
 for(const day of [0,1,15,50,125,249,250,r.finish]){
  const shot=snapshot(r,day);
  const working=shot.stages.reduce((s,v)=>s+v.active.length,0);
  const waiting=shot.stages.reduce((s,v)=>s+v.queue.length,0);
  assert.equal(shot.released,working+waiting+shot.completed,'Snapshot must conserve all released spacecraft');
  shot.stages.forEach((s,i)=>assert(s.active.length<=r.capacity[i]*(i===3?config.batch:1),'Active work must fit station capacity'));
 }
}
console.log('PASS: deterministic scenarios, staffing and chamber effects, validation, spacecraft/time conservation, station capacity, annual accounting.');
