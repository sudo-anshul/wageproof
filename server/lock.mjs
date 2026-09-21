import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DATA,initStore} from './store.mjs';

export async function acquireDataLock(){
  await initStore();
  const helper=fileURLToPath(new URL('../scripts/store-lock.py',import.meta.url));
  const child=spawn('python3',[helper,DATA],{stdio:['pipe','pipe','pipe']});
  let released=false,acquired=false;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('Local storage lock did not start. Check Python 3.'));},5000);
    child.stdout.on('data',b=>{if(b.toString().includes('LOCKED')){clearTimeout(timer);acquired=true;resolve();}else if(b.toString().includes('IN_USE')){clearTimeout(timer);reject(new Error('This WageProof data folder is already open in another server. Use that server or choose a different WAGEPROOF_DATA_DIR.'));}});
    child.on('error',()=>{clearTimeout(timer);reject(new Error('Python 3 is required to safely open local case storage.'));});
    child.on('exit',code=>{clearTimeout(timer);if(!acquired)reject(new Error(`Could not acquire the local storage lock (${code}).`));else if(!released){console.error('Local storage ownership was lost; stopping to preserve case integrity.');process.exit(1);}});
  });
  return ()=>{released=true;child.stdin.end();};
}
