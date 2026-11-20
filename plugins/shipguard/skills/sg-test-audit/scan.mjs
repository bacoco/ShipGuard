#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory } from './inventory.mjs';
import { isSensitivePath } from './paths.mjs';

const SOURCE = new Set((
  'js jsx mjs cjs ts tsx mts cts vue svelte astro html htm xml xaml css scss sass less ' +
  'py rb erb php phtml twig liquid hbs go rs java kt kts scala swift cs c h cpp hpp m mm ' +
  'dart ex exs heex eex clj cljs groovy lua pl pm hs elm fs fsx r sql sh bash zsh ps1 ' +
  'yml yaml graphql gql json toml'
).split(' '));

// Fixed signals, never product verdicts. Keep source values out of exported
// reports; the reviewer can inspect the exact location in the allowed source.
const LEADS = [
  ['visibility', /\b(?:disabled|hidden|invisible|aria-hidden|aria-disabled)\b|\bdisplay\s*:\s*none\b|\bvisibility\s*:\s*hidden|\b(?:v-if|v-show|ngIf|x-show)\b|(?:&&|\?)\s*<(?:(?:[a-z_$][a-z0-9_$]*\.)?(?:button|link|a))\b|\bpointer-events\s*:\s*none|\breturn\s+null\b/i, 'A control or branch may disappear or become unavailable.'],
  ['refusal', /\b(?:deny|forbidden|unauthorized|reject|refus(?:er|é|ed)?|denied|not.allowed|permission.denied)\b|\breturn\s+(?:false|forbid\w*)\b/i, 'A request may stop before reaching its target.'],
  ['waiting', /\b(?:pending|stale|queued|debounce|retry|timeout|waiting|mismatch|conflict)\b|\b(?:expectedVersion|isPending|isStale|isLoading)\b/i, 'Timing or changed state may delay or discard an action.'],
  ['confirmation', /\b(?:confirm(?:ation|ed)?|reconfirm|askForConfirmation|requireConfirmation|showConfirm|userConsent)\b/i, 'The person may have to confirm again.'],
  ['default_or_filter', /\.\s*(?:slice|filter|truncate|take|limit)\s*\(|\?\?|\b(?:default(?:Value)?|fallback|threshold|maxItems|minimum|maximum)\b|\[\s*:\s*\d+\s*\]/i, 'A default, limit or filter may change the requested result.'],
  ['language_routing', /\b(?:keywords?|synonyms?|utterance|intent|vocabulary|lexicon)\b|\b(?:re|regex)\.(?:search|match|isMatch)\s*\(|\.test\(\s*(?:prompt|text|message|input)\b|\b(?:prompt|text|message|input)\s*\.\s*(?:includes|match|startsWith)\b|\b(?:prompt|utterance|message|input|text)\s*(?:===?|in\s+)[\s'"\[({]|\.includes\(\s*(?:prompt|message|input|text)\b/i, 'Words or a pattern may decide what someone meant.'],
  ['skipped_or_success', /\b(?:skip(?:ped)?|xfail|xit|xtest|xdescribe|pass(?:ed)?|success)\b|(?:test|it|describe)\s*\.\s*(?:skip|todo|only)\b|\bexit\s*\(?\s*0\b/i, 'Verify that a reported success actually exercised the intended action.'],
];

function sourcePath(path) {
  return SOURCE.has(extname(path).toLowerCase().slice(1)) ||
    /^(?:SKILL|AGENTS|CLAUDE|GEMINI)\.md$/i.test(basename(path)) ||
    /^(?:Makefile|Rakefile|Dockerfile)$/.test(basename(path));
}

function gitBlobHash(bytes, length) {
  return createHash(length === 64 ? 'sha256' : 'sha1')
    .update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}

export async function scanProject(project = '.', { diff, inventoryOnly = false, paths: reviewedPaths } = {}) {
  if (reviewedPaths !== undefined && (!Array.isArray(reviewedPaths) || reviewedPaths.some(path => typeof path !== 'string'))) {
    throw new Error('Reviewed paths must be a JSON array of relative path strings.');
  }
  const root = await realpath(resolve(project));
  if (isSensitivePath(root) || /(?:^|[\\/])\.(?:git|svn|hg)(?:[\\/]|$)/.test(root)) {
    throw new Error('The selected directory is private or version-control metadata.');
  }
  if (!(await stat(root)).isDirectory()) throw new Error('Select a project directory.');
  const coverage = { scanned: [], unexamined: [], excluded: {}, nested_projects: [], unchanged: 0 };
  const { paths, mode, revision, base, baseFiles } = await inventory(root, diff, coverage);
  if (mode === 'git') coverage.ignored_untracked = 'Ignored untracked paths are not enumerated.';
  const candidates = [];
  const scope = base ? { type: 'diff', ref: diff, base } : { type: 'all' };
  const report = { schema_version: 1, project: root, mode, revision, scope, coverage, candidates };
  const reviewed = reviewedPaths === undefined ? undefined : new Set(reviewedPaths);
  if (reviewed) {
    // Intersect literal names with the enumerated tree. User input is never
    // used as a filesystem path on its own, even if it looks absolute.
    scope.reviewed_path_count = reviewed.size;
    const matched = paths.reduce((n, path) => n + Number(reviewed.has(path)), 0);
    coverage.unmatched_reviewed_paths = reviewed.size - matched;
  }
  if (inventoryOnly) {
    return { ...report, inventory: reviewed ? paths.filter(path => reviewed.has(path)) : paths,
      inventory_scope: 'current working tree paths; no source contents inspected' };
  }
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  for (const path of paths) {
    if (reviewed && !reviewed.has(path)) {
      coverage.unexamined.push({ path, reason: 'not_selected' });
      continue;
    }
    if (!sourcePath(path)) {
      coverage.unexamined.push({ path, reason: 'no_text_scanner' });
      continue;
    }
    const absolute = join(root, path);
    let file;
    try {
      // Recheck the path just before reading, including intermediate directories.
      if (await realpath(absolute) !== absolute) throw new Error('path_changed');
      file = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      if (!(await file.stat()).isFile()) throw new Error('not_regular');
      const bytes = await file.readFile();
      const previous = baseFiles?.get(path);
      if (previous && gitBlobHash(bytes, previous.length) === previous) { coverage.unchanged++; continue; }
      if (bytes.includes(0)) throw new Error('binary');
      let source;
      try { source = utf8.decode(bytes); } catch { throw new Error('unsupported_encoding'); }
      coverage.scanned.push(path);
      const lines = source.split(/\r\n|[\r\n]/);
      for (const [index, line] of lines.entries()) {
        for (const [category, pattern, signal] of LEADS) {
          const earlyExit = category === 'refusal' && /\b(?:if|unless|guard)\b/.test(line) && /\b(?:return|throw|raise|abort)\b/.test(line);
          if (pattern.test(line) || earlyExit) candidates.push({ path, line: index + 1, category, signal });
        }
      }
    } catch (error) {
      // Never echo decoded text, filesystem absolute paths, or exception payloads.
      const reason = error.code || (['binary','unsupported_encoding','not_regular','path_changed'].includes(error.message) ? error.message : 'unavailable');
      coverage.unexamined.push({ path, reason });
    } finally {
      await file?.close();
    }
  }
  coverage.unexamined.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return report;
}

export async function runScan(args, { stdin = process.stdin } = {}) {
  let project, diff;
  let inventoryOnly = false, readPaths = false;
  for (const arg of args) {
    if (arg.startsWith('--diff=') && diff === undefined && arg.length > 7) diff = arg.slice(7);
    else if (arg === '--inventory') inventoryOnly = true;
    else if (arg === '--paths-stdin') readPaths = true;
    else if (!arg.startsWith('--') && project === undefined) project = arg;
    else throw new Error('Usage: scan.mjs [project] [--diff=BASE] [--inventory] [--paths-stdin]');
  }
  let paths;
  if (readPaths) {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
    try { paths = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Pass a JSON array of reviewed relative paths on stdin.'); }
  }
  return scanProject(project, { diff, inventoryOnly, paths });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await runScan(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
