#!/usr/bin/env node
// Exercise the real recorder main/bridge lifecycle with an isolated Playwright
// boundary. Browser capture itself is covered by recorder-audit-browser-smoke-test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const root=mkdtempSync(join(tmpdir(),'sg-recorder-host-'));
mkdirSync(join(root,'lib'));mkdirSync(join(root,'node_modules/playwright'),{recursive:true});
const files=['sg-record.mjs','lib/actions-to-yaml.mjs','lib/recorder-toolbar.js','lib/recorder-toolbar.css'];
for(const file of files){const target=join(root,file);if(process.argv.includes('--baseline'))writeFileSync(target,execFileSync('git',['show',`b07b242:plugins/shipguard/skills/sg-record/${file}`],{cwd:here}));else copyFileSync(resolve(here,'..',file),target)}
writeFileSync(join(root,'node_modules/playwright/package.json'),JSON.stringify({type:'module',exports:'./index.mjs'}));
writeFileSync(join(root,'node_modules/playwright/index.mjs'),`
import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
let bridge;let stage=0;const states=[];
const context=new EventEmitter();
const page=new EventEmitter();
let current='http://local/start';const frame={url:()=>current};
page.mainFrame=()=>frame;page.url=()=>current;page.isClosed=()=>false;
page.evaluate=async(fn,state)=>{states.push(state)};
page.addScriptTag=async()=>{
 if(stage===0){stage=1;setTimeout(()=>{
 bridge(JSON.stringify({type:'step',step:{type:'click',text:'Alpha'}}));
 bridge(JSON.stringify({type:'pause'}));current='http://local/paused';page.emit('framenavigated',frame);page.emit('domcontentloaded');page.emit('load');
 },20)}else if(stage===1){stage=2;setTimeout(()=>{
 bridge(JSON.stringify({type:'resume'}));current='http://local/manual';page.emit('framenavigated',frame);page.emit('domcontentloaded');page.emit('load');
 },20)}else if(stage===2){stage=3;setTimeout(()=>{
 writeFileSync(new URL('./states.json',import.meta.url),JSON.stringify(states));bridge(JSON.stringify({type:'stop',steps:[]}));
 },20)}
};
page.goto=async()=>{page.emit('framenavigated',frame);page.emit('load');
 const popup=new EventEmitter();popup.isClosed=()=>true;popup.waitForLoadState=async()=>{throw new Error('popup closed')};
 context.emit('page',popup);popup.emit('domcontentloaded');
};
context.exposeFunction=async(name,fn)=>{bridge=fn};context.newPage=async()=>page;
context.newCDPSession=async target=>{if(target.isClosed?.())throw new Error('popup closed');return {send:async()=>{if(process.env.SG_TEST_NAVIGATION_FAILURE==='1'&&current.endsWith('/manual'))throw new Error('fixture CDP failure');return {currentIndex:0,entries:[{url:current,transitionType:'typed'}]}},detach:async()=>{}}};
context.storageState=async()=>({cookies:[],origins:[]});
export const chromium={launch:async()=>{console.log('FIXTURE_BROWSER_LAUNCHED');return {newContext:async()=>context,close:async()=>{}}}};
`);
let failures=0;function check(id,fn){try{fn();console.log('PASS '+id)}catch(e){failures++;console.error('FAIL '+id+': '+e.message)}}
execFileSync(process.execPath,[join(root,'sg-record.mjs'),'http://local/start','--name=host'],{cwd:root,timeout:10000,stdio:'pipe'});
const yaml=readFileSync(join(root,'manifests/recorded-host.yaml'),'utf8');
const states=JSON.parse(readFileSync(join(root,'node_modules/playwright/states.json'),'utf8'));
check('CE-01 already-closed popup preserves the main-page recording',()=>assert.ok(yaml.includes('name: "host"')));
check('r1-z03-001 host injection includes initial open',()=>assert.equal(states[0]?.steps[0]?.type,'open'));
check('r1-z03-006 host reinjection carries pause',()=>assert.ok(states.some(s=>s.paused===true)));
check('r1-z03-007 manual document navigation becomes open',()=>assert.ok(yaml.includes('url: "http://local/manual"')));
check('r1-z03-006 paused navigation is excluded',()=>assert.ok(!yaml.includes('/paused')));
let result='';let status=0;try{result=execFileSync(process.execPath,[join(root,'sg-record.mjs'),'http://local/start','--name=missing','--storage='+join(root,'missing.json')],{cwd:root,timeout:10000,encoding:'utf8',stdio:'pipe'})}catch(e){status=e.status;result=(e.stdout||'')+(e.stderr||'')}
check('r1-z03-011 absent storage fails before launch and save',()=>{assert.equal(status,1);assert.match(result,/Session storage file not found/);assert.ok(!result.includes('FIXTURE_BROWSER_LAUNCHED'));assert.ok(!existsSync(join(root,'manifests/recorded-missing.yaml')))});
const authPath=join(root,'saved-auth.json');status=0;result='';
try{result=execFileSync(process.execPath,[join(root,'sg-record.mjs'),'http://local/start','--name=cdp-failure','--save-storage='+authPath],{cwd:root,env:{...process.env,SG_TEST_NAVIGATION_FAILURE:'1'},timeout:10000,encoding:'utf8',stdio:'pipe'})}catch(e){status=e.status;result=(e.stdout||'')+(e.stderr||'')}
check('CE-01 CDP failure saves captured steps and auth, with a failing exit status',()=>{
 assert.equal(status,1);assert.match(result,/fixture CDP failure/);
 const saved=readFileSync(join(root,'manifests/recorded-cdp-failure.yaml'),'utf8');
 assert.ok(saved.includes('action: open'));assert.ok(saved.includes('Alpha'));
 assert.deepEqual(JSON.parse(readFileSync(authPath,'utf8')),{cookies:[],origins:[]});
});
console.log('Fixture: '+root);process.exitCode=failures?1:0;
