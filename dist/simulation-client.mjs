import {BASE,validate,simulate} from './model.mjs';

const superseded=()=>Object.assign(new Error('A newer input replaced this calculation.'),{name:'AbortError'});
export class SimulationClient{
 constructor(workerFactory=()=>new Worker(new URL('./simulation.worker.mjs',import.meta.url),{type:'module'})){
  this.cache=new Map();this.active=null;this.queued=null;this.sequence=0;this.closed=false;
  try{
   this.worker=workerFactory();
   this.worker.addEventListener('message',e=>this.receive(e.data));
   this.worker.addEventListener('error',e=>{e.preventDefault?.();this.fallback();});
   this.worker.addEventListener('messageerror',()=>this.fallback());
  }catch{this.worker=null;}
 }
 key(config){return JSON.stringify(Object.keys(BASE).map(k=>config[k]));}
 remember(key,result){
  this.cache.delete(key);this.cache.set(key,result);
  if(this.cache.size>24)this.cache.delete(this.cache.keys().next().value);
 }
 seed(result){this.remember(this.key(result.config),result);}
 compute(input){
  if(this.closed)return Promise.reject(new Error('Simulation client is closed.'));
  const config=validate(input),key=this.key(config);
  if(this.queued){
   if(this.queued.key===key)return new Promise((resolve,reject)=>{this.queued.waiters.push({resolve,reject});});
   this.queued.reject(superseded());this.queued=null;
  }
  if(this.cache.has(key)){
   const result=this.cache.get(key);this.remember(key,result);return Promise.resolve(result);
  }
  // An identical request already computing rides along instead of triggering a duplicate worker round trip.
  if(this.active&&this.active.key===key)return new Promise((resolve,reject)=>{this.active.waiters.push({resolve,reject});});
  return new Promise((resolve,reject)=>{this.queued={id:++this.sequence,key,config,resolve,reject,waiters:[]};this.pump();});
 }
 pump(){
  if(this.closed||this.active||!this.queued)return;
  this.active=this.queued;this.queued=null;
  if(this.worker){
   try{this.worker.postMessage({id:this.active.id,config:this.active.config});}
   catch{this.fallback();}
  }else this.runLocal();
 }
 runLocal(){
  const job=this.active;
  queueMicrotask(()=>{
   if(this.closed||this.active!==job)return;
   try{this.receive({id:job.id,result:simulate(job.config)});}
   catch(e){this.receive({id:job.id,error:e.message});}
  });
 }
 fallback(){
  if(!this.worker)return;
  this.worker.terminate();this.worker=null;
  if(this.active)this.runLocal();else this.pump();
 }
 receive(message){
  if(!this.active||message.id!==this.active.id)return;
  const job=this.active;this.active=null;
  if(message.error){
   const error=new Error(message.error);
   job.reject(error);for(const w of job.waiters)w.reject(error);
  }else{
   this.remember(job.key,message.result);
   job.resolve(message.result);for(const w of job.waiters)w.resolve(message.result);
  }
  this.pump();
 }
 dispose(){
  this.closed=true;this.worker?.terminate();
  for(const job of [this.active,this.queued]){
   if(!job)continue;
   job.reject(superseded());for(const w of job.waiters)w.reject(superseded());
  }
  this.active=this.queued=null;this.cache.clear();
 }
}
