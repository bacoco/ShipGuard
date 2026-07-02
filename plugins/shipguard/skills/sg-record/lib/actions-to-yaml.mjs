/**
 * actions-to-yaml.mjs
 *
 * Converts an array of recorded browser actions into a ShipGuard YAML manifest string.
 * Pure data transformation — no side effects, fully testable.
 */

const LLM_CHECK_THRESHOLD = 80;
const UPLOAD_STUB_VALUE = '<path to a real file — set me>';

/**
 * Data key used in the manifest `data:` map for the Nth recorded upload.
 * Exported so sg-record.mjs can print matching keys in its save-time warning.
 * @param {number} index zero-based upload index
 * @returns {string}
 */
export function uploadDataKey(index) {
  return index === 0 ? 'upload_file' : `upload_file_${index + 1}`;
}

/**
 * Remove the baseUrl prefix from a URL, returning the relative path.
 * Only strips when the prefix ends at a real path boundary (end of string,
 * `/`, `?` or `#`) so that e.g. base `http://host:69` does NOT match
 * `http://host:6969/x`. Query-only URLs yield `/?q=1`.
 * @param {string} url
 * @param {string} baseUrl
 * @returns {string}
 */
function stripBase(url, baseUrl) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const full = String(url);
  if (!base || !full.startsWith(base)) return full;
  const rest = full.slice(base.length);
  if (rest === '') return '/';
  const boundary = rest[0];
  if (boundary === '/') return rest;
  if (boundary === '?' || boundary === '#') return '/' + rest;
  return full; // not a path boundary (e.g. different port) — keep full URL
}

/**
 * Escape a string for safe embedding in a YAML double-quoted scalar.
 * Escapes backslashes, double-quotes, newlines, carriage returns, tabs,
 * and any remaining control characters as \xNN (valid YAML escapes).
 * @param {string} str
 * @returns {string}
 */
function escYaml(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, (c) =>
      '\\x' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

/** True when an upload action actually carries a recorded file. */
function uploadHasFile(action) {
  return action.type === 'upload'
    && Boolean((action.files && action.files.length > 0 && action.files[0]) || action.file);
}

/**
 * Convert a recorded actions array into a ShipGuard YAML manifest string.
 *
 * @param {Array<{type: string, url?: string, text?: string, selector?: string, value?: string, key?: string, files?: string[], elementTag?: string}>} actions
 * @param {{ name: string, baseUrl: string, usedStorage?: boolean }} opts
 *   `usedStorage` must be true when the recording ran with `--storage`
 *   (auth was external to the recording).
 * @returns {string}
 */
export function actionsToYaml(actions, opts) {
  const { name, baseUrl, usedStorage = false } = opts;
  const recordedAt = new Date().toISOString();

  // requires_auth contract: true iff the recording did NOT capture its own
  // login — i.e. auth was external (`--storage` was used). The runner then
  // executes _shared/login.yaml before the steps. A recording that logged in
  // manually already contains its login steps, so it must stay false.
  const requiresAuth = Boolean(usedStorage);

  const uploadCount = actions.filter(uploadHasFile).length;

  // Build header
  const lines = [];
  lines.push(`name: "${escYaml(name)}"`);
  lines.push(`description: "Recorded session for ${escYaml(name)}"`);
  lines.push(`priority: medium`);
  lines.push(`requires_auth: ${requiresAuth}`);
  lines.push(`timeout: 60s`);
  lines.push(`tags: [recorded]`);
  lines.push(`source: recorded`);
  lines.push(`recorded_at: "${recordedAt}"`);
  if (uploadCount > 0) {
    lines.push(``);
    lines.push(`# upload.file paths are project-relative; point each data.* entry at a real file.`);
    lines.push(`data:`);
    for (let i = 0; i < uploadCount; i++) {
      lines.push(`  ${uploadDataKey(i)}: "${escYaml(UPLOAD_STUB_VALUE)}"`);
    }
  }
  lines.push(``);
  lines.push(`steps:`);

  // Track whether last emitted step was a check (to decide trailing screenshot)
  let lastWasCheck = false;
  let screenshotCounter = 0;
  let uploadIndex = 0;

  for (const action of actions) {
    switch (action.type) {
      case 'open': {
        const relativePath = stripBase(action.url, baseUrl);
        lines.push(`  - action: open`);
        lines.push(`    url: "{base_url}${relativePath}"`);
        lastWasCheck = false;
        break;
      }

      case 'click': {
        const target = action.text || action.selector || '';
        lines.push(`  - action: click`);
        lines.push(`    target: "${escYaml(target)}"`);
        lastWasCheck = false;
        break;
      }

      case 'fill': {
        const target = action.text || action.selector || '';
        const value = action.isPassword ? '{credentials.password}' : (action.value || '');
        lines.push(`  - action: fill`);
        lines.push(`    target: "${escYaml(target)}"`);
        lines.push(`    value: "${escYaml(value)}"`);
        lastWasCheck = false;
        break;
      }

      case 'select': {
        const target = action.text || action.selector || '';
        const value = action.value || '';
        lines.push(`  - action: select`);
        lines.push(`    target: "${escYaml(target)}"`);
        lines.push(`    value: "${escYaml(value)}"`);
        lastWasCheck = false;
        break;
      }

      case 'press': {
        lines.push(`  - action: press`);
        lines.push(`    key: "${escYaml(action.key || 'Enter')}"`);
        lastWasCheck = false;
        break;
      }

      case 'upload': {
        const recordedFile = (action.files && action.files[0]) || action.file || '';
        if (!recordedFile) {
          // A bare `- action: upload` with no file is invalid — skip entirely.
          break;
        }
        const key = uploadDataKey(uploadIndex++);
        // sg-visual-run expects `file:` — a singular, PROJECT-RELATIVE path.
        // The recorder only sees the browser-side basename, so emit a
        // {data.*} placeholder the user must point at a real project file.
        const safeComment = recordedFile.replace(/[\r\n]+/g, ' ');
        lines.push(`  # Recorded upload of "${safeComment}" — set data.${key} to a real project-relative file`);
        lines.push(`  - action: upload`);
        lines.push(`    file: "{data.${key}}"`);
        lastWasCheck = false;
        break;
      }

      case 'check': {
        const text = action.text || '';
        if (text.length > LLM_CHECK_THRESHOLD) {
          lines.push(`  - action: llm-check`);
          lines.push(`    description: "Verify element content"`);
          lines.push(`    criteria: "The ${escYaml(action.elementTag || 'element')} should contain text similar to: ${escYaml(text.slice(0, 120))}..."`);
          // Executor contract: llm-check severity is `critical` | `warning` only.
          lines.push(`    severity: warning`);
        } else {
          lines.push(`  - action: assert_text`);
          lines.push(`    expected: "${escYaml(text)}"`);
        }
        // Auto screenshot after each check (namespaced to avoid collisions
        // between manifests writing into the same results directory).
        screenshotCounter++;
        lines.push(`  - action: screenshot`);
        lines.push(`    filename: "${escYaml(name)}-check-${screenshotCounter}.png"`);
        lastWasCheck = true;
        break;
      }

      default:
        // Unknown action types: emit as comment
        lines.push(`  # unknown action: ${action.type}`);
        lastWasCheck = false;
        break;
    }
  }

  // Trailing screenshot if last action wasn't a check
  if (!lastWasCheck) {
    lines.push(`  - action: screenshot`);
    lines.push(`    filename: "${escYaml(name)}-final.png"`);
  }

  return lines.join('\n') + '\n';
}
