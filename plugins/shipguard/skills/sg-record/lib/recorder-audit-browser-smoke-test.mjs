#!/usr/bin/env node
// Real capture regressions on local sample data; dedicated named session only.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const here=dirname(fileURLToPath(import.meta.url));
const output=resolve(here,'../../../../../visual-tests/_results/recorder-browser');
mkdirSync(output,{recursive:true});
const phase=process.argv[2]||'after';
const exec=promisify(execFile);const session=`sg-recorder-audit-${process.pid}`;
const toolbar=readFileSync(join(here,'recorder-toolbar.js'),'utf8').replace("'__CSS_PLACEHOLDER__'",JSON.stringify(readFileSync(join(here,'recorder-toolbar.css'),'utf8')));
const html=`<!doctype html><html><head><title>Recorder audit</title><style>body{font:20px system-ui;padding:40px}label,input,button{margin:12px}#sg-recorder{z-index:9999}</style></head><body><h1>Local recorder sample</h1><button id=a>Alpha</button><button id=b>Bravo</button><label><input type=checkbox id=c>Checkbox</label><form><label for=q>Search</label><input id=q value=prefilled><input type=submit id=submit value=Send></form><button id=route>Internal route</button><p id=result>Ready</p><img id=empty alt="Sample icon" width=40 height=40><script>document.querySelector('form').onsubmit=e=>{e.preventDefault();document.querySelector('#result').textContent='Submitted'};document.querySelector('#route').onclick=()=>{history.pushState({},'', '/inside');document.querySelector('#result').textContent='Inside'}</script></body></html>`;
const server=createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end(html)});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const url=`http://127.0.0.1:${server.address().port}`;
const ab=async(...args)=>(await exec('agent-browser',['--session',session,...args],{timeout:60000,maxBuffer:4*1024*1024})).stdout;
const ev=async(code)=>{const r=JSON.parse(await ab('--json','eval','-b',Buffer.from(code).toString('base64')));assert.equal(r.success,true);return r.data.result};
const inject=async(state)=>{await ab('open',url);await ev(`sessionStorage.clear();window.__events=[];window.__sgBridge=s=>window.__events.push(JSON.parse(s));window.__sgRecorderState=${JSON.stringify(state||{steps:[],paused:false,startTime:Date.now()})};${toolbar}`)};
let failures=0;const evidence=[];
async function check(id,fn){try{await fn();console.log(`PASS ${id}`);evidence.push({id,pass:true})}catch(e){failures++;console.error(`FAIL ${id}: ${e.message}`);evidence.push({id,pass:false,error:e.message})}}
try{
await inject({steps:[{type:'open',url},{type:'click',text:'Alpha'},{type:'click',text:'Bravo'}],paused:false,startTime:Date.now()});
await ab('screenshot',join(output,`${phase}-canonical.png`),'--full');
await check('r1-z03-001 canonical list and deletion',async()=>{assert.equal(await ev('document.querySelectorAll(".sg-step").length'),3);await ab('click','.sg-step:nth-child(3) .sg-step-del');assert.equal(await ev('window.__events.at(-1).index'),2)});
await inject();await ab('click','#c');await ab('click','#submit');await ab('click','#q');await ab('press','Enter');
const steps=await ev('window.__events.filter(e=>e.type==="step").map(e=>e.step)');
await check('r1-z03-004 checkbox records click without fill',()=>{assert.equal(steps.filter(s=>s.selector==='#c'&&s.type==='click').length,1);assert.equal(steps.filter(s=>s.selector==='#c'&&s.type==='fill').length,0)});
await check('r1-z03-005 submit input records click',()=>assert.equal(steps.filter(s=>s.selector==='#submit'&&s.type==='click').length,1));
await check('r1-z03-014 Enter includes field selector',()=>assert.equal(steps.find(s=>s.type==='press')?.selector,'#q'));
await ab('click','#route');await ab('screenshot',join(output,`${phase}-capture.png`),'--full');
await check('r1-z03-015 SPA transition is observational',async()=>assert.equal((await ev('window.__events.filter(e=>e.type==="step"&&e.step.type==="open").at(-1)?.step'))?.observed,true));
await inject({steps:[{type:'open',url}],paused:true,startTime:Date.now()});await ab('click','#a');
await check('r1-z03-006 pause restored in next document',async()=>{assert.equal(await ev('window.__events.filter(e=>e.type==="step").length'),0);assert.equal(await ev('document.querySelector(".sg-rec-dot").classList.contains("paused")'),true)});
await ab('screenshot',join(output,`${phase}-paused.png`),'--full');
await inject();await ab('click','#sg-check-btn');
await ev(`const r=document.querySelector('#empty').getBoundingClientRect();document.querySelector('.sg-check-overlay').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.x+10,clientY:r.y+10}));`);
await check('r1-z03-019 empty check is rejected visibly',async()=>{assert.equal(await ev('window.__events.filter(e=>e.type==="step").length'),0);assert.match(await ev('document.querySelector("#sg-recorder").textContent'),/text/i)});
await ab('screenshot',join(output,`${phase}-empty-check.png`),'--full');
}finally{try{await ab('close')}finally{await new Promise(done=>server.close(done))}}
writeFileSync(join(output,`${phase}-evidence.json`),JSON.stringify({session,url,evidence},null,2));
process.exitCode=failures?1:0;
