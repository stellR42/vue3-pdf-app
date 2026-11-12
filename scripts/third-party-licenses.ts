import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

// Writes dist/THIRD_PARTY_LICENSES.txt with the licenses of everything bundled into the
// package. The build strips license comments from the code, so this is where they live.
// pdf.js's own licenses (decoders, fonts, character maps) are copied into vendoredDir by
// scripts/update-pdfjs.mjs, npm packages are picked up from what actually got bundled.
export function thirdPartyLicenses(vendoredDir: string): Plugin {
  return {
    name: 'third-party-licenses',
    apply: 'build',
    generateBundle() {
      const sections = fs
        .readdirSync(vendoredDir)
        .sort()
        .map((file) => vendoredLicense(path.join(vendoredDir, file)));
      for (const dir of bundledPackageDirs([...this.getModuleIds()])) {
        sections.push(packageLicense(dir));
      }
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_LICENSES.txt',
        source:
          'vue3-pdf-app bundles the following third-party software.\n\n' +
          sections.join(`\n\n${'='.repeat(80)}\n\n`) +
          '\n',
      });
    },
  };
}

function vendoredLicense(file: string) {
  return `${path.basename(file)}\n\n${fs.readFileSync(file, 'utf8').trim()}`;
}

// Module ids look like .../node_modules/@fluent/bundle/esm/bundle.js, keep the package folder.
// Ids starting with \0 are Rollup's own helper modules wrapped around real files, skip those.
function bundledPackageDirs(moduleIds: string[]) {
  const dirs = new Set<string>();
  for (const id of moduleIds) {
    if (id.startsWith('\0')) continue;
    const match = id.match(/^(.*node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)/);
    if (match) {
      dirs.add(match[1]);
    }
  }
  return [...dirs].sort();
}

function packageLicense(dir: string) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
  );
  const title = `${pkg.name} ${pkg.version} (${pkg.license})`;
  const licenseFile = fs
    .readdirSync(dir)
    .find((file) => /^(licen[cs]e|copying)/i.test(file));
  if (licenseFile) {
    return `${title}\n\n${fs.readFileSync(path.join(dir, licenseFile), 'utf8').trim()}`;
  }
  // Some packages don't ship a license file, point at the source instead
  const repo =
    typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return `${title}\n\nLicensed under ${pkg.license}. Source: ${repo}`;
}
