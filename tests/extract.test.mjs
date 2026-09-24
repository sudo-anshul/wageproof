import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,mkdir,rm,symlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractFile,limits} from '../server/extract.mjs';

// Actual independently authored PDF fixtures. No application/model jobs.
// Stub tools below exercise explicit failure boundaries only, not OCR quality.
const fixtures=path.join(path.dirname(fileURLToPath(import.meta.url)),'fixtures/extraction');
const toolPaths=Object.fromEntries(['pdfinfo','pdftotext','pdfimages','pdftoppm','tesseract'].map(name=>[name,spawnSync('/usr/bin/which',[name],{encoding:'utf8'}).stdout?.trim()]));
const available=Object.values(toolPaths).every(Boolean);
const real={skip:available?false:'Requires local Poppler and Tesseract (see README).'};
let root,sequence=0;
before(async()=>{root=await mkdtemp(path.join(tmpdir(),'wageproof-extract-test-'));});
after(async()=>{await rm(root,{recursive:true,force:true});});
async function extract(name){const buffer=await readFile(path.join(fixtures,name)),target=path.join(root,`original-${++sequence}`);const result=await extractFile({buffer,name,target});assert.deepEqual(await readFile(target),buffer,'original bytes must remain unchanged');return result;}

test('real text PDF preserves its exact pre-repair extracted text',real,async()=>{
  const r=await extract('text-two-pages.pdf');
  assert.equal(r.text,await readFile(path.join(fixtures,'text-two-pages.expected.txt'),'utf8'));
  assert.equal(r.extraction.method,'pdftotext-layout');
  assert.deepEqual(r.extraction.warnings,[]);
});

for(const name of ['mixed-text-and-image-pages.pdf','mixed-text-and-image-same-page.pdf'])test(`real hybrid PDF retains the scanned correction: ${name}`,real,async()=>{
  const r=await extract(name);
  for(const value of ['FMT-LATE-725','$287.40','$43.30','$244.10','The earlier statement is superseded.'])assert.ok(r.text.includes(value),`missing critical scanned text: ${value}`);
  assert.match(r.text,/OCR view of the SAME page, not an additional record or payment/);
  assert.match(r.text,/Repeated wording or amounts are not additional records or payments/);
  assert.equal(r.extraction.method,'pdftotext-layout+tesseract-english');
  assert.match(r.extraction.warnings.join(' '),/OCR may misread or miss text/);
});

test('image-only PDF keeps its declared image-import/transcription recovery',real,async()=>{
  await assert.rejects(extract('image-only.pdf'),e=>e.code==='PDF_NO_TEXT'&&/PNG\/JPEG.*transcription/.test(e.message));
});

async function withTools(names,run,{rasterScript,ocrScript}={}){
  const dir=await mkdtemp(path.join(root,'tool-boundary-')),bin=path.join(dir,'bin'),temp=path.join(dir,'temp');
  await mkdir(bin);await mkdir(temp);
  for(const name of names)await symlink(toolPaths[name],path.join(bin,name));
  if(rasterScript)await writeFile(path.join(bin,'pdftoppm'),`#!${process.execPath}\n${rasterScript}\n`,{mode:0o700});
  if(ocrScript)await writeFile(path.join(bin,'tesseract'),`#!${process.execPath}\n${ocrScript}\n`,{mode:0o700});
  const previousPath=process.env.PATH,previousTmp=process.env.TMPDIR;
  process.env.PATH=bin;process.env.TMPDIR=temp;
  try{await run();assert.deepEqual(await readdir(temp),[],'temporary raster directory must be removed');}
  finally{process.env.PATH=previousPath;if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp;}
}

test('missing image inspector refuses a possibly partial PDF extraction',real,async()=>{
  await withTools(['pdfinfo','pdftotext'],async()=>{
    await assert.rejects(extract('mixed-text-and-image-pages.pdf'),e=>e.code==='EXTRACTOR_UNAVAILABLE'&&/partial PDF text was not imported/.test(e.message));
  });
});

test('missing rasterizer refuses hybrid text but text-only PDF still works',real,async()=>{
  await withTools(['pdfinfo','pdftotext','pdfimages'],async()=>{
    await assert.rejects(extract('mixed-text-and-image-pages.pdf'),e=>e.code==='EXTRACTOR_UNAVAILABLE'&&/PNG\/JPEG.*transcription/.test(e.message));
    assert.equal((await extract('text-two-pages.pdf')).text,await readFile(path.join(fixtures,'text-two-pages.expected.txt'),'utf8'));
  });
});

test('raster process failure never returns partial PDF text and cleans temp files',real,async()=>{
  await withTools(['pdfinfo','pdftotext','pdfimages'],async()=>{
    await assert.rejects(extract('mixed-text-and-image-pages.pdf'),e=>e.code==='PDF_OCR_FAILED'&&/partial PDF text was not imported/.test(e.message));
  },{rasterScript:'process.exit(31);'});
});

test('empty OCR refuses textless image pages and explicitly warns on retained text layers',real,async()=>{
  await withTools(['pdfinfo','pdftotext','pdfimages','pdftoppm'],async()=>{
    await assert.rejects(extract('mixed-text-and-image-pages.pdf'),e=>e.code==='PDF_OCR_NO_TEXT'&&/partial PDF text was not imported/.test(e.message));
    const r=await extract('mixed-text-and-image-same-page.pdf');
    assert.match(r.text,/Digital-text cover note/);
    assert.match(r.text,/OCR returned no readable text/);
    assert.match(r.extraction.warnings.join(' '),/image content may remain unread/);
  },{ocrScript:'process.exit(0);'});
});

test('the whole PDF time budget terminates a stalled raster process',real,async()=>{
  const previous=limits.pdfExtractionMs;limits.pdfExtractionMs=500;
  try{await withTools(['pdfinfo','pdftotext','pdfimages'],async()=>{
    const start=Date.now();
    await assert.rejects(extract('mixed-text-and-image-pages.pdf'),e=>['PDF_OCR_FAILED','PDF_EXTRACTION_TIMEOUT'].includes(e.code));
    assert.ok(Date.now()-start<4000,'stalled extraction must honor the total time budget');
  },{rasterScript:'setTimeout(() => process.exit(0), 5000);'});}
  finally{limits.pdfExtractionMs=previous;}
});

test('image-page budget rejects before doing partial OCR',real,async()=>{
  const previous=limits.pdfOcrPages;limits.pdfOcrPages=0;
  try{await assert.rejects(extract('mixed-text-and-image-pages.pdf'),e=>e.code==='PDF_OCR_LIMIT'&&/Import sections/.test(e.message));}
  finally{limits.pdfOcrPages=previous;}
});
