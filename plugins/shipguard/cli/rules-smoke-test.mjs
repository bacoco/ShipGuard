import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const cli = resolve(import.meta.dirname, 'shipguard.mjs');
const plugin = resolve(import.meta.dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'sg-rules-journey-'));
const project = join(tmp, 'carnet');
const app = join(project, 'notes.mjs');
const data = join(tmp, 'notes.json');
const planPath = join(tmp, 'plan.json');
const env = { ...process.env, NOTES_FILE: data };
delete env.SHIPGUARD_PLUGIN_ROOT;
mkdirSync(project);

function node(script, args, { expected = 0, stdin } = {}) {
  const run = spawnSync(process.execPath, [script, ...args], { cwd: project, encoding: 'utf8', input: stdin, env });
  assert.ifError(run.error);
  assert.equal(run.status, expected, run.stderr + run.stdout);
  return run.stdout.trim();
}

const observed = () => JSON.parse(readFileSync(data));
const cap = 'if (note.messages.length >= 2) process.exit(1);';
const guard = "if (actor !== note.owner) process.exit(1);";
const source = `import { readFileSync, writeFileSync } from 'node:fs';
const [actor, message] = process.argv.slice(2);
const note = JSON.parse(readFileSync(process.env.NOTES_FILE));
${guard}
${cap}
note.messages.push(message);
writeFileSync(process.env.NOTES_FILE, JSON.stringify(note));
`;
const start = messages => writeFileSync(data, JSON.stringify({ owner: 'Alice', messages }));
const baseRule = {
  id: 'R01', problem: 'Troisième commentaire refusé.', action: 'Permettre un troisième commentaire.',
  target: 'Sa propre note', reported: 'Deux deviennent trois.', ordinary: 'Zéro devient un.',
  edits: [{ path: 'notes.mjs', before: cap + '\nnote.messages.push(message);', after: 'note.messages.push(message);' }],
};
const secondRule = {
  ...baseRule, id: 'R02', problem: 'Renommer la variable locale.', action: 'Proposition indépendante.',
  edits: [{ path: 'notes.mjs', before: 'const [actor, message]', after: 'const [person, message]' }],
};
let generated;
try {
  writeFileSync(app, source);
  start(['a', 'b']);
  node(app, ['Alice', 'c'], { expected: 1 });
  assert.deepEqual(observed().messages, ['a', 'b']);
  const inv = JSON.parse(node(cli, ['rules', 'scan', '.', '--inventory']));
  assert.ok(inv.inventory.includes('notes.mjs'));
  const scan = JSON.parse(node(cli, ['rules', 'scan', '.', '--paths-stdin'], { stdin: JSON.stringify(['notes.mjs']) }));
  assert.ok(scan.coverage.scanned.includes('notes.mjs'));
  assert.ok(scan.candidates.some(c => c.path === 'notes.mjs'));
  for (const args of [['init', '--quiet'], ['add', '--', 'notes.mjs'],
    ['-c', 'user.name=Alice', '-c', 'user.email=alice@example.invalid', 'commit', '--quiet', '-m', 'Exemple du carnet']]) {
    const git = spawnSync('git', args, {
      cwd: project, encoding: 'utf8', env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull },
    });
    assert.ifError(git.error);
    assert.equal(git.status, 0, git.stderr);
  }
  const history = JSON.parse(node(cli, ['rules', 'history', '.', 'notes.mjs'], { stdin: cap }));
  assert.equal(history.status, 'matched');
  assert.equal(history.commit.subject, 'Exemple du carnet');
  writeFileSync(planPath, JSON.stringify({ project, rules: [baseRule, secondRule] }));
  const preview = JSON.parse(node(cli, ['rules', 'preview', planPath]));
  assert.deepEqual(preview.proposals.map(r => r.id), ['R01', 'R02']);
  node(cli, ['rules', 'preview', planPath, '--apply=R01', '--review=' + preview.review], { expected: 3 });
  assert.equal(readFileSync(app, 'utf8'), source);
  const receipt = JSON.parse(node(cli, ['rules', 'apply', planPath, '--apply=R01', '--review=' + preview.review]));
  assert.deepEqual(receipt.results.map(r => [r.id, r.status, r.verification]), [['R01', 'applied', 'pending']]);
  node(app, ['Alice', 'c']);
  assert.deepEqual(observed().messages, ['a', 'b', 'c']);
  start([]);
  node(app, ['Alice', 'ordinaire']);
  assert.deepEqual(observed().messages, ['ordinaire']);
  node(app, ['Bob', 'interdit'], { expected: 1 });
  assert.deepEqual(observed().messages, ['ordinaire']);
  assert.ok(readFileSync(app, 'utf8').includes(secondRule.edits[0].before));

  const reportInput = {
    project, scope: 'Projet fictif', revision: 'essai', coverage: ['Commande ajouter, parcours normal.'],
    instructions: ['README : accepter les commentaires du propriétaire.'],
    recommendations: ['Essayer le troisième commentaire et celui d’une autre personne.'],
    conclusion: 'Un plafond empêchait un ajout autorisé.',
    chronology: ['Ordre du test et de la règle inconnu.'],
    rules: [
      { id: 'R01', file: 'notes.mjs', line: 5, example: 'Le troisième commentaire était refusé.',
        verdict: 'mal faite', protection: 'Aucune nécessité du plafond retrouvée.', alternative: 'Supprimer le plafond.',
        evidence: 'Reproduit avant modification ; après correction, trois commentaires enregistrés.' },
      { id: 'P01', file: 'notes.mjs', line: 4, example: 'La note appartient à une autre personne.',
        verdict: 'utile', protection: 'Évite une écriture dans la note d’autrui.', alternative: 'Conserver.',
        requestSource: 'Consigne de la personne dans le projet fictif.', evidence: 'Accès refusé ; note intacte.' },
    ],
  };
  const copy = join(tmp, 'shipguard.mjs');
  copyFileSync(cli, copy);
  generated = node(copy, ['rules', 'report', '-', '--plugin-root=' + plugin], { stdin: JSON.stringify(reportInput) });
  assert.ok(!generated.startsWith(project + '/'));
  const report = readFileSync(generated, 'utf8');
  for (const text of ['Total observé : 2', 'utile : 1', 'mal faite : 1', 'demande précise avec source : 1',
    'aucune demande trouvée : 1', '### R01', '### P01', 'Ordre du test']) assert.ok(report.includes(text), text);
  // One decision can have two evidenced authors; a bare commit trailer credits neither.
  const credited = {
    ...reportInput,
    rules: [
      { ...reportInput.rules[0], ai: ['Claude', 'Codex', 'Claude'], aiEvidence: 'Échanges sur R01 : Claude a proposé le plafond, Codex a fixé sa valeur.' },
      { ...reportInput.rules[1], ai: 'Claude', aiEvidence: 'Le commentaire de Claude décrit sa décision P01.' },
      { ...reportInput.rules[0], id: 'R03', ai: 'Codex', aiEvidence: 'Co-Authored-By: Codex <codex@example.invalid>' },
    ],
  };
  const creditPath = node(cli, ['rules', 'report', '-'], { stdin: JSON.stringify(credited) });
  try {
    const creditReport = readFileSync(creditPath, 'utf8');
    for (const expected of ['Total observé : 3', '- Claude : 2', '- Codex : 1',
      '- attribution indéterminée : 1', '- décisions attribuées conjointement : 1',
      '- Attribution de la décision : Claude et Codex']) assert.ok(creditReport.includes(expected), expected);
  } finally {
    if (basename(creditPath) === 'rapport-regles.md' && basename(dirname(creditPath)).startsWith('shipguard-regles-')) {
      rmSync(dirname(creditPath), { recursive: true, force: true });
    }
  }
  node(cli, ['rules', 'report', '-'], { stdin: JSON.stringify(scan), expected: 3 });
  node(cli, ['rules', 'report', '-'], { stdin: JSON.stringify({ ...reportInput, rules: [reportInput.rules[0], reportInput.rules[0]] }), expected: 3 });
  console.log('Verified CLI journey: discovery, selection-only edits, normal action, reported action, preserved protection, external French report.');
} finally {
  if (generated && basename(generated) === 'rapport-regles.md' && basename(dirname(generated)).startsWith('shipguard-regles-')) {
    rmSync(dirname(generated), { recursive: true, force: true });
  }
  rmSync(tmp, { recursive: true, force: true });
}
