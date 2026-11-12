// Copies a pdf.js build into src/pdfjs-dist.
//
// Usage:
//   1. In a pdf.js checkout (at the release tag you want): npm ci && npx gulp generic-legacy lib-legacy
//   2. node scripts/update-pdfjs.mjs <path to pdf.js checkout>
//
// npm's pdfjs-dist stopped shipping the viewer app code (web/app.js etc.) after 3.5,
// so it has to come from a source build.
//
// This uses the "legacy" builds on purpose. The regular ones only run on browsers
// from the last few months (they use things like Math.sumPrecise and Map.getOrInsert
// with no polyfills). Legacy adds core-js polyfills and covers Chrome 125+ / Safari 18+.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import postcssNested from 'postcss-nested';

const pdfjsDir = process.argv[2];
if (!pdfjsDir) {
  console.error(
    'Usage: node scripts/update-pdfjs.mjs <path to pdf.js checkout>',
  );
  process.exit(1);
}

const libDir = path.join(pdfjsDir, 'build', 'lib-legacy');
const externalDir = path.join(pdfjsDir, 'build', 'external');
const genericWebDir = path.join(pdfjsDir, 'build', 'generic-legacy', 'web');
for (const dir of [libDir, externalDir, genericWebDir]) {
  if (!fs.existsSync(dir)) {
    console.error(
      `Missing ${dir}. Run "npx gulp generic-legacy lib-legacy" in the pdf.js checkout first.`,
    );
    process.exit(1);
  }
}

// Licenses for everything copied below that ends up in the bundle. The build combines
// them into dist/THIRD_PARTY_LICENSES.txt (see scripts/third-party-licenses.ts).
const licenseFiles = {
  LICENSE_PDFJS: path.join(pdfjsDir, 'LICENSE'),
  LICENSE_CMAPS: path.join(genericWebDir, 'cmaps', 'LICENSE'),
  LICENSE_FOXIT: path.join(genericWebDir, 'standard_fonts', 'LICENSE_FOXIT'),
  LICENSE_LIBERATION: path.join(
    genericWebDir,
    'standard_fonts',
    'LICENSE_LIBERATION',
  ),
  LICENSE_BROTLI: path.join(pdfjsDir, 'external', 'brotli', 'LICENSE_BROTLI'),
  LICENSE_QCMS: path.join(pdfjsDir, 'external', 'qcms', 'LICENSE_QCMS'),
  LICENSE_PDFJS_QCMS: path.join(
    pdfjsDir,
    'external',
    'qcms',
    'LICENSE_PDFJS_QCMS',
  ),
  LICENSE_JBIG2: path.join(genericWebDir, 'wasm', 'LICENSE_JBIG2'),
  LICENSE_PDFJS_JBIG2: path.join(genericWebDir, 'wasm', 'LICENSE_PDFJS_JBIG2'),
  LICENSE_OPENJPEG: path.join(genericWebDir, 'wasm', 'LICENSE_OPENJPEG'),
  LICENSE_PDFJS_OPENJPEG: path.join(
    genericWebDir,
    'wasm',
    'LICENSE_PDFJS_OPENJPEG',
  ),
};
for (const file of Object.values(licenseFiles)) {
  if (!fs.existsSync(file)) {
    console.error(`Missing license file ${file}`);
    process.exit(1);
  }
}

// Next to this script, wherever it's run from
const outDir = fileURLToPath(new URL('../src/pdfjs-dist', import.meta.url));
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// lib/ and external/ have to stay siblings, core imports ../../external/...
// Tests and the entry files the component never imports are left out.
const unused = ['pdf.sandbox.mjs', 'pdf.image_decoders.js', 'pdf.renderer.js'];
fs.cpSync(libDir, path.join(outDir, 'lib'), {
  recursive: true,
  filter: (src) =>
    !src.includes(`${path.sep}test${path.sep}`) &&
    !src.endsWith(`${path.sep}test`) &&
    !unused.includes(path.basename(src)),
});
fs.cpSync(externalDir, path.join(outDir, 'external'), { recursive: true });
fs.cpSync(path.join(genericWebDir, 'images'), path.join(outDir, 'images'), {
  recursive: true,
});

// JBIG2 and JPEG 2000 decoders (common in scanned PDFs) only ship as wasm now, the component bundles them
fs.mkdirSync(path.join(outDir, 'wasm'));
for (const file of ['jbig2.wasm', 'openjpeg.wasm']) {
  fs.copyFileSync(
    path.join(genericWebDir, 'wasm', file),
    path.join(outDir, 'wasm', file),
  );
}

