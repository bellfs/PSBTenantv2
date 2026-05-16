const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const appPath = path.join(__dirname, '..', 'dist', 'mac-arm64', `${pkg.build.productName}.app`);
const zipPath = path.join(__dirname, '..', 'dist', `FFR-Property-OS-${pkg.version}-arm64.zip`);

if (!fs.existsSync(appPath)) {
  throw new Error(`Packaged app not found: ${appPath}`);
}

fs.mkdirSync(path.dirname(zipPath), { recursive: true });
try { fs.unlinkSync(zipPath); } catch {}

execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath], { stdio: 'inherit' });
console.log(`Created ${zipPath}`);
