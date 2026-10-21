#!/usr/bin/env node
// Regression cases for the recorder audit. No external dependencies.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as readline from 'node:readline';
import { PassThrough } from 'node:stream';
import { actionsToYaml } from './actions-to-yaml.mjs';
const source = readFileSync(new URL('../sg-record.mjs', import.meta.url), 'utf8');
let failures = 0;
function check(id, fn) {
  try { fn(); console.log(`PASS ${id}`); }
  catch (e) { failures++; console.error(`FAIL ${id}: ${e.message.slice(0, 350)}`); }
}
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const state = vm.createContext({ console: { log() {} }, stopped: false, allSteps: [], paused: false, startTime: 1 });
vm.runInContext(section('function normalizeUrl', 'function stepDetail') + '\nfunction stepDetail(){return "";}\n' +
  'globalThis.api={recordStep,handleBridgeEvent,get steps(){return allSteps},get paused(){return paused}};', state);
state.api.recordStep({ type: 'open', url: 'http://local/' });
state.api.recordStep({ type: 'click', text: 'Alpha' });
state.api.recordStep({ type: 'click', text: 'Bravo' });
// Toolbar receives canonical steps at injection, so visible index 2 is Bravo.
state.api.handleBridgeEvent({ type: 'delete', index: 2 });
check('r1-z03-001 deletion retains initial open and Alpha', () => assert.deepEqual(Array.from(state.api.steps, s=>s.type==='open'?'open':s.text), ['open','Alpha']));
state.api.handleBridgeEvent({ type: 'pause' });
check('r1-z03-006 Node retains pause across documents', () => assert.equal(state.api.paused, true));
const input = new PassThrough(); const output = new PassThrough();
const questionContext = vm.createContext({ readline: { createInterface: () => readline.createInterface({input, output}) }, process: {stdin:input,stdout:output}, result:null });
vm.runInContext(section('function askQuestion', '/* ── Main') + '\naskQuestion("Name: ").then(v=>globalThis.result=v);', questionContext);
input.write('login-flow\n');
await new Promise(resolve => setImmediate(resolve));
check('r1-z03-003 readline preserves provided name', () => assert.equal(questionContext.result,'login-flow'));
const yaml = actions => actionsToYaml(actions, {name:'regression',baseUrl:'http://local'});
check('r1-z03-008 CSS fallback stays a selector', () => { const y=yaml([{type:'click',selector:'#save'}]); assert.match(y,/selector: "#save"/); assert.doesNotMatch(y,/target: "#save"/); });
check('r1-z03-010 URL YAML escapes round-trip', () => { const y=yaml([{type:'open',url:'http://local/?q=\\draft"quoted'}]); const scalar=y.split('\n').find(s=>s.trim().startsWith('url:')).trim().slice(5); assert.equal(JSON.parse(scalar),'{base_url}/?q=\\draft"quoted'); });
check('r1-z03-014 Enter restores field focus', () => assert.match(yaml([{type:'press',key:'Enter',selector:'#q',text:'Search'}]), /selector: "#q"/));
check('r1-z03-015 observed SPA navigation asserts instead of loading', () => { const y=yaml([{type:'open',url:'http://local/result',observed:true}]); assert.match(y,/action: assert_url/); assert.doesNotMatch(y,/action: open/); });
check('r1-z03-019 empty checks fail usefully', () => assert.throws(()=>yaml([{type:'check',selector:'#empty',text:''}]), /check.*text/i));
check('r1-z03-020 chosen check retains its scope', () => {
  assert.match(yaml([{type:'check',selector:'#result',text:'Ready'}]), /selector: "#result"/);
  assert.match(yaml([{type:'check',selector:'#result',text:'Detailed content '.repeat(8)}]), /matching CSS selector #result/);
});
process.exitCode=failures?1:0;
