import {simulate} from './model.mjs';
self.addEventListener('message',event=>{
 const {id,config}=event.data;
 try{self.postMessage({id,result:simulate(config)});}
 catch(error){self.postMessage({id,error:error.message});}
});
