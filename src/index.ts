import type { DefineComponent } from 'vue';
import PdfViewerComponent from './components/pdf-viewer.vue';
import type { PdfViewerEmits, PdfViewerProps } from './types';

// Typed by hand instead of using the type vue-tsc generates for the .vue file. That one
// is written in the newest Vue's format, and older Vue versions can't read it, so props
// and events silently end up untyped there. This form works on every Vue version we support.
const PdfViewer = PdfViewerComponent as unknown as DefineComponent<
  PdfViewerProps,
  {},
  {},
  {},
  {},
  {},
  {},
  PdfViewerEmits
>;

export default PdfViewer;
export * from './types';