// Character maps (Chinese, Japanese, Korean text) and the standard fonts, for PDFs that don't embed their fonts
const isLicense = (src) => path.basename(src).startsWith('LICENSE');
fs.cpSync(path.join(genericWebDir, 'cmaps'), path.join(outDir, 'cmaps'), {
  recursive: true,
  filter: (src) => !isLicense(src),
});
fs.cpSync(
  path.join(genericWebDir, 'standard_fonts'),
  path.join(outDir, 'standard_fonts'),
  {
    recursive: true,
    filter: (src) => !isLicense(src),
  },
);

const licensesDir = path.join(outDir, 'licenses');
fs.mkdirSync(licensesDir);
for (const [name, file] of Object.entries(licenseFiles)) {
  fs.copyFileSync(file, path.join(licensesDir, name));
}

// Swaps one piece of pdf.js code for another, and stops if a pdf.js update moved it
const swap = (code, from, to, file) => {
  const found =
    typeof from === 'string' ? code.includes(from) : from.test(code);
  if (!found) {
    console.error(
      `Couldn't find this in ${file}, the patch needs updating:\n${from}`,
    );
    process.exit(1);
  }
  return code.replace(from, to);
};
const patch = (file, from, to) => {
  const filePath = path.join(outDir, 'lib', file);
  const code = fs.readFileSync(filePath, 'utf8');
  fs.writeFileSync(filePath, swap(code, from, to, file));
};

// pdf.js listens for keyboard shortcuts on the whole page (Ctrl+F, Ctrl+P, arrows, j/k, r...).
// Only handle them when focus is inside the viewer so they don't hijack the host app.
patch(
  'web/app.js',
  'window.addEventListener("keydown", onKeyDown.bind(this), {',
  'window.addEventListener("keydown", evt => this.appConfig.appContainer.contains(evt.target) && onKeyDown.call(this, evt), {',
);
patch(
  'web/pdf_print_service.js',
  'if (event.keyCode === 80 && (event.ctrlKey || event.metaKey)',
  'if (event.target.closest?.(".pdf-app") && event.keyCode === 80 && (event.ctrlKey || event.metaKey)',
);
// Same for Ctrl+wheel and pinch: zoom the PDF over the viewer, the page everywhere else
patch(
  'web/app.js',
  'window.addEventListener("wheel", onWheel.bind(this), {',
  'window.addEventListener("wheel", evt => this.appConfig.appContainer.contains(evt.target) && onWheel.call(this, evt), {',
);

// pdf.js hides the browser's own beforeprint/afterprint events from every other listener
// on the page. Only do that while a viewer is showing.
patch(
  'web/pdf_print_service.js',
  'if (event.detail !== "custom") {',
  'if (event.detail !== "custom" && document.querySelector(".pdf-app")) {',
);

// viewer.css has a page-wide "@page { margin: 0 }", which would also take the margins
// off the host app's own printing. It's dropped from the css below and added here, to
// the print styles pdf.js only applies while it prints a PDF.
patch(
  'web/pdf_print_service.js',
  '`@page { size: ${width}pt ${height}pt;}`',
  '`@page { size: ${width}pt ${height}pt; margin: 0;}`',
);

// The viewer can be unmounted while pdf.js is still setting up and scrolls to the first page.
// There's nothing left to scroll then, so skip quietly instead of logging an error.
patch(
  'web/ui_utils.js',
  'console.error("offsetParent is not set -- cannot scroll");',
  '',
);

// The lib build points fluent at pdf.js's own node_modules, use the package names instead
patch(
  'web/genericl10n.js',
  /"[./]*node_modules\/@fluent\/bundle\/esm\/index\.js"/,
  '"@fluent/bundle"',
);
patch(
  'web/genericl10n.js',
  /"[./]*node_modules\/@fluent\/dom\/esm\/index\.js"/,
  '"@fluent/dom"',
);

// viewer.html body, minus the print container (the component puts that on <body>)
const viewerHtml = fs.readFileSync(
  path.join(genericWebDir, 'viewer.html'),
  'utf8',
);
const body = swap(
  viewerHtml.slice(
    viewerHtml.indexOf('>', viewerHtml.indexOf('<body')) + 1,
    viewerHtml.indexOf('</body>'),
  ),
  '<div id="printContainer"></div>',
  '',
  'viewer.html',
).trim();
fs.writeFileSync(path.join(outDir, 'viewer-body.html'), body + '\n');

