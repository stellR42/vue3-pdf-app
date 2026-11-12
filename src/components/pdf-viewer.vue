<template>
  <div
    ref="root"
    class="pdf-app"
    :style="theme ? { colorScheme: theme } : undefined"
    dir="ltr"
    tabindex="0"
    v-html="viewerBody"
  ></div>
</template>

<script setup lang="ts">
import {
  app,
  closeApp,
  enqueue,
  getWorkerPort,
  release,
  resetApp,
  takeOver,
} from '../utils/pdfjs-app';
import { AppOptions } from '@/pdfjs-dist/lib/web/app_options.js';
import { getViewerConfiguration } from '@/pdfjs-dist/viewer-config.js';
import viewerBody from '@/pdfjs-dist/viewer-body.html?raw';
import viewerCss from '@/pdfjs-dist/viewer.css?inline';
import { PdfApp, PdfViewerProps } from '../types';
import {
  getToolbarConfigValue,
  toolbarConfig,
  toolbarElementIds,
} from '../utils/toolbar-config';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(defineProps<PdfViewerProps>(), {
  config: () => toolbarConfig,
  title: false,
});
// Same events as PdfViewerEmits in types/, in the form defineEmits expects
const emit = defineEmits<{
  (e: 'after-created', app: PdfApp): void;
  (e: 'open', app: PdfApp): void;
  (e: 'pages-rendered', app: PdfApp): void;
}>();

const root = ref<HTMLElement>();
let printContainer: HTMLElement | null = null;
let started = false;
let unmounted = false;
let latestOpen = 0;
// The document that came from the pdf prop, as opposed to one opened from the toolbar
let propDocument: unknown = null;

onMounted(() => {
  addStyles();
  enqueue(startViewer);
  openPdf();
});

onBeforeUnmount(() => {
  unmounted = true;
  enqueue(stopViewer);
});

watch(() => props.pdf, openPdf);
watch(() => props.config, applyToolbarConfig, { deep: true });

async function startViewer() {
  // Unmounted again before pdf.js got to it
  if (unmounted) return;
  await takeOver(stopViewer);
  // Unmounted while the earlier viewer was still closing
  if (unmounted) {
    release(stopViewer);
    return;
  }
  started = true;
  addPrintContainer();
  resetApp();

  AppOptions.setAll({
    defaultUrl: '',
    workerPort: getWorkerPort(),
    // Saved viewer preferences in localStorage would override the options set here
    disablePreferences: true,
    // Keeps pdf.js from adding entries to the host app's browser history
    disableHistory: true,
    // Only English is bundled. Left alone, pdf.js goes by the browser's language
    // and flips the whole page to right-to-left for Hebrew or Arabic browsers.
    localeProperties: { lang: 'en-US' },
    // These need files hosted next to the app, so they stay off
    enableScripting: false,
    rendererSrc: '',
    // pdf.js only turns these on in Firefox
    enableSignatureEditor: true,
    enableComment: true,
    // Links in the PDF open in a new tab instead of replacing the host app
    externalLinkTarget: 2,
    defaultZoomValue: props.pageScale ? String(props.pageScale) : '',
    ...props.options,
  });

  const container = root.value!;
  const config = getViewerConfiguration(container, (id) =>
    container.querySelector(`#${CSS.escape(id)}`),
  );
  config.printContainer = printContainer;

  // When it isn't "embedded", pdf.js takes over document.title
  app.isViewerEmbedded = !props.title;

  // pdf.js sets dir on <html>, put back whatever the host page had
  const hostDir = document.documentElement.getAttribute('dir');
  await app.run(config);
  if (hostDir === null) {
    document.documentElement.removeAttribute('dir');
  } else {
    document.documentElement.setAttribute('dir', hostDir);
  }

  // Unmounted while pdf.js was starting, the queued stopViewer cleans up
  if (unmounted) return;

  applyToolbarConfig();
  app.eventBus.on('documentloaded', () => {
    // Files opened from the toolbar or dropped on the viewer keep their own name
    if (props.fileName && app.pdfDocument === propDocument) {
      app._contentDispositionFilename = props.fileName;
    }
    emit('open', app);
  });
  app.eventBus.on('pagesloaded', () => emit('pages-rendered', app));
  emit('after-created', app);
}

async function stopViewer() {
  if (!started) return;
  started = false;
  release(stopViewer);
  try {
    await closeApp();
  } finally {
    printContainer?.remove();
    printContainer = null;
  }
}

function openPdf() {
  const request = ++latestOpen;
  enqueue(async () => {
    // If the file changed again while pdf.js was busy, only the newest one gets opened
    if (!started || request !== latestOpen) return;
    delete app._annotationStorageModified;
    if (!props.pdf) {
      await app.close();
      return;
    }
    // pdf.js sets the starting page from this once the pages load. It would
    // otherwise read it from the host page's url hash.
    app.initialBookmark = props.pageNumber
      ? `page=${props.pageNumber}${props.pageScale ? `&zoom=${props.pageScale}` : ''}`
      : null;
    // pdf.js hands ArrayBuffers off to the worker, copy it so the caller's buffer stays usable
    const source =
      typeof props.pdf === 'string'
        ? { url: props.pdf }
        : { data: props.pdf.slice(0) };
    await app.open(source);
    propDocument = app.pdfDocument;
    // Let pdf.js finish setting up the pages before the next file or an unmount closes
    // this one, otherwise its pending requests fail and log "Transport destroyed" errors.
    // pdf.js reports its own load errors, so a failure here can be ignored.
    await app.pdfViewer.pagesPromise?.catch(() => {});
  });
}

function applyToolbarConfig() {
  const container = root.value;
  if (!container) return;
  // A few buttons have two config keys (an old one and a new one), either one hides it
  const hiddenIds = new Set<string>();
  for (const [path, ids] of Object.entries(toolbarElementIds)) {
    if (getToolbarConfigValue(props.config, path) === false) {
      ids.forEach((id) => hiddenIds.add(id));
    }
  }
  for (const id of Object.values(toolbarElementIds).flat()) {
    container
      .querySelector(`#${id}`)
      ?.classList.toggle('vue-pdf-app-hidden', hiddenIds.has(id));
  }
}

function addStyles() {
  if (document.getElementById('vue-pdf-app-styles')) return;
  const style = document.createElement('style');
  style.id = 'vue-pdf-app-styles';
  style.textContent = `${viewerCss}
    .pdf-app .vue-pdf-app-hidden { display: none !important; }
    @media print {
      body[data-pdfjsprinting] > *:not(#printContainer) { display: none !important; }
    }`;
  document.head.append(style);
}

// Printing hides everything on <body> except this, so it has to sit outside the component
function addPrintContainer() {
  printContainer = document.createElement('div');
  printContainer.id = 'printContainer';
  document.body.append(printContainer);
}
</script>
