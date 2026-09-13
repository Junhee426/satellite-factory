import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {SimulationClient} from '../dist/simulation-client.mjs';
import {BASE,simulate} from '../dist/model.mjs';
let workerPosts=0;
function factory(){
 const thread=new NodeWorker(new URL('./node-worker.mjs',import.meta.url));
 return {
  addEventListener(type,handler){thread.on(type,data=>handler(type==='message'?{data}:data));},
  postMessage(message){workerPosts++;thread.postMessage(message);},
  terminate(){return thread.terminate();}
 };
}
const client=new SimulationClient(factory);
try{
 const output=await client.compute(BASE);
 assert.deepEqual(output,simulate(BASE),'Worker protocol must retain all simulation data');
 const before=workerPosts;
 assert.deepEqual(await client.compute(BASE),output);
 assert.equal(workerPosts,before,'Repeated settings must use the cache');
 const promises=[client.compute({...BASE,demand:64}),client.compute({...BASE,demand:72}),client.compute({...BASE,demand:80})];
 const outcomes=await Promise.allSettled(promises);
 assert.equal(outcomes[0].value.config.demand,64);
 assert.equal(outcomes[1].reason.name,'AbortError','An obsolete queued slider input must be replaced');
 assert.deepEqual(outcomes[2].value,simulate({...BASE,demand:80}));
 assert.throws(()=>client.compute({...BASE,chambers:0}));
 const dupBefore=workerPosts;
 const [dup1,dup2]=await Promise.all([client.compute({...BASE,demand:96}),client.compute({...BASE,demand:96})]);
 assert.equal(workerPosts,dupBefore+1,'Two identical concurrent requests must share a single worker round trip');
 assert.deepEqual(dup1,dup2);
 assert.deepEqual(dup1,simulate({...BASE,demand:96}));
 const queuedBefore=workerPosts;
 const active=client.compute({...BASE,demand:100});
 const queued1=client.compute({...BASE,demand:104});
 const queued2=client.compute({...BASE,demand:104});
 const [activeOut,queued1Out,queued2Out]=await Promise.all([active,queued1,queued2]);
 assert.equal(workerPosts,queuedBefore+2,'An identical repeat of the still-waiting request must not requeue a second worker call');
 assert.deepEqual(queued1Out,queued2Out);
 assert.equal(activeOut.config.demand,100);assert.equal(queued1Out.config.demand,104);
}finally{client.dispose();}
await assert.rejects(client.compute(BASE));

const noWorker=new SimulationClient(()=>{throw new Error('Unsupported');});
assert.deepEqual(await noWorker.compute(BASE),simulate(BASE));
noWorker.dispose();

const handlers={};let terminated=false;
const broken=new SimulationClient(()=>({
 addEventListener(type,handler){handlers[type]=handler;},
 postMessage(){queueMicrotask(()=>handlers.error({preventDefault(){}}));},
 terminate(){terminated=true;}
}));
assert.deepEqual(await broken.compute(BASE),simulate(BASE),'Worker loading failure must preserve functionality');
assert.equal(terminated,true);broken.dispose();
console.log('PASS: worker result parity, cached results, latest queued input, invalid settings, unavailable worker and worker-load fallback.');
