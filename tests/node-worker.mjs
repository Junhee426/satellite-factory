import {parentPort} from 'node:worker_threads';
globalThis.self={
 addEventListener(name,handler){if(name==='message')parentPort.on('message',data=>handler({data}));},
 postMessage(message){parentPort.postMessage(message);}
};
await import('../dist/simulation.worker.mjs');
