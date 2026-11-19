// Name-based precautions shared by discovery and correction. Source files still
// need an informed review: an innocuous filename cannot establish its contents.
const PRIVATE_NAMES = new Set([
  '.aws', '.azure', '.docker', '.gnupg', '.kube', '.ssh', '.vault', '.git-credentials',
  '.netrc', '.npmrc', '.pypirc', '.envrc', 'keys', 'private_keys', 'private-keys',
  'wallet.dat', 'keystore.properties', 'vault.yml', 'vault.yaml', 'vault.json', 'auth.json', 'authorized_keys', 'known_hosts',
  'login.yaml', 'login.yml', 'login.json', 'service-account.json', 'service_account.json',
  'kubeconfig', 'keychain', 'keyring', 'keystores', 'secrets', 'credentials',
  '.htpasswd', '.pgpass', '.my.cnf', '.dockercfg', '.s3cfg', '.boto', '.terraformrc',
]);
const PRIVATE_SUFFIX = /\.(?:pem|pub|key|p8|p12|pfx|jks|jwk|jwks|keystore|kdbx|ppk|der|crt|keytab|tfstate|tfvars)(?:[.~]|$)/i;
const PRIVATE_NAME = /(?:^|[._-])(?:secrets?|credentials?|passwd|passwords?|private[-_]?key|api[-_]?key|(?:access|auth|refresh|github)[-_]?tokens?|service[-_]?account(?:[-_]?key)?)(?=[._-]|$)/i;
const TOKEN_DATA = /^(?:.*[._-])?tokens?(?:\.(?:json|ya?ml|toml|txt|ini|csv)|$)/i;
const GENERATED = new Set([
  'node_modules', 'bower_components', 'vendor', '.venv', 'venv', 'dist', 'build', 'target',
  '.cache', '.gradle', '.mypy_cache', '.next', '.nuxt', '.pytest_cache', '.ruff_cache',
  '.svelte-kit', '.tox', '__pycache__', 'coverage',
]);

function components(path) {
  return path.replaceAll('\\', '/').toLowerCase().split('/');
}

export function isSensitivePath(path) {
  return components(path).some(name =>
    PRIVATE_NAMES.has(name) || /(?:^\.env(?:[.-]|$)|\.env$)/.test(name) ||
    /^id_(?:rsa|ed25519|ecdsa|dsa)(?:[._-]|$)/.test(name) ||
    /(?:^|-)firebase-adminsdk-[\w-]+\.json$/i.test(name) ||
    PRIVATE_NAME.test(name) || PRIVATE_SUFFIX.test(name) || TOKEN_DATA.test(name));
}

export function excludedReason(path) {
  if (isSensitivePath(path)) return 'possibly_sensitive';
  const parts = components(path);
  if (parts.some(name => ['.git', '.hg', '.svn'].includes(name))) return 'version_metadata';
  if (parts.some(name => GENERATED.has(name)) || /(?:\.min\.(?:js|css)|\.map)$/.test(parts.at(-1))) {
    return 'dependencies_or_generated';
  }
  return null;
}
