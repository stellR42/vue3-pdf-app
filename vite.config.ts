import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { thirdPartyLicenses } from './scripts/third-party-licenses';

const pdfjsWeb = (file: string) =>
  fileURLToPath(new URL(`./src/pdfjs-dist/lib/web/${file}`, import.meta.url));

// Same aliases pdf.js's own build uses for the generic viewer (createWebpackAlias in its gulpfile)
const pdfjsAliases = {
  'web-alt_text_manager': pdfjsWeb('alt_text_manager.js'),
  'web-annotation_editor_params': pdfjsWeb('annotation_editor_params.js'),
  'web-digital_signature_properties_manager': pdfjsWeb(
    'digital_signature_properties_manager.js',
  ),
  'web-download_manager': pdfjsWeb('download_manager.js'),
  'web-external_services': pdfjsWeb('genericcom.js'),
  'web-new_alt_text_manager': pdfjsWeb('new_alt_text_manager.js'),
  'web-null_l10n': pdfjsWeb('genericl10n.js'),
  'web-pdf_attachment_viewer': pdfjsWeb('pdf_attachment_viewer.js'),
  'web-pdf_cursor_tools': pdfjsWeb('pdf_cursor_tools.js'),
  'web-pdf_document_properties': pdfjsWeb('pdf_document_properties.js'),
  'web-pdf_find_bar': pdfjsWeb('pdf_find_bar.js'),
  'web-pdf_layer_viewer': pdfjsWeb('pdf_layer_viewer.js'),
  'web-pdf_outline_viewer': pdfjsWeb('pdf_outline_viewer.js'),
  'web-pdf_presentation_mode': pdfjsWeb('pdf_presentation_mode.js'),
  'web-pdf_thumbnail_viewer': pdfjsWeb('pdf_thumbnail_viewer.js'),
  'web-preferences': pdfjsWeb('genericcom.js'),
  'web-print_service': pdfjsWeb('pdf_print_service.js'),
  'web-secondary_toolbar': pdfjsWeb('secondary_toolbar.js'),
  'web-signature_manager': pdfjsWeb('signature_manager.js'),
  'web-toolbar': pdfjsWeb('toolbar.js'),
  'web-views_manager': pdfjsWeb('views_manager.js'),
};

export default defineConfig(({ command }) => ({
  plugins: [
    vue(),
    thirdPartyLicenses(
      fileURLToPath(new URL('./src/pdfjs-dist/licenses', import.meta.url)),
    ),
  ],
  // public/ only has the demo's sample pdf, keep it out of the published package
  publicDir: command === 'build' ? false : 'public',
  // pdf.js's image decoders, character maps and fonts, loaded as plain bytes
  assetsInclude: ['**/*.wasm', '**/*.bcmap', '**/*.pfb'],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      ...pdfjsAliases,
    },
  },
  worker: {
    format: 'es',
  },
  build:
    command === 'build'
      ? {
          lib: {
            entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
            formats: ['es'],
            fileName: 'vue3-pdf-app',
          },
          target: 'es2022',
          rollupOptions: {
            external: ['vue'],
          },
        }
      : undefined,
}));
