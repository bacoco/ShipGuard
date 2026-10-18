// Compact unified patches from validated, non-overlapping line replacements. Never apply.
export function proposedDiff(path, content, edits) {
  if (!edits.length) return '';
  if (!content.endsWith('\n') || content.includes('\r') || content.startsWith('\uFEFF')) {
    throw new Error('patch requires LF source with final newline and no BOM; use flag');
  }
  const lines = content.slice(0, -1).split('\n');
  const ordered = [...edits].sort((a, b) => a.start - b.start);
  const groups = [];
  let end = 0;
  for (const edit of ordered) {
    if (edit.start <= end) throw new Error('overlapping edits');
    end = edit.end;
    const lo = Math.max(0, edit.start - 4);
    const hi = Math.min(lines.length, edit.end + 3);
    const previous = groups.at(-1);
    if (previous && lo <= previous.hi) {
      previous.hi = hi;
      previous.edits.push(edit);
    } else groups.push({ lo, hi, edits: [edit] });
  }
  const out = [`diff --git ${JSON.stringify(`a/${path}`)} ${JSON.stringify(`b/${path}`)}`,
    `--- ${JSON.stringify(`a/${path}`)}`, `+++ ${JSON.stringify(`b/${path}`)}`];
  let delta = 0;
  for (const group of groups) {
    const body = [];
    let cursor = group.lo;
    let change = 0;
    for (const edit of group.edits) {
      for (const line of lines.slice(cursor, edit.start - 1)) body.push(` ${line}`);
      for (const line of lines.slice(edit.start - 1, edit.end)) body.push(`-${line}`);
      const replacement = edit.replacement === '' ? [] : edit.replacement.slice(0, -1).split('\n');
      for (const line of replacement) body.push(`+${line}`);
      change += replacement.length - (edit.end - edit.start + 1);
      cursor = edit.end;
    }
    for (const line of lines.slice(cursor, group.hi)) body.push(` ${line}`);
    const oldCount = group.hi - group.lo;
    const newCount = oldCount + change;
    const newStart = group.lo + delta + (newCount ? 1 : 0);
    out.push(`@@ -${group.lo + 1},${oldCount} +${newStart},${newCount} @@`, ...body);
    delta += change;
  }
  return `${out.join('\n')}\n`;
}
