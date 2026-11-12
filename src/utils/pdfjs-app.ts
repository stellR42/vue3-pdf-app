// One-time setup around pdf.js's viewer app. PDFViewerApplication is a single
// object for the whole page, so this lives at module level, not in the component.
import { nativePrint } from './native-print';
import { PDFViewerApplication as app } from '@/pdfjs-dist/lib/web/app.js';
import { AppOptions } from '@/pdfjs-dist/lib/web/app_options.js';
import PdfWorker from '@/pdfjs-dist/lib/pdf.worker.js?worker&inline';
import { BundledBinaryDataFactory } from './bundled-data-factory';

// pdf.js's print service takes over window.print on import, give it back until a viewer is showing
const pdfjsPrint = window.print;
window.print = nativePrint;

// pdf.js keeps its options in one place for the whole page. Remember what they
// start as, so one viewer's options don't carry over to the next.
const pdfjsOptions = AppOptions.getAll();

// pdf.js caches the loading bar element the first time it's used, keep the
// original lazy getter so each mount picks up its own element
const loadingBarGetter = Object.getOwnPropertyDescriptor(app, 'loadingBar');

// Every open goes through here, including files opened from the toolbar or dropped
// on the viewer, so they all get the bundled image decoders
const pdfjsOpen = app.open;
app.open = (args: object) =>
  pdfjsOpen.call(app, { BinaryDataFactory: BundledBinaryDataFactory, ...args });

// The worker is bundled in so apps don't have to host pdf.worker.mjs. One worker serves every document.
let workerPort: Worker | null = null;
export function getWorkerPort() {
  workerPort ??= new PdfWorker();
  return workerPort;
}

// pdf.js breaks if it's started, closed or handed a new file while one of those is
// still in progress (a quick unmount/remount, or clicking through files fast).
// Everything that touches it waits its turn here.
let queue: Promise<unknown> = Promise.resolve();
export function enqueue(step: () => Promise<void> | void) {
  queue = queue.then(step).catch(console.error);
}

// Only one viewer can run at a time. A new one closes whichever one is still open.
let stopActiveViewer: (() => Promise<void>) | null = null;
export async function takeOver(stop: () => Promise<void>) {
  if (stopActiveViewer) {
    console.warn(
      'vue3-pdf-app: only one viewer can be open at a time, closing the earlier one',
    );
    await stopActiveViewer();
  }
  stopActiveViewer = stop;
}
export function release(stop: () => Promise<void>) {
  if (stopActiveViewer === stop) {
    stopActiveViewer = null;
  }
}

// Clear out what the last mount left behind so the next one starts clean
export function resetApp() {
  AppOptions.setAll(pdfjsOptions);
  app._initializedCapability = { ...Promise.withResolvers(), settled: false };
  app._globalAbortController = new AbortController();
  app._caretBrowsing = null;
  app.signaturePropertiesManager = null;
  if (loadingBarGetter) {
    Object.defineProperty(app, 'loadingBar', loadingBarGetter);
  }
  window.print = pdfjsPrint;
}

export async function closeApp() {
  // pdf.js saves unsaved annotation edits as a download when a document closes,
  // which isn't what anyone expects from leaving the page
  delete app._annotationStorageModified;
  try {
    await app.testingClose();
  } finally {
    app._openFileInput?.remove();
    window.print = nativePrint;
  }
}

export { app };
