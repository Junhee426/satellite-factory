// Pure state derivation for the 3D digital twin and its overlays. No DOM or WebGL here so it runs under node tests.
import {LABELS} from './model.mjs';

export const satName=id=>`SAT-${String(id).padStart(3,'0')}`;

// Where one spacecraft is at `day`. A job's queue/segment history is contiguous from release to done, and
// queues[i] is the wait before segments[i] (both are recorded when that stage starts).
export function satelliteStatus(job,day){
 if(job.release>day)return {phase:'pending',stage:null,progress:0,retry:false};
 if(job.done!==null&&job.done<=day)return {phase:'shipped',stage:4,progress:1,retry:false,end:job.done};
 for(let i=0;i<job.segments.length;i++){
  const seg=job.segments[i];
  if(seg.start<=day&&day<seg.end)return {phase:'active',stage:seg.stage,progress:(day-seg.start)/(seg.end-seg.start),retry:seg.retry,start:seg.start,end:seg.end};
  const q=job.queues[i];
  if(q.start<=day&&day<q.end)return {phase:'queue',stage:q.stage,progress:0,retry:seg.retry,since:q.start,end:q.end};
 }
 return {phase:'queue',stage:0,progress:0,retry:false,since:job.release,end:job.release};
}

export function cumulativeWait(job,day){
 return job.queues.reduce((sum,q)=>sum+Math.max(0,Math.min(q.end,day)-q.start),0);
}

// Five tracking steps like a shipment tracker. Rework is only revealed once it has started, as a real tracker would.
export function trackingSteps(job,day){
 const status=satelliteStatus(job,day);
 const current=status.phase==='pending'?-1:status.phase==='shipped'?5:status.stage;
 const steps=LABELS.map((label,stage)=>{
  const segs=job.segments.filter(s=>s.stage===stage);
  const state=stage<current?'done':stage===current?'current':'upcoming';
  const past=segs.filter(s=>s.end<=day),next=segs.find(s=>s.start>day);
  const time=state==='done'?past.at(-1)?.end??segs.at(-1).end:state==='current'?(status.phase==='queue'?status.since:status.start):(next??segs[0]).start;
  const rework=segs.some(s=>s.retry&&job.queues[job.segments.indexOf(s)].start<=day);
  return {stage,label,state,time,rework};
 });
 return {status,steps};
}

// Stable seat numbers so a spacecraft stays in its cell while others come and go.
export class SeatMap{
 constructor(){this.seats=new Map();}
 assign(keys,count){
  const live=new Set(keys);
  for(const [k,seat] of this.seats)if(!live.has(k)||seat>=count)this.seats.delete(k);
  const used=new Set(this.seats.values());
  for(const k of keys){
   if(this.seats.has(k))continue;
   let seat=0;while(used.has(seat))seat++;
   this.seats.set(k,seat);used.add(seat);
  }
  return this.seats;
 }
}

// Environment-test batches that share a start time were loaded together; split them by the batch size so two
// chambers that started on the same tick each get their own group (same basis as model.monthlyUtilization).
export function chamberBatches(result,ids,day){
 const byStart=new Map();
 for(const id of ids){
  const st=satelliteStatus(result.jobs[id-1],day);
  if(!byStart.has(st.start))byStart.set(st.start,[]);
  byStart.get(st.start).push(id);
 }
 const batches=[];
 for(const [start,group] of [...byStart].sort((a,b)=>a[0]-b[0])){
  group.sort((a,b)=>a-b);
  for(let i=0;i<group.length;i+=result.config.batch)batches.push({key:`${start}#${i}`,ids:group.slice(i,i+result.config.batch)});
 }
 return batches;
}

export function stationStatus(result,shot,s){
 const st=shot.stages[s];
 if(s===result.bottleneck&&result.avgWait[s]>.25)return 'bottleneck';
 if(!st.active.length&&!st.queue.length)return 'idle';
 const inUse=s===3?Math.ceil(st.active.length/result.config.batch):st.active.length;
 return inUse>=result.capacity[s]?'full':'running';
}

// Keep following the same spacecraft while it is in the factory; otherwise move to the earliest one still in work.
export function pickTracked(result,day,prevId){
 const inFactory=id=>{const p=satelliteStatus(result.jobs[id-1],day).phase;return p==='active'||p==='queue';};
 if(prevId&&prevId<=result.jobs.length&&inFactory(prevId))return prevId;
 const active=result.jobs.find(j=>satelliteStatus(j,day).phase==='active');
 if(active)return active.id;
 return result.jobs.find(j=>inFactory(j.id))?.id??null;
}