// getViewerConfiguration() from web/viewer.js, looking ids up inside the component
const viewerJs = fs.readFileSync(
  path.join(pdfjsDir, 'web', 'viewer.js'),
  'utf8',
);
const configStart = viewerJs.indexOf('function getViewerConfiguration()');
if (configStart === -1) {
  console.error("Couldn't find getViewerConfiguration() in web/viewer.js");
  process.exit(1);
}
const configEnd = viewerJs.indexOf('\n}\n', configStart) + 3;
let configFn = viewerJs.slice(configStart, configEnd);
configFn = swap(
  configFn,
  'function getViewerConfiguration()',
  'export function getViewerConfiguration(container, getEl)',
  'web/viewer.js',
);
// This is what keeps the keyboard and wheel patches above inside the viewer
configFn = swap(
  configFn,
  'appContainer: document.body',
  'appContainer: container',
  'web/viewer.js',
);
configFn = swap(
  configFn,
  /document\.getElementById\(/g,
  'getEl(',
  'web/viewer.js',
);
fs.writeFileSync(
  path.join(outDir, 'viewer-config.js'),
  `// Generated by scripts/update-pdfjs.mjs from web/viewer.js, don't edit by hand.
const PDFJSDev = { test: (flags) => flags === 'GENERIC' }

${configFn}`,
);

// viewer.css is written for a whole page. Scope it to .pdf-app so it doesn't restyle the host app.
const scopeSelector = (selector) => {
  // The print container lives on <body>, so print rules stay global. Same for the
  // overlay pdf.js puts on <body> while dragging with the hand tool.
  if (
    selector.includes('#printContainer') ||
    selector.includes('data-pdfjsprinting') ||
    selector === '.grab-to-pan-grabbing'
  ) {
    return selector;
  }
  if (/^(html|body|:root)\b/.test(selector)) {
    return selector.replace(/^(html|body|:root)/, '.pdf-app');
  }
  return `.pdf-app ${selector}`;
};
// pdf.js sets these from JS on <html>, so they have to stay on :root. Redefining
// them on .pdf-app would override what the JS sets.
const setOnHtml = ['--viewer-container-height', '--viewsManager-width'];
let removedPageMargin = false;
const scopePlugin = {
  postcssPlugin: 'scope-to-pdf-app',
  AtRule: {
    // Moved into pdf.js's print styles, see the pdf_print_service.js patch above
    page(atRule) {
      atRule.remove();
      removedPageMargin = true;
    },
  },
  Rule(rule) {
    if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name))
      return;
    if (rule.selector.includes('.pdf-app') || rule.__scoped) return;
    rule.__scoped = true;

    if (rule.selector === ':root') {
      // Variables move to .pdf-app so they can't clash with the host app's (names like
      // --main-color are easy to hit). :where() keeps them easy to override from a
      // plain .pdf-app rule.
      const variables = postcss.rule({ selector: ':where(.pdf-app)' });
      const other = postcss.rule({ selector: '.pdf-app' });
      variables.__scoped = other.__scoped = true;
      for (const node of [...rule.nodes]) {
        const isVariable = node.type === 'decl' && node.prop.startsWith('--');
        if (isVariable && setOnHtml.includes(node.prop)) continue;
        (isVariable ? variables : other).append(node);
      }
      if (other.nodes.length) rule.after(other);
      if (variables.nodes.length) rule.after(variables);
      if (!rule.nodes.length) rule.remove();
      return;
    }
    rule.selectors = rule.selectors.map(scopeSelector);
  },
};
const viewerCss = fs.readFileSync(
  path.join(genericWebDir, 'viewer.css'),
  'utf8',
);
const scopedCss = await postcss([postcssNested(), scopePlugin]).process(
  viewerCss,
  { from: undefined },
);
if (!removedPageMargin) {
  console.error("Couldn't find the @page rule in viewer.css");
  process.exit(1);
}
fs.writeFileSync(path.join(outDir, 'viewer.css'), scopedCss.css);

const version = JSON.parse(
  fs.readFileSync(path.join(pdfjsDir, 'build', 'version.json'), 'utf8'),
);
fs.writeFileSync(
  path.join(outDir, 'version.json'),
  JSON.stringify(version, null, 2) + '\n',
);
console.log(
  `Copied pdf.js ${version.version} (${version.commit}) into ${outDir}`,
);
