import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validateAnalysis,reconcile,withRevisionComparisons} from '../domain/index.mjs';
import {error,sourceDigest} from './store.mjs';

export const PREPARED_EXAMPLE_ID='prepared-example';
const FIXTURE=fileURLToPath(new URL('../examples/prepared-walkthrough/',import.meta.url));
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const string=(value,max=2000)=>typeof value==='string'&&value.length>0&&value.length<=max;
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const pick=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value[key]]));
function requireValid(condition){if(!condition)throw new Error('Prepared fixture failed verification.');}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

export function preparedExportProvenance(caseRecord,revision){
  if(caseRecord?.id!==PREPARED_EXAMPLE_ID||caseRecord.readOnly!==true||!caseRecord.preparedExample)return null;
  const example=caseRecord.preparedExample;
  return {...pick(example,['label','sourceRelease','recordedAt','fictional','recordedModelOutputs','reviewMeaning','limitations','manifestSha256','originalCaseSha256']),review:pick(revision.review,['status','at','note'])};
}
export function labelPreparedExport(markdown,caseRecord,revision){
  const provenance=preparedExportProvenance(caseRecord,revision);if(!provenance)return markdown;
  const inline=value=>String(value).replace(/[\r\n]+/g,' ').replace(/[\\`*_[\]<>]/g,'\\$&');
  const notice=[
    '> **Prepared fictional example · recorded output**',
    `> Recorded from ${inline(provenance.sourceRelease)} on ${inline(provenance.recordedAt)}. No new analysis or review was performed for this export.`,
    `> ${inline(provenance.reviewMeaning)}`,
    `> Recorded review for revision ${revision.number}: ${inline(provenance.review.at)}. ${inline(provenance.review.note)}`,
    ...provenance.limitations.map(item=>'> '+inline(item)),
  ].join('\n>\n');
  // Keep the document title first; ordinary exports are byte-for-byte unchanged.
  const heading=markdown.match(/^# [^\n]+\n/);
  return heading?heading[0]+'\n'+notice+'\n'+markdown.slice(heading[0].length):notice+'\n\n'+markdown;
}

// Only these bundled text files are accepted. This is not a case-import API,
// and the manifest cannot choose an executable or an arbitrary filesystem path.
async function readMember(directory,member,maxBytes){
  requireValid(member==='manifest.json'||member==='case.json'||/^originals\/[a-zA-Z0-9_-]{1,80}$/.test(member));
  requireValid((await lstat(directory)).isDirectory());
  if(member.startsWith('originals/'))requireValid((await lstat(path.join(directory,'originals'))).isDirectory());
  const file=await open(path.join(directory,member),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const info=await file.stat();requireValid(info.isFile()&&info.size>0&&info.size<=maxBytes);
    const bytes=await file.readFile();requireValid(bytes.length===info.size&&bytes.length<=maxBytes);
    return bytes;
  }finally{await file.close();}
}
async function readBoundMember(directory,descriptor,expectedPath,maxBytes){
  requireValid(descriptor&&descriptor.path===expectedPath&&Number.isSafeInteger(descriptor.bytes)&&descriptor.bytes>0&&descriptor.bytes<=maxBytes&&hash(descriptor.sha256));
  const bytes=await readMember(directory,expectedPath,maxBytes);
  requireValid(bytes.length===descriptor.bytes&&sha256(bytes)===descriptor.sha256);
  return bytes;
}

// The optional directory exists for isolated fixture-validation tests. The HTTP
// service always uses the fixed bundled directory above; it accepts no override.
export async function loadPreparedExample(directory=FIXTURE){
  try{
    const manifestBytes=await readMember(directory,'manifest.json',32_000);
    const manifest=JSON.parse(manifestBytes.toString('utf8'));
    requireValid(manifest.schemaVersion===1&&manifest.caseId===PREPARED_EXAMPLE_ID);
    requireValid(string(manifest.title,160)&&string(manifest.description,1000)&&string(manifest.sourceRelease,160)&&timestamp(manifest.recordedAt));
    requireValid(manifest.provenance?.fictional===true&&manifest.provenance?.recordedModelOutputs===true&&hash(manifest.provenance.originalCaseSha256)&&string(manifest.provenance.reviewMeaning));
    requireValid(Array.isArray(manifest.limitations)&&manifest.limitations.length>0&&manifest.limitations.length<=12&&manifest.limitations.every(item=>string(item)));
    requireValid(Array.isArray(manifest.originals)&&manifest.originals.length>0&&manifest.originals.length<=12);
    const raw=JSON.parse((await readBoundMember(directory,manifest.caseFile,'case.json',2_000_000)).toString('utf8'));
    requireValid(identifier(raw.id)&&string(raw.title,160)&&Number.isSafeInteger(raw.version)&&raw.version>0);
    requireValid(timestamp(raw.createdAt)&&timestamp(raw.updatedAt)&&raw.createdAt<=raw.updatedAt&&raw.updatedAt<=manifest.recordedAt);
    requireValid(raw.context&&['worker','employer','claimNumber','recipient'].every(key=>typeof raw.context[key]==='string'&&raw.context[key].length<=2000)&&['unknown','pending-claim','no-claim'].includes(raw.context.stage));
    requireValid(Array.isArray(raw.sources)&&raw.sources.length===manifest.originals.length&&new Set(raw.sources.map(s=>s.id)).size===raw.sources.length);
    requireValid(new Set(manifest.originals.map(s=>s.sourceId)).size===raw.sources.length);
    const originals=new Map(),sources=[];
    for(const source of raw.sources){
      requireValid(identifier(source.id)&&string(source.name,180)&&path.basename(source.name)===source.name&&!/[\r\n\\]/.test(source.name));
      requireValid(['evidence','filed-original','worker-account','correction'].includes(source.kind)&&hash(source.sha256)&&Number.isSafeInteger(source.size));
      requireValid(timestamp(source.createdAt)&&source.createdAt>=raw.createdAt&&source.createdAt<=raw.updatedAt);
      const mime={'.md':'text/markdown','.txt':'text/plain','.csv':'text/csv'}[path.extname(source.name).toLowerCase()];
      requireValid(mime&&source.mime===mime&&source.extraction?.method==='utf8-text'&&Array.isArray(source.extraction.warnings)&&source.extraction.warnings.length===0);
      const descriptor=manifest.originals.find(item=>item.sourceId===source.id);
      const bytes=await readBoundMember(directory,descriptor,`originals/${source.id}`,200_000);
      requireValid(bytes.length===source.size&&sha256(bytes)===source.sha256);
      // Match the existing text extractor's import normalization exactly.
      const decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      const text=decoded.replace(/\r\n?/g,'\n').replace(/\f/g,'\n[Page break]\n').trim();
      requireValid(!decoded.includes('\0')&&string(text,200_000)&&text===source.text&&source.lineCount===text.split('\n').length);
      originals.set(source.id,bytes);
      sources.push(pick(source,['id','name','kind','sha256','size','createdAt','mime','text','extraction','lineCount']));
    }
    requireValid(sources.reduce((sum,source)=>sum+source.text.length,0)<=200_000);
    requireValid(Array.isArray(raw.revisions)&&raw.revisions.length>0&&raw.revisions.length<=12&&new Set(raw.revisions.map(r=>r.id)).size===raw.revisions.length);
    const revisions=[];
    for(const [index,revision] of raw.revisions.entries()){
      requireValid(identifier(revision.id)&&revision.number===index+1&&timestamp(revision.createdAt)&&revision.createdAt>=raw.createdAt&&revision.createdAt<=raw.updatedAt);
      requireValid(index===0||revision.createdAt>=revisions[index-1].createdAt);
      requireValid(revision.origin==='model'&&typeof revision.reason==='string'&&revision.reason.length<=5000&&hash(revision.sourceDigest));
      requireValid(Array.isArray(revision.sourceIds)&&revision.sourceIds.length>0&&new Set(revision.sourceIds).size===revision.sourceIds.length);
      const snapshot=sources.filter(source=>revision.sourceIds.includes(source.id));
      requireValid(isDeepStrictEqual(snapshot.map(source=>source.id),revision.sourceIds));
      requireValid(snapshot.every(source=>source.createdAt<=revision.createdAt)&&revision.sourceDigest===sourceDigest({sources:snapshot}));
      requireValid(index===0||revisions[index-1].sourceIds.every(id=>revision.sourceIds.includes(id)));
      requireValid(validateAnalysis(revision.analysis,snapshot).valid);
      requireValid(isDeepStrictEqual(reconcile(revision.analysis),revision.calculation));
      const review=revision.review;
      requireValid(review?.status==='reviewed'&&timestamp(review.at)&&review.at>=revision.createdAt&&review.at<=manifest.recordedAt&&string(review.note,2000));
      // Rebuild derived comparisons and discard saved job/provider/cache fields.
      revisions.push({...pick(revision,['id','number','createdAt','reason','sourceDigest','sourceIds','origin','analysis','calculation']),review:pick(review,['status','at','note'])});
    }
    const current=revisions.at(-1);
    requireValid(raw.currentRevisionId===current.id&&raw.reviewedRevisionId===current.id&&raw.reviewedSourceDigest===current.sourceDigest&&current.sourceDigest===sourceDigest({sources}));
    const metadata={available:true,caseId:PREPARED_EXAMPLE_ID,title:manifest.title,description:manifest.description,label:'Prepared fictional example',sourceRelease:manifest.sourceRelease,recordedAt:manifest.recordedAt,fictional:true,recordedModelOutputs:true,reviewMeaning:manifest.provenance.reviewMeaning,limitations:manifest.limitations,manifestSha256:sha256(manifestBytes),originalCaseSha256:manifest.provenance.originalCaseSha256};
    const caseRecord=withRevisionComparisons({...pick(raw,['title','version','createdAt','updatedAt','currentRevisionId','reviewedRevisionId','reviewedSourceDigest']),id:PREPARED_EXAMPLE_ID,context:pick(raw.context,['worker','employer','stage','claimNumber','recipient']),sources,revisions,exampleId:identifier(raw.exampleId)?raw.exampleId:null,activeJobId:null,lastJobId:null,importedPhases:[],activity:[],readOnly:true,preparedExample:{...metadata}});
    return {metadata:freeze(metadata),caseRecord:freeze(caseRecord),readOriginal:async source=>{
      const bytes=originals.get(source?.id);
      if(!bytes)throw error('NOT_FOUND','Source not found.',404);
      return Buffer.from(bytes);
    }};
  }catch{
    throw error('PREPARED_EXAMPLE_UNAVAILABLE','The prepared example could not be verified. Restore the complete local release and try again; your own saved cases are unchanged.',503);
  }
}
