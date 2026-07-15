// Postinstall: install + build the shared schema package (file: dep, gitignored dist/).
// A Node script instead of inline shell because `npm --prefix` inside a lifecycle
// script misresolves on Windows (inherited npm_config_* env) and recurses.
const { execSync } = require('node:child_process');
const path = require('node:path');

const schemaDir = path.resolve(__dirname, '..', '..', 'shared', 'schema');

// Strip npm's lifecycle env so the nested npm calls don't inherit the parent
// install's prefix/config and operate on the wrong package.
const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (!/^npm_/i.test(key)) env[key] = value;
}

const run = (cmd) => execSync(cmd, { cwd: schemaDir, env, stdio: 'inherit' });
run('npm install --no-audit --no-fund');
run('npm run build');
