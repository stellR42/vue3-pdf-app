- [Can I use two pdf viewers on a page?](#can-i-use-two-pdf-viewers-on-a-page)
- [Can I use pdf.js outside the viewer's events?](#can-i-use-pdfjs-outside-the-viewers-events)
- [Can I use the pdf viewer in a dialog?](#can-i-use-the-pdf-viewer-in-a-dialog)
- [Can I set the starting zoom?](#can-i-set-the-starting-zoom)
- [Can I open a PDF on a certain page?](#can-i-open-a-pdf-on-a-certain-page)
- [Can I hide the editing tools?](#can-i-hide-the-editing-tools)

Still have a question? Create an issue!

# Can I use two pdf viewers on a page?

No. pdf.js keeps one viewer object for the whole page, so only one viewer can be open at a time. Mounting a second one closes the first and logs a warning.

# Can I use pdf.js outside the viewer's events?

Yes. Keep the `app` object from `after-created`. Don't put it in `ref` or `reactive`: it's a large object and Vue would wrap all of it.

```vue
<template>
  <button @click="pdfApp?.zoomIn()">Zoom in</button>
  <vue-pdf-app pdf="/sample.pdf" @after-created="afterCreated" />
</template>

<script setup lang="ts">
import VuePdfApp, { type PdfApp } from 'vue3-pdf-app';

// Not reactive on purpose
let pdfApp: PdfApp | undefined;

function afterCreated(app: PdfApp) {
  pdfApp = app;
}
</script>
```

# Can I use the pdf viewer in a dialog?

Yes. Render it with `v-if` so it mounts when the dialog opens and unmounts when it closes:

```vue
<vue-pdf-app v-if="isDialogVisible" pdf="/sample.pdf" />
```

# Can I set the starting zoom?

Use `page-scale`. Numbers are percentages.

```vue
<vue-pdf-app pdf="/sample.pdf" :page-scale="75" />
<vue-pdf-app pdf="/sample.pdf" page-scale="page-width" />
```

To change it after the PDF opens, set `app.pdfViewer.currentScaleValue` in `pages-rendered`.

# Can I open a PDF on a certain page?

Use `page-number`:

```vue
<vue-pdf-app pdf="/sample.pdf" :page-number="3" />
```

To jump later, set `app.page` on the `app` object.

# Can I hide the editing tools?

Yes, through `config`. Edits only live in the viewer, so hide them if your app doesn't save them anywhere:

```vue
<vue-pdf-app
  pdf="/sample.pdf"
  :config="{
    toolbar: {
      toolbarViewerRight: {
        editorComment: false,
        editorHighlight: false,
        editorFreeText: false,
        editorInk: false,
        editorStamp: false,
        editorSignature: false,
      },
    },
  }"
/>
```
