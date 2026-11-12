// pdf.js normally downloads its image decoders, character maps and standard fonts from
// folders the app has to host. This hands them over from the bundle instead. Each file
// is its own chunk, so it only loads when a PDF actually needs it.
// Keys look like "../pdfjs-dist/cmaps/78-H.bcmap".
const files = import.meta.glob<string>(
  [
    '../pdfjs-dist/wasm/*.wasm',
    '../pdfjs-dist/cmaps/*.bcmap',
    '../pdfjs-dist/standard_fonts/*.{pfb,ttf}',
  ],
  { query: '?inline', import: 'default' },
);

const folders: Record<string, string> = {
  wasmUrl: 'wasm',
  cMapUrl: 'cmaps',
  standardFontDataUrl: 'standard_fonts',
};

export class BundledBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const load = files[`../pdfjs-dist/${folders[kind]}/${filename}`];
    if (!load) {
      throw new Error(`${filename} isn't bundled with vue3-pdf-app`);
    }
    const dataUrl = await load();
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  }
}
