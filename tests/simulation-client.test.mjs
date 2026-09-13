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
