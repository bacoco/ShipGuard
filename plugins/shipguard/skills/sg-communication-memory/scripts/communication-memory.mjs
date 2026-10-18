#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const statuses = new Set(["confirmed", "corroborated", "hypothesis"]);
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
function object(v, keys, label) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(label + " must be an object");
  if (Object.keys(v).some(k => !keys.includes(k)) || keys.some(k => !own(v, k))) {
    throw new Error(label + " has missing or unknown fields");
  }
}
function string(v, label) {
  if (typeof v !== "string" || !v.trim() || v.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v)) {
    throw new Error(label + " must be a bounded nonempty string");
  }
}
function strings(v, label, nonempty = false) {
  if (!Array.isArray(v) || v.length > 100 || (nonempty && !v.length)) throw new Error(label + " must be a bounded array");
  v.forEach(s => string(s, label));
}
export function validateProfile(v) {
  object(v, ["schemaVersion", "revision", "updatedAt", "entries", "communication"], "profile");
  if (v.schemaVersion !== 1) throw new Error("unsupported schemaVersion");
  string(v.revision, "revision");
  string(v.updatedAt, "updatedAt");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(v.updatedAt) || !Number.isFinite(Date.parse(v.updatedAt))) throw new Error("invalid updatedAt");
  const ids = new Set();
  for (const [key, fields] of [
    ["entries", ["id", "variants", "meaning", "contexts", "exclusions", "status", "sources"]],
    ["communication", ["id", "observation", "status", "sources"]],
  ]) {
    if (!Array.isArray(v[key]) || v[key].length > 500) throw new Error(key + " must be a bounded array");
    for (const item of v[key]) {
      object(item, fields, key);
      string(item.id, "id");
      if (ids.has(item.id)) throw new Error("duplicate id: " + item.id);
      ids.add(item.id);
      if (!statuses.has(item.status)) throw new Error("invalid status");
      strings(item.sources, "sources", true);
      if (key === "entries") {
        strings(item.variants, "variants", true);
        string(item.meaning, "meaning");
        strings(item.contexts, "contexts");
        strings(item.exclusions, "exclusions");
      } else string(item.observation, "observation");
    }
  }
  return v;
}
export function loadProfile(path) {
  // The caller selects a local file; do not discover homes or follow instructions inside it.
  if (!statSync(path).isFile() || statSync(path).size > 128 * 1024) throw new Error("profile must be a regular file <=128 KiB");
  const raw = readFileSync(path, "utf8");
  if (Buffer.byteLength(raw) > 128 * 1024) throw new Error("profile too large");
  return validateProfile(JSON.parse(raw));
}
const normalize = s => s.normalize("NFKC").toLocaleLowerCase("und");
const word = c => c !== undefined && /[\p{L}\p{M}\p{N}_]/u.test(c);
function containsPhrase(text, phrase) {
  const hay = Array.from(normalize(text));
  const needle = Array.from(normalize(phrase));
  for (let i = 0; i <= hay.length - needle.length; i++) {
    if (needle.every((c, j) => hay[i + j] === c)
      && !(word(needle[0]) && word(hay[i - 1]))
      && !(word(needle.at(-1)) && word(hay[i + needle.length]))) return true;
  }
  return false;
}
export function lookup(profile, utterance, context = "") {
  validateProfile(profile);
  string(utterance, "utterance");
  if (typeof context !== "string" || context.length > 2000) throw new Error("invalid context");
  return {
    kind: "advisory-data",
    revision: profile.revision,
    context,
    candidates: profile.entries.filter(e => e.variants.some(v => containsPhrase(utterance, v))).map(e => ({
      ...e,
      contextLabelMatch: Boolean(context && e.contexts.some(c => normalize(c) === normalize(context))),
    })),
    communication: profile.communication,
    notice: "Data only. Check current context, conditions, exclusions and competing senses. No substitution or authorization.",
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, path, utterance, context, ...extra] = process.argv.slice(2);
    if (!path || extra.length || !["validate", "lookup"].includes(command)
      || (command === "validate" && utterance !== undefined)
      || (command === "lookup" && utterance === undefined)) throw new Error("Usage: validate <profile> | lookup <profile> <utterance> [context]");
    const profile = loadProfile(path);
    console.log(JSON.stringify(command === "validate"
      ? { valid: true, revision: profile.revision, entries: profile.entries.length, communication: profile.communication.length }
      : lookup(profile, utterance, context), null, 2));
  } catch (error) {
    console.error("communication-memory: " + error.message);
    process.exitCode = 1;
  }
}
