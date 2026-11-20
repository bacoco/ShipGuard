#!/usr/bin/env node
// Render decisions reviewed by a person or an agent. Scanner leads are not verdicts.
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isSensitivePath } from './paths.mjs';

const verdicts = ['utile', 'mal faite', 'inutile', 'indéterminée'];

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Texte manquant : ' + field);
  return value.trim();
}

function display(value, fallback = 'indéterminé') {
  const text = value == null || value === '' ? fallback : String(value);
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replace(/([\\`*_[\]#|])/g, '\\$1').replace(/\s+/g, ' ').trim();
}

function listSection(lines, title, entries) {
  lines.push('', '## ' + title, '');
  for (const entry of entries) lines.push('- ' + display(entry));
}

function ruleAttribution(rule, labels) {
  if (rule.ai == null) return [];
  const values = Array.isArray(rule.ai) ? rule.ai : [rule.ai];
  if (!values.length) return [];
  const evidence = requiredText(rule.aiEvidence, rule.id + '.aiEvidence');
  const names = values.map(value => requiredText(value, rule.id + '.ai'));
  // Commit metadata can establish credit for the commit only. Keep a copied
  // trailer in the provenance fields and leave this decision unattributed.
  const onlyTrailers = evidence.split(/\r?\n/).filter(line => line.trim())
    .every(line => /^Co-Authored-By:\s*\S/i.test(line.trim()));
  if (onlyTrailers || evidence === rule.coauthor?.trim?.()) return [];
  return [...new Set(names.map(name => {
    const key = name.toLowerCase();
    if (!labels.has(key)) labels.set(key, name);
    return labels.get(key);
  }))];
}

export function renderReview(review) {
  if (!Array.isArray(review?.rules)) throw new Error('Le rapport attend des règles examinées dans rules.');
  for (const field of ['project', 'scope', 'conclusion']) requiredText(review[field], field);
  for (const field of ['coverage', 'instructions', 'recommendations']) {
    if (!Array.isArray(review[field]) || !review[field].length) throw new Error('À documenter : ' + field);
    for (const item of review[field]) requiredText(item, field);
  }
  const ids = new Set();
  const aiCredits = new Map();
  const labels = new Map();
  const attributionByRule = new Map();
  let joint = 0;
  let unknown = 0;
  const counts = new Map(verdicts.map(value => [value, 0]));
  let requested = 0;
  for (const rule of review.rules) {
    for (const field of ['id', 'example', 'file', 'protection', 'alternative', 'evidence']) {
      requiredText(rule?.[field], field);
    }
    if (ids.has(rule.id)) throw new Error('Identifiant en double : ' + rule.id);
    ids.add(rule.id);
    if (!Number.isSafeInteger(rule.line) || rule.line < 1) throw new Error(rule.id + ' : ligne source attendue');
    if (!counts.has(rule.verdict)) throw new Error(rule.id + ' : avis inconnu');
    counts.set(rule.verdict, counts.get(rule.verdict) + 1);
    if (rule.requestSource != null) {
      requiredText(rule.requestSource, rule.id + '.requestSource');
      requested++;
    }
    const names = ruleAttribution(rule, labels);
    attributionByRule.set(rule.id, names);
    if (names.length > 1) joint++;
    if (!names.length) unknown++;
    for (const ai of names) aiCredits.set(ai, (aiCredits.get(ai) ?? 0) + 1);
  }
  const lines = ['# Rapport sur les règles du projet', '', display(review.conclusion), '',
    '**Projet** · ' + display(review.project), '**Version examinée** · ' + display(review.revision, 'à préciser'),
    '**Périmètre** · ' + display(review.scope)];
  listSection(lines, 'Couverture et limites', review.coverage);
  listSection(lines, 'Consignes examinées', review.instructions);
  lines.push('', '## Décompte des décisions examinées', '',
    'Total observé : ' + review.rules.length + '.', '');
  for (const [name, count] of counts) lines.push('- ' + name + ' : ' + count);
  lines.push('- demande précise avec source : ' + requested,
    '- aucune demande trouvée : ' + (review.rules.length - requested), '',
    'Attribution de la décision selon les preuves consignées :', '');
  for (const [name, count] of aiCredits) lines.push('- ' + display(name) + ' : ' + count);
  lines.push('- attribution indéterminée : ' + unknown,
    '- décisions attribuées conjointement : ' + joint + ' (comptées une fois pour chaque IA concernée)');
  if (!review.rules.length) lines.push('Aucune décision recensée dans le périmètre examiné.');
  const ranked = review.rules.filter(rule => ['mal faite', 'inutile'].includes(rule.verdict)).slice(0, 10);
  if (ranked.length) {
    listSection(lines, 'Gênes principales, par impact pour la personne', ranked.map(rule => rule.id + ' — ' + rule.example));
  }
  lines.push('', '## Inventaire');
  for (const rule of review.rules) {
    lines.push('', '### ' + display(rule.id) + ' · ' + display(rule.verdict), '',
      display(rule.example), '',
      '- Emplacement : ' + display(rule.file) + ', ligne ' + rule.line,
      '- Preuve et test : ' + display(rule.evidence),
      '- Protection : ' + display(rule.protection),
      '- Comportement proposé : ' + display(rule.alternative),
      '- Changement d’origine : ' + display(rule.commit, 'historique indéterminé'),
      '- Auteur Git : ' + display(rule.author),
      '- Co-Authored-By : ' + display(rule.coauthor, 'non établi'),
      '- Attribution de la décision : ' + display(attributionByRule.get(rule.id).join(' et '), 'indéterminée') +
        (rule.aiEvidence ? ' — ' + display(rule.aiEvidence) : ''),
      '- Demande explicite : ' + display(rule.requestSource, 'aucune demande trouvée'),
      '- Origine : ' + display(rule.origin, 'indéterminée'));
  }
  if (Array.isArray(review.chronology) && review.chronology.length) {
    listSection(lines, 'Ordre des tests et des règles', review.chronology);
  }
  listSection(lines, 'Changements proposés dans les consignes', review.recommendations);
  return lines.join('\n') + '\n';
}

function outside(project, directory) {
  const path = relative(project, directory);
  return path === '..' || path.startsWith('..' + sep) || isAbsolute(path);
}

export function saveReview(review) {
  const markdown = renderReview(review);
  const project = realpathSync(review.project);
  // TMPDIR itself can be inside the audited project (e.g. in a dev container).
  for (const candidate of new Set([tmpdir(), '/var/tmp', '/tmp'])) {
    let directory;
    try { directory = realpathSync(candidate); } catch { continue; }
    if (!outside(project, directory)) continue;
    let folder;
    try { folder = mkdtempSync(join(directory, 'shipguard-regles-')); }
    catch (error) {
      if (['EACCES', 'EPERM', 'EROFS'].includes(error.code)) continue;
      throw error;
    }
    const path = join(folder, 'rapport-regles.md');
    writeFileSync(path, markdown, { flag: 'wx', mode: 0o600 });
    return path;
  }
  throw new Error('Aucun dossier temporaire accessible hors du projet. Indiquer un TMPDIR extérieur.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [file, ...extra] = process.argv.slice(2);
    if (!file || extra.length) throw new Error('Usage : report.mjs REVUE.json (ou - pour l’entrée standard)');
    if (file !== '-' && (isSensitivePath(file) || isSensitivePath(realpathSync(file)))) {
      throw new Error('Choisir le fichier de compte rendu préparé pour cette revue.');
    }
    const review = JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8'));
    console.log(saveReview(review));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 3;
  }
}
