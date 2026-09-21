import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,unlink,mkdtemp,rm,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {id,now,error,caseDir,touch,saveCase} from './store.mjs';
const exec=promisify(execFile);
export const limits={filesPerRequest:12,fileBytes:12*1024*1024,requestBytes:40*1024*1024,caseCharacters:200000,pdfPages:40,pdfOcrPages:12,pdfExtractionMs:120000,pdfRasterDpi:140,pdfRasterMaxDimension:2200,pdfRasterBytes:20*1024*1024};
const types={'.txt':'text/plain','.md':'text/markdown','.csv':'text/csv','.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'};

async function readPdf({target,name,buffer}){
  if(!buffer.subarray(0,1024).includes(Buffer.from('%PDF-')))throw error('INVALID_FILE',`${name} is not a readable PDF.`);
  const deadline=Date.now()+limits.pdfExtractionMs;
  const timeout=max=>{const left=deadline-Date.now();if(left<=0)throw error('PDF_EXTRACTION_TIMEOUT',`${name}: PDF reading exceeded two minutes. Import fewer pages as PNG/JPEG, or add a transcription.`,422);return Math.min(max,left);};
  const info=await exec('pdfinfo',[target],{timeout:timeout(15000),maxBuffer:1000000});
  const pages=Number(info.stdout.match(/^Pages:\s*(\d+)/m)?.[1]);
  if(!pages||pages>limits.pdfPages)throw error('PDF_LIMIT',`${name}: use a PDF of at most 40 pages.`);
  const r=await exec('pdftotext',['-layout','-enc','UTF-8',target,'-'],{timeout:timeout(45000),maxBuffer:3000000});
  const text=r.stdout;
  // Preserve the declared image-only-PDF recovery path. Mixed PDFs below must
  // never be accepted solely because an unrelated text header was readable.
  if(text.trim().length<15)throw error('PDF_NO_TEXT',`${name} has no extractable text. Import page images as PNG/JPEG for OCR, or add a transcription.`);
  let imageInfo;
  try{imageInfo=await exec('pdfimages',['-list',target],{timeout:timeout(15000),maxBuffer:1000000});}
  catch(e){if(e.status)throw e;throw error(e.code==='ENOENT'?'EXTRACTOR_UNAVAILABLE':'PDF_IMAGE_CHECK_FAILED',`${name}: could not check the PDF for scanned content${e.code==='ENOENT'?' because Poppler pdfimages is unavailable':''}. Import page images as PNG/JPEG, or add a transcription; partial PDF text was not imported.`,e.code==='ENOENT'?503:422);}
  const imagePages=[...new Set([...imageInfo.stdout.matchAll(/^\s*(\d+)\s+\d+\s+\S+\s+\d+\s+\d+\s/gm)].map(m=>Number(m[1])))].sort((a,b)=>a-b);
  if(imagePages.some(p=>p<1||p>pages))throw error('PDF_IMAGE_CHECK_FAILED',`${name}: the PDF image page list could not be read safely. Import page images as PNG/JPEG, or add a transcription.`,422);
  if(!imagePages.length)return {text,method:'pdftotext-layout',warnings:[]};
  if(imagePages.length>limits.pdfOcrPages)throw error('PDF_OCR_LIMIT',`${name}: this PDF has ${imagePages.length} image-bearing pages. Import sections with at most ${limits.pdfOcrPages} such pages, or use PNG/JPEG page images or a transcription.`,422);
  const dir=await mkdtemp(path.join(tmpdir(),'wageproof-pdf-'));
  const layers=text.split('\f'),ocr=new Map(),emptyOcrPages=[];
  try{
    for(const page of imagePages){
      const prefix=path.join(dir,`page-${page}`),image=prefix+'.png';
      await exec('pdftoppm',['-f',String(page),'-l',String(page),'-r',String(limits.pdfRasterDpi),'-scale-to',String(limits.pdfRasterMaxDimension),'-singlefile','-png',target,prefix],{timeout:timeout(30000),maxBuffer:1000000});
      if((await stat(image)).size>limits.pdfRasterBytes)throw error('PDF_OCR_LIMIT',`${name}: rendered page ${page} is too large for local OCR. Import a smaller relevant section or add a transcription.`,422);
      const pageText=await exec('tesseract',[image,'stdout','-l','eng'],{timeout:timeout(45000),maxBuffer:1000000});
      if(!pageText.stdout.trim()){
        if(!layers[page-1]?.trim())throw error('PDF_OCR_NO_TEXT',`${name}: image-bearing page ${page} has no readable text layer and OCR found no readable text. Import a sharper PNG/JPEG page image or add a transcription; partial PDF text was not imported.`,422);
        emptyOcrPages.push(page);
      }
      ocr.set(page,pageText.stdout.trim()||'[OCR returned no readable text on this image-bearing page. Only its text layer is available; inspect the original image content.]');
      await unlink(image);
    }
  }catch(e){if(e.status)throw e;throw error(e.code==='ENOENT'?'EXTRACTOR_UNAVAILABLE':'PDF_OCR_FAILED',`${name}: could not finish reading scanned PDF content${e.code==='ENOENT'?' because Poppler pdftoppm or Tesseract is unavailable':''}. Import page images as PNG/JPEG, or add a transcription; partial PDF text was not imported.`,e.code==='ENOENT'?503:422);}
  finally{await rm(dir,{recursive:true,force:true});}
  const sections=['[Extraction note: text-layer and OCR views below refer to the SAME original PDF pages. Repeated wording or amounts are not additional records or payments. Inspect the original for disagreements.]'];
  for(let page=1;page<=pages;page++){
    sections.push(`[Original PDF page ${page} - text layer]\n${layers[page-1]?.trim()||'[No extractable text layer on this page.]'}`);
    if(ocr.has(page))sections.push(`[Original PDF page ${page} - OCR view of the SAME page, not an additional record or payment]\n${ocr.get(page)}`);
  }
  const warnings=[`Image-bearing PDF page${imagePages.length===1?'':'s'} ${imagePages.join(', ')} also required English OCR. OCR may misread or miss text; inspect the original and correct consequential readings. Text-layer and OCR views describe the SAME original pages, not additional records or payments.`];
  if(emptyOcrPages.length)warnings.push(`OCR returned no readable text on image-bearing page${emptyOcrPages.length===1?'':'s'} ${emptyOcrPages.join(', ')}. The text layer is retained, but image content may remain unread. Inspect the original and import a sharper page image or add a transcription.`);
  return {text:sections.join('\n\n'),method:'pdftotext-layout+tesseract-english',warnings};
}
export async function extractFile({buffer,name,target}){
  const ext=path.extname(name).toLowerCase(),mime=types[ext];
  if(!mime)throw error('UNSUPPORTED_FILE',`${name}: use TXT, Markdown, CSV, PDF, PNG or JPEG.`);
  if(!buffer.length)throw error('EMPTY_FILE',`${name} is empty.`);
  if(buffer.length>limits.fileBytes)throw error('FILE_TOO_LARGE',`${name} exceeds 12 MiB.`);
  await writeFile(target,buffer,{mode:0o600});let text='',method='utf8-text',warnings=[];
  try{
    if(ext==='.pdf'){
      ({text,method,warnings}=await readPdf({target,name,buffer}));
    }else if(mime.startsWith('image/')){
      const png=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));const jpeg=buffer[0]===255&&buffer[1]===216;
      if(!png&&!jpeg)throw error('INVALID_IMAGE',`${name} is not a PNG or JPEG image.`);
      const r=await exec('tesseract',[target,'stdout','-l','eng'],{timeout:90000,maxBuffer:3000000});text=r.stdout;method='tesseract-english';warnings.push('OCR text may differ from the image. Inspect the original and correct consequential readings.');
      if(text.trim().length<3)throw error('OCR_NO_TEXT',`${name}: no readable text was found. Use a sharper image or add a transcription.`);
    }else{
      text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);if(text.includes('\0'))throw error('INVALID_TEXT',`${name} contains binary data.`);
    }
  }catch(e){if(e.status)throw e;if(e.code==='ENOENT')throw error('EXTRACTOR_UNAVAILABLE',`The local ${mime.startsWith('image/')?'Tesseract':'PDF'} extraction tool is unavailable. Import text or install the documented local tool.`,503);throw error('EXTRACTION_FAILED',`${name} could not be read. Use an unencrypted supported file or add its text as a note.`,422);}
  text=text.replace(/\r\n?/g,'\n').replace(/\f/g,'\n[Page break]\n').trim();
  if(!text)throw error('EMPTY_TEXT',`${name} contains no readable text.`);
  if(text.length>limits.caseCharacters)throw error('TEXT_LIMIT',`${name} is too long for this local review. Import a smaller relevant section.`);
  return {mime,text,extraction:{method,warnings}};
}
export async function addFiles(c,files,kind='evidence'){
  if(!files.length)throw error('NO_FILES','Choose at least one file.');if(files.length>limits.filesPerRequest)throw error('TOO_MANY_FILES','Import at most12 files at a time.');
  if(!['evidence','filed-original','worker-account','correction'].includes(kind))throw error('INVALID_KIND','Unsupported source type.');
  const dir=path.join(caseDir(c.id),'sources');await mkdir(dir,{recursive:true,mode:0o700});const pending=[],created=[];let duplicates=0;
  try{
    for(const file of files){const name=path.basename(String(file.name||'record.txt')).slice(0,180);const buffer=Buffer.from(file.buffer);const hash=createHash('sha256').update(buffer).digest('hex');
      if(c.sources.some(s=>s.sha256===hash)||pending.some(s=>s.sha256===hash)){duplicates++;continue;}
      const sourceId=id(),target=path.join(dir,sourceId);created.push(target);const parsed=await extractFile({buffer,name,target});
      pending.push({id:sourceId,name,kind,sha256:hash,size:buffer.length,createdAt:now(),...parsed,lineCount:parsed.text.split('\n').length});
    }
    if([...c.sources,...pending].reduce((n,s)=>n+s.text.length,0)>limits.caseCharacters)throw error('CASE_LIMIT','This case exceeds 200,000 extracted characters. Use a separate case for unrelated periods.');
    if(pending.length){c.sources.push(...pending);touch(c,'sources-added',`${pending.length} record${pending.length===1?'':'s'} added${duplicates?`; ${duplicates} exact duplicate${duplicates===1?'':'s'} skipped`:''}.`);await saveCase(c);}
    return c;
  }catch(e){await Promise.all(created.map(f=>unlink(f).catch(()=>{})));throw e;}
}
export async function sourceBytes(caseId,sourceId){return readFile(path.join(caseDir(caseId),'sources',sourceId));}
