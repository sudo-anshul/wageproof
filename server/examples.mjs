import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createCase,withCase,expectVersion,error,saveCase} from './store.mjs';
import {addFiles} from './extract.mjs';
const root=path.resolve('examples');
const catalog=[
 {id:'01-partial-allocation',title:'Two weeks, one correction',description:'A fictional worker receives one pay correction covering two weeks. Add later allocation detail to see what changes.'},
 {id:'02-payment-identity',title:'A payment, or another copy?',description:'Fictional payroll records describe similar-looking corrections. Keep document views and actual payments separate.'},
 {id:'03-new-issue',title:'Work beyond the time clock',description:'A later explanation introduces an activity that was absent from the starting account.'},
 {id:'04-date-and-support',title:'When did the work happen?',description:'A record gains detail while the difference may stay unchanged.'}
];
export async function listExamples(){return Promise.all(catalog.map(async e=>{const files=await readdir(path.join(root,e.id));return {...e,phases:[0,1,2].map(n=>({id:`phase-${n}`,label:['Starting account','Employer response','Later evidence'][n],fileCount:files.filter(f=>f.startsWith(`phase-${n}-`)).length}))};}));}
async function phaseFiles(exampleId,phaseId){if(!catalog.some(e=>e.id===exampleId)||!/^phase-[012]$/.test(phaseId))throw error('EXAMPLE_NOT_FOUND','Example phase not found.',404);const dir=path.join(root,exampleId);const names=(await readdir(dir)).filter(f=>f.startsWith(phaseId+'-'));return Promise.all(names.map(async name=>({name,buffer:await readFile(path.join(dir,name))})));}
export async function startExample(exampleId){const example=catalog.find(e=>e.id===exampleId);if(!example)throw error('EXAMPLE_NOT_FOUND','Example not found.',404);const c=await createCase({title:example.title,stage:'unknown'});c.exampleId=exampleId;await addFiles(c,await phaseFiles(exampleId,'phase-0'));c.importedPhases=['phase-0'];await saveCase(c);return c;}
export async function addExamplePhase(caseId,phaseId,version){return withCase(caseId,async c=>{expectVersion(c,version);if(!c.exampleId)throw error('NOT_AN_EXAMPLE','This case does not use a fictional example.');if(c.importedPhases.includes(phaseId))return c;const phase=Number(String(phaseId).split('-')[1]);if(phase>0&&!c.importedPhases.includes(`phase-${phase-1}`))throw error('PHASE_ORDER','Add the earlier evidence phase first.');await addFiles(c,await phaseFiles(c.exampleId,phaseId));c.importedPhases.push(phaseId);await saveCase(c);return c;});}
