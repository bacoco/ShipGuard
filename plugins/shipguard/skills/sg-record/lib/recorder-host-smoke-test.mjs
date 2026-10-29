#!/usr/bin/env node
// Exercise the real recorder main/bridge lifecycle with an isolated Playwright
// boundary. Browser capture itself is covered by recorder-audit-browser-smoke-test.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync, lstatSync, statSync, symlinkSync, linkSync } from 'node:fs';
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
 bridge(JSON.stringify({type:'step',step:{type:'click',text:'First'}}));current='http://local/one';page.emit('domcontentloaded');page.emit('load');
 },20)}else if(stage===3){stage=4;setTimeout(()=>{
 bridge(JSON.stringify({type:'step',step:{type:'click',text:'Next'}}));current='http://local/two';page.emit('domcontentloaded');page.emit('load');
 },20)}else if(stage===4){stage=5;setTimeout(()=>{
 bridge(JSON.stringify({type:'step',step:{type:'click',text:'Idle'}}));current='http://local/one';page.emit('domcontentloaded');page.emit('load');
 },20)}else if(stage===5){stage=6;setTimeout(()=>{
 writeFileSync(new URL('./states.json',import.meta.url),JSON.stringify(states));bridge(JSON.stringify({type:'stop',steps:[]}));
 },20)}
};
page.goto=async()=>{page.emit('framenavigated',frame);page.emit('load');
 const popup=new EventEmitter();popup.isClosed=()=>true;popup.waitForLoadState=async()=>{throw new Error('popup closed')};
 context.emit('page',popup);popup.emit('domcontentloaded');
};
context.exposeBinding=async()=>{};context.addInitScript=async()=>{};
context.exposeFunction=async(name,fn)=>{bridge=fn};context.newPage=async()=>page;
context.newCDPSession=async target=>{if(target.isClosed?.())throw new Error('popup closed');return {send:async()=>{if(process.env.SG_TEST_NAVIGATION_FAILURE==='1'&&current.endsWith('/manual'))throw new Error('fixture CDP failure');const paths=['/start','/paused','/manual','/one','/two'];return {currentIndex:paths.indexOf(new URL(current).pathname),entries:paths.map((path,id)=>({id,url:'http://local'+path,transitionType:['/one','/two'].includes(path)?'link':'typed'}))}},detach:async()=>{}}};
context.storageState=async()=>JSON.parse(process.env.SG_TEST_AUTH_STATE||'{"cookies":[],"origins":[]}');
export const chromium={launch:async()=>{console.log('FIXTURE_BROWSER_LAUNCHED');return {newContext:async options=>{writeFileSync(new URL('./context-options.json',import.meta.url),JSON.stringify(options));return context},close:async()=>{}}}};
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
check('CE-02 host tracks link entry IDs and records the manual return',()=>{
 assert.equal(yaml.match(/action: back/g)?.length,1);
 assert.ok(!yaml.includes('url: "http://local/one"'));
 assert.ok(!yaml.includes('url: "http://local/two"'));
});
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
// All targets use the real CLI and a fake Playwright boundary: no DNS, TLS
// connection, credentials, or browser trust settings are involved.
for(const [label,target,storage] of [
 ['remote','https://recorder.example.invalid/start',null],
 ['remote-storage','https://recorder.example.invalid/start',authPath],
 ['localhost','https://localhost/start',null],
 ['loopback','https://127.0.0.1/start',null],
]){
 execFileSync(process.execPath,[join(root,'sg-record.mjs'),target,'--name='+label,...(storage?['--storage='+storage]:[])],{cwd:root,timeout:10000,stdio:'pipe'});
 const options=JSON.parse(readFileSync(join(root,'node_modules/playwright/context-options.json'),'utf8'));
 check('TLS verification is enabled for '+label,()=>assert.equal(options.ignoreHTTPSErrors??false,false));
 check('existing context options are preserved for '+label,()=>{
  assert.deepEqual(options.viewport,{width:1440,height:900});assert.equal(options.bypassCSP,true);
  assert.equal(options.storageState,storage??undefined);
 });
}
const exportedState = {
 cookies: [{ name: 'fixture', value: 'example', domain: 'local', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }],
 origins: [{ origin: 'http://local', localStorage: [{ name: 'fixture', value: 'example' }] }],
};
function exportStorage(path, mask = 0o022) {
 const run = spawnSync(process.execPath, ['--input-type=module', '-e',
  'process.umask(Number(process.argv[1])); process.argv.splice(1, 1); await import(process.argv[1]);',
  String(mask), join(root, 'sg-record.mjs'), 'http://local/start', '--name=storage-export', '--save-storage='+path],
  { cwd: root, env: { ...process.env, SG_TEST_AUTH_STATE: JSON.stringify(exportedState) }, timeout: 10000, killSignal: 'SIGKILL', encoding: 'utf8' });
 assert.ifError(run.error);
 assert.equal(run.status, 0, run.stderr);
 assert.ok(readFileSync(join(root, 'manifests/recorded-storage-export.yaml'), 'utf8').includes('Alpha'));
 return run.stdout + run.stderr;
}
for (const mask of [0o000, 0o022, 0o027, 0o077]) {
 check('storage export creates a private file under umask '+mask.toString(8), () => {
  const path = join(root, 'auth-umask-'+mask.toString(8)+'.json');
  assert.match(exportStorage(path, mask), /Auth state saved to/);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(readFileSync(path, 'utf8'), JSON.stringify(exportedState, null, 2));
 });
}
check('storage export overwrites an existing private file at the same location', () => {
 const path = join(root, 'auth-private.json');
 writeFileSync(path, 'old state that is longer than the replacement'.repeat(30)); chmodSync(path, 0o600);
 const before = statSync(path);
 assert.match(exportStorage(path), /Auth state saved to/);
 assert.equal(statSync(path).ino, before.ino);
 assert.equal(statSync(path).mode & 0o777, 0o600);
 assert.equal(readFileSync(path, 'utf8'), JSON.stringify(exportedState, null, 2));
});
for (const mode of [0o644, 0o620]) {
 check('storage export refuses a pre-existing file with mode '+mode.toString(8), () => {
  const path = join(root, 'auth-unsafe-'+mode.toString(8)+'.json');
  writeFileSync(path, 'unchanged'); chmodSync(path, mode);
  assert.match(exportStorage(path), /Warning: could not save auth state:/);
  assert.equal(readFileSync(path, 'utf8'), 'unchanged');
  assert.equal(statSync(path).mode & 0o777, mode);
 });
}
check('storage export refuses a symlink without changing its target', () => {
 const target = join(root, 'auth-symlink-target.json'), path = join(root, 'auth-symlink.json');
 writeFileSync(target, 'unchanged'); chmodSync(target, 0o600); symlinkSync(target, path);
 assert.match(exportStorage(path), /Warning: could not save auth state:/);
 assert.ok(lstatSync(path).isSymbolicLink());
 assert.equal(readFileSync(target, 'utf8'), 'unchanged');
});
check('storage export refuses a dangling symlink without creating its target', () => {
 const target = join(root, 'auth-missing-target.json'), path = join(root, 'auth-dangling.json');
 symlinkSync(target, path);
 assert.match(exportStorage(path), /Warning: could not save auth state:/);
 assert.ok(lstatSync(path).isSymbolicLink()); assert.ok(!existsSync(target));
});
check('storage export refuses a hard link without changing either entry', () => {
 const target = join(root, 'auth-hardlink-target.json'), path = join(root, 'auth-hardlink.json');
 writeFileSync(target, 'unchanged'); chmodSync(target, 0o600); linkSync(target, path);
 assert.match(exportStorage(path), /Warning: could not save auth state:/);
 assert.equal(readFileSync(target, 'utf8'), 'unchanged'); assert.equal(readFileSync(path, 'utf8'), 'unchanged');
 assert.equal(statSync(target).nlink, 2);
});
check('storage export refuses a directory', () => {
 const path = join(root, 'auth-directory'); mkdirSync(path);
 assert.match(exportStorage(path), /Warning: could not save auth state:/);
 assert.deepEqual(readdirSync(path), []);
});
check('storage export refuses a FIFO without blocking', () => {
 const path = join(root, 'auth-fifo'); execFileSync('mkfifo', [path]);
 assert.match(exportStorage(path), /Warning: could not save auth state:/);
 assert.ok(lstatSync(path).isFIFO());
});
console.log('Fixture: '+root);process.exitCode=failures?1:0;
