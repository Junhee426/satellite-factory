import {performance} from 'node:perf_hooks';
import {readFileSync} from 'node:fs';
import {simulate} from '../dist/model.mjs';
const scenarios=JSON.parse(readFileSync(new URL('./scenarios.json',import.meta.url)));
const results=scenarios.map(({name,config})=>{
 for(let i=0;i<10;i++)simulate(config);
 const times=[];
 for(let i=0;i<50;i++){const start=performance.now();simulate(config);times.push(performance.now()-start);}
 times.sort((a,b)=>a-b);
 return {name,medianMs:(times[24]+times[25])/2,p95Ms:times[Math.ceil(times.length*.95)-1],runs:times.length};
});
console.log(JSON.stringify({runtime:process.version,results}));
