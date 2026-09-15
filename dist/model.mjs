export const BASE={demand:128,lines:4,workers:16,chambers:1,batch:4,rework:12,automatic:false,assemblyDays:7,functionDays:4,environmentDays:10,materialCost:8,laborCost:0.9};
export const LABELS=['입고·검수','조립·통합','기능시험','환경시험','최종검사·출하'];
export const LIMITS={demand:[16,256],lines:[1,10],workers:[4,40],chambers:[1,6],batch:[1,8],rework:[0,30],assemblyDays:[1,30],functionDays:[1,15],environmentDays:[1,30],materialCost:[0.1,100],laborCost:[0.1,3]};
export const MC_LIMITS={seed:[0,1000000],iterations:[1,500]};
export function validate(input){
 const c={...BASE,...input};
 for(const [key,[min,max]] of Object.entries(LIMITS)){
  if(!Number.isFinite(c[key])||c[key]<min||c[key]>max)throw new Error(`${key}: ${min}~${max} 범위를 입력하세요.`);
  if(!['materialCost','laborCost'].includes(key)&&!Number.isInteger(c[key]))throw new Error(`${key}: 정수를 입력하세요.`);
 }
 if(typeof c.automatic!=='boolean')throw new Error('automatic: 참/거짓 값이 필요합니다.');
 return c;
}
// Monte Carlo seed/iteration inputs are a separate concern from the factory config above (they
// never reach `validate`), so they get their own small range check in the same style rather than
// a parallel copy of validate() itself.
export function validateMonteCarlo(options){
 const o={seed:1,iterations:200,...options};
 for(const [key,[min,max]] of Object.entries(MC_LIMITS)){
  if(!Number.isInteger(o[key])||o[key]<min||o[key]>max)throw new Error(`${key}: ${min}~${max} 범위의 정수를 입력하세요.`);
 }
 return {seed:o.seed,iterations:o.iterations};
}
// seed=0 (the default used by every plain simulate(config) call in this codebase) reproduces the
// original unseeded hash exactly: (i+13+0*SEED_PRIME)===(i+13). A non-zero seed only ever comes
// from monteCarlo() below. The seed term is kept small enough (see MC_LIMITS.seed) that
// (i+13)*374761393 + seed*SEED_PRIME stays an exactly representable double, so this stays a pure,
// order-independent function of (i, seed) just like the original random_for(i) was of i alone —
// which is what lets a baseline and a comparison scenario draw the identical value for the same
// spacecraft id under the same seed (see monteCarlo()).
const SEED_PRIME=2654435761;
function randomFor(i,seed=0){let x=(i+13)*374761393+seed*SEED_PRIME;x=(x^(x>>>13))*1274126177;return ((x^(x>>>16))>>>0)/4294967296;}
export function simulate(input,options={}){
 const c=validate(input),year=250,step=.25;
 const seed=Number.isInteger(options.seed)?options.seed:0;
 const capacity=[3,Math.min(c.lines,Math.floor(c.workers/4)),3,c.chambers,2];
 const duration=[2,c.assemblyDays,c.functionDays*(c.automatic ? .7 : 1),c.environmentDays,2];
 const probability=c.rework/100*(c.automatic ? .55 : 1);
 const jobs=Array.from({length:c.demand},(_,i)=>({id:i+1,release:Math.floor(i*year/c.demand/step)*step,segments:[],queues:[],reworked:false,done:null}));
 const queues=Array.from({length:5},()=>[]),running=Array.from({length:5},()=>[]);
 const busy=Array(5).fill(0),waitSum=Array(5).fill(0),visits=Array(5).fill(0);
 let next=0,complete=0,t=0;
 function enqueue(job,stage,time,retry=false){queues[stage].push({job,at:time,retry});}
 for(t=0;t<=20000&&complete<c.demand;t+=step){
  while(next<jobs.length&&jobs[next].release<=t)enqueue(jobs[next++],0,t);
  for(let s=4;s>=0;s--){
   const ended=running[s].filter(x=>x.end<=t);
   running[s]=running[s].filter(x=>x.end>t);
   for(const group of ended)for(const entry of group.entries){
    const j=entry.job;
    if(s===4){j.done=t;complete++;}
    else if(s===2&&!j.reworked&&randomFor(j.id,seed)<probability){j.reworked=true;enqueue(j,1,t,true);}
    else enqueue(j,s+1,t,entry.retry&&s===1);
   }
  }
  // Rework receives the same FIFO discipline. Each spacecraft can fail once.
  for(let s=0;s<5;s++){
   while(running[s].length<capacity[s]&&queues[s].length){
    const q=queues[s],size=s===3?c.batch:1;
    if(s===3&&q.length<size&&t-q[0].at<3)break;
    const entries=q.splice(0,size);
    const d=Math.ceil(duration[s]*(s===1&&entries[0].retry ? .35 : 1)/step)*step;
    const end=t+d;
    for(const e of entries){e.job.queues.push({stage:s,start:e.at,end:t});e.job.segments.push({stage:s,start:t,end,retry:e.retry});waitSum[s]+=t-e.at;visits[s]++;}
    running[s].push({entries,start:t,end});
    busy[s]+=Math.max(0,Math.min(end,year)-t);
   }
  }
 }
 if(complete!==c.demand)throw new Error('계산 한도를 초과했습니다. 공정 설정을 확인하세요.');
 const annual=jobs.filter(j=>j.done<=year),shipments=annual.length;
 const lead=annual.length?annual.reduce((sum,j)=>sum+j.done-j.release,0)/annual.length:0;
 const avgWait=waitSum.map((n,i)=>n/(visits[i]||1));
 const util=busy.map((n,i)=>n/(year*capacity[i]));
 // Fixed cost is allocated over annual completions, materials over completed units.
 const fixed=c.workers*c.laborCost+c.lines*2+c.chambers*4+10+(c.automatic?3:0);
 const extra=annual.filter(j=>j.reworked).length*.15;
 const cost=shipments?c.materialCost+(fixed+extra)/shipments:null;
 const monthly=Array.from({length:12},(_,i)=>jobs.filter(j=>j.done<=(i+1)*year/12).length);
 const bottleneck=avgWait.indexOf(Math.max(...avgWait));
 return {config:c,jobs,shipments,lead,cost,fixed,monthly,avgWait,util,bottleneck,capacity,duration,finish:jobs.at(-1).done>0?Math.max(...jobs.map(j=>j.done)):0,year,reworkCount:jobs.filter(j=>j.reworked).length,seed};
}
// Linear-interpolated percentile (the common "R-7"/Excel PERCENTILE.INC method), matched exactly
// by python/engine.py's _percentile so both languages report the same P10/P50/P90.
function percentile(values,p){
 const sorted=[...values].sort((a,b)=>a-b);
 if(!sorted.length)return null;
 const idx=(sorted.length-1)*p,lo=Math.floor(idx),hi=Math.ceil(idx);
 return sorted[lo]+(sorted[hi]-sorted[lo])*(idx-lo);
}
function summarize(values){
 return {p10:percentile(values,.1),p50:percentile(values,.5),p90:percentile(values,.9),mean:values.length?values.reduce((s,v)=>s+v,0)/values.length:null,samples:values.length};
}
// Seed-based Monte Carlo: re-runs `simulate` `iterations` times, once per seed+i, and reports
// P10/P50/P90 (plus mean) for annual shipments, average lead time and unit cost.
//
// Common random numbers: because randomFor(id, seed) depends only on (spacecraft id, seed) and
// not on call order, calling monteCarlo(baselineConfig, {seed, iterations}) and
// monteCarlo(comparisonConfig, {seed, iterations}) makes iteration i draw the exact same rework
// outcome for spacecraft #k in BOTH scenarios (as long both have a spacecraft #k). Differences
// between the two scenarios' percentile outputs therefore come from the scenario's own conditions
// (chambers, staffing, automatic inspection, ...), not from independent RNG noise between runs.
export function monteCarlo(config,options){
 const {seed,iterations}=validateMonteCarlo(options);
 const shipments=[],lead=[],cost=[];
 for(let i=0;i<iterations;i++){
  const r=simulate(config,{seed:seed+i});
  shipments.push(r.shipments);
  if(r.shipments)lead.push(r.lead);
  if(r.cost!==null)cost.push(r.cost);
 }
 return {seed,iterations,shipments:summarize(shipments),lead:summarize(lead),cost:summarize(cost)};
}
export function snapshot(result,day){
 const stages=LABELS.map((name,s)=>({name,queue:[],active:[],done:0}));
 let completed=0,released=0;
 for(const j of result.jobs){
  if(j.release<=day)released++;
  if(j.done<=day){completed++;continue;}
  for(const q of j.queues)if(q.start<=day&&day<q.end)stages[q.stage].queue.push(j.id);
  for(const seg of j.segments){
   if(seg.start<=day&&day<seg.end)stages[seg.stage].active.push({id:j.id,progress:(day-seg.start)/(seg.end-seg.start),retry:seg.retry});
   if(seg.end<=day)stages[seg.stage].done++;
  }
 }
 return {stages,completed,released,wip:released-completed};
}
