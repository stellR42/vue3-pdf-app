# vue3-pdf-app

Vue 3 PDF viewer component built on Mozilla's [PDF.js](https://github.com/mozilla/pdf.js) 6.5 viewer: the full toolbar, search, thumbnails, annotations, print and download, with TypeScript types and nothing to host.

[![npm (tag)](https://img.shields.io/npm/v/vue3-pdf-app/latest)](https://www.npmjs.com/package/vue3-pdf-app)

It's the complete PDF.js viewer inside your Vue app, the same one Firefox uses for PDFs.

![pdf sample](./readme/sample.png 'Pdf example')

Coming from 1.x? Version 2 has breaking changes, see [Upgrading from 1.x](#upgrading-from-1x). Originally based on [vue-pdf-app](https://github.com/sandanat/vue-pdf-app).

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Props](#props)
- [Events](#events)
- [How the viewer behaves](#how-the-viewer-behaves)
- [Colors](#colors)
- [Lazy loading](#lazy-loading)
- [TypeScript](#typescript)
- [Licenses](#licenses)
- [Upgrading from 1.x](#upgrading-from-1x)
- [FAQ](https://github.com/stellR42/vue3-pdf-app/blob/master/FAQ.md)

## Features

Everything the PDF.js viewer does:

- zoom, rotate, page navigation, scroll and spread modes
- print and download
- find, with match case, whole words and highlight all
- thumbnails, outline, attachments and layers sidebar
- password protected PDFs
- document properties
- highlight, text, drawing, image, signature and comment tools
- JPEG 2000 and JBIG2 images, Chinese, Japanese and Korean text, and PDFs without embedded fonts

Nothing to host: the pdf.js worker, CSS, icons, image decoders, character maps and fonts are all bundled. The decoders, character maps and fonts are separate chunks that only load when a PDF needs them.

## Requirements

- Vue 3.2 or newer
- A bundler that understands ES modules (Vite, webpack 5, Rollup). The package is ES module only.
- Chrome or Edge 125+, Safari 18+, or a current Firefox
- A browser. The package uses `window` as soon as it's imported, so it can't be imported during server-side rendering. In a server-rendered app, import it only on the client (see [Lazy loading](#lazy-loading)).

## Installation

```
npm install vue3-pdf-app
```

## Usage

```vue
<template>
  <!-- The viewer fills its container, so give it a height -->
  <vue-pdf-app style="height: 100vh" pdf="/sample.pdf" />
</template>

<script setup>
import VuePdfApp from 'vue3-pdf-app';
</script>
```

Three things to know:

- **Give it a height.** The viewer fills its container and has no height of its own.
- **No CSS import.** The styles are added to the page when the viewer mounts. They're scoped to `.pdf-app`, so they don't touch the rest of your app.
- **One viewer at a time.** pdf.js keeps a single viewer object for the whole page. Mounting a second viewer closes the first and logs a warning.

## Props

All props are optional.

| Prop                          | Type                    | What it does                            | When it's read               |
| ----------------------------- | ----------------------- | --------------------------------------- | ---------------------------- |
| [`pdf`](#pdf)                 | `string \| ArrayBuffer` | The PDF to show                         | Any time, changes apply      |
| [`config`](#config)           | `ToolbarConfig`         | Hides toolbar buttons                   | Any time, changes apply      |
| [`theme`](#theme)             | `'dark' \| 'light'`     | Forces a theme                          | Any time, changes apply      |
| [`file-name`](#file-name)     | `string`                | Name for downloads                      | Each time a PDF opens        |
| [`page-number`](#page-number) | `number`                | Page to open at                         | Each time a PDF opens        |
| [`page-scale`](#page-scale)   | `number \| string`      | Starting zoom                           | Once, when the viewer mounts |
| [`title`](#title)             | `boolean`               | Puts the PDF's title in the browser tab | Once, when the viewer mounts |
| [`options`](#options)         | `PdfOptions`            | pdf.js settings                         | Once, when the viewer mounts |

To change a mount-only prop later, re-create the viewer by giving it a different `key`.

### pdf

- Type: `string | ArrayBuffer`

URL of the PDF (blob URLs work), or its contents. An `ArrayBuffer` is copied, so your buffer stays usable. Changing it opens the new file; setting it to `undefined` closes the current one.

```vue
<vue-pdf-app pdf="https://example.com/sample.pdf" />
<vue-pdf-app :pdf="arrayBuffer" />
```

### config

- Type: `ToolbarConfig`

Hides toolbar buttons or whole groups. Set a button or a group to `false` to hide it. Anything you leave out stays visible, so you only list what you want hidden.

```vue
<script setup>
// hide the "Previous page" button
const config = { toolbar: { toolbarViewerLeft: { previous: false } } };

// hide the whole page navigation group
const config2 = { toolbar: { toolbarViewerLeft: false } };

// hide the whole toolbar
const config3 = { toolbar: false };
</script>

<template>
  <vue-pdf-app :config="config" />
</template>
```

<details>
<summary>Every key</summary>

```js
{
  sidebar: {
    viewThumbnail: true,
    viewOutline: true,
    viewAttachments: true
  },
  secondaryToolbar: {
    secondaryPresentationMode: true,
    secondaryOpenFile: true,
    secondaryPrint: true,
    secondaryDownload: true,
    secondaryViewBookmark: true,
    firstPage: true,
    lastPage: true,
    pageRotateCw: true,
    pageRotateCcw: true,
    cursorSelectTool: true,
    cursorHandTool: true,
    scrollPage: true,
    scrollVertical: true,
    scrollHorizontal: true,
    scrollWrapped: true,
    spreadNone: true,
    spreadOdd: true,
    spreadEven: true,
    documentProperties: true
  },
  toolbar: {
    toolbarViewerLeft: {
      findbar: true,
      previous: true,
      next: true,
      pageNumber: true
    },
    toolbarViewerRight: {
      presentationMode: true,
      openFile: true,
      print: true,
      download: true,
      viewBookmark: true,
      editorComment: true,
      editorHighlight: true,
      editorFreeText: true,
      editorInk: true,
      editorStamp: true,
      editorSignature: true
    },
    toolbarViewerMiddle: {
      zoomOut: true,
      zoomIn: true,
      scaleSelectContainer: true
    }
  }
}
```

The presentation mode, open file and bookmark buttons only exist in the secondary menu (the `>>` button). Each has two keys, one under `secondaryToolbar` and one under `toolbarViewerRight`. Setting either one to `false` hides it.

</details>

### theme

- Type: `'dark' | 'light'`

Forces a theme. Leave it unset to follow the browser's light or dark setting.

```vue
<vue-pdf-app theme="dark" />
```

### file-name

- Type: `string`

File name used for downloads and shown in document properties. Without it, PDFs opened from an `ArrayBuffer` or blob URL download as `document.pdf`. It only applies to the PDF from the `pdf` prop; a file the user opens from the toolbar keeps its own name.

```vue
<vue-pdf-app :pdf="blobUrl" file-name="report.pdf" />
```

### page-number

- Type: `number`

Page to show when a PDF opens. Without it, a PDF the user has opened before reopens where they left it (see [Reopening a PDF](#reopening-a-pdf)).

```vue
<vue-pdf-app :page-number="3" />
```

### page-scale

- Type: `number | 'page-actual' | 'page-width' | 'page-height' | 'page-fit' | 'auto'`

Starting zoom. Numbers are percentages.

```vue
<vue-pdf-app :page-scale="75" />
<vue-pdf-app page-scale="page-width" />
```

### title

- Type: `boolean`
- Default: `false`

`true` sets the browser tab's title (`document.title`) to the PDF's title.

### options

- Type: `PdfOptions`

Settings passed straight to pdf.js (its `AppOptions`). They're applied after the component's own defaults, so they can override them. The common ones are typed; any other option from pdf.js's [app_options.js](https://github.com/mozilla/pdf.js/blob/master/web/app_options.js) works too.

```vue
<!-- open links in the same tab, and start with the sidebar showing thumbnails -->
<vue-pdf-app :options="{ externalLinkTarget: 1, sidebarViewOnLoad: 1 }" />
```

The component's defaults:

- links in the PDF open in a new tab
- the signature and comment tools are on
- the viewer adds nothing to the browser's back/forward history
- JavaScript inside PDFs is off
- the interface is English

## Events

| Event            | Fires                                                     |
| ---------------- | --------------------------------------------------------- |
| `after-created`  | Once per mount, when pdf.js is set up, before a PDF opens |
| `open`           | Each time a PDF has loaded, before its pages are drawn    |
| `pages-rendered` | Each time a PDF's pages are all set up                    |

They fire in that order. `open` and `pages-rendered` also fire for PDFs the user opens from the toolbar.

Every event passes `app`, which is pdf.js's own viewer object ([PDFViewerApplication](https://github.com/mozilla/pdf.js/blob/master/web/app.js)). Use it to drive the viewer from your code:

```vue
<template>
  <vue-pdf-app pdf="/sample.pdf" @open="showInfo" @pages-rendered="fitHeight" />
</template>

<script setup>
async function showInfo(app) {
  const { info } = await app.pdfDocument.getMetadata();
  console.log(info.Title, info.Author);
}

function fitHeight(app) {
  app.pdfViewer.currentScaleValue = 'page-height';
}
</script>
```

Two notes on `app`:

- Don't store it in reactive state (`ref`, `reactive`). It's a large object and Vue would wrap all of it. A plain variable is fine.
- pdf.js has no types for its viewer, so `app` is typed as `PdfApp` with only the commonly used parts filled in. The rest is `any`.

## How the viewer behaves

### Keyboard and zoom

pdf.js's shortcuts (Ctrl+F, Ctrl+P, arrows, `j`, `k`, `r` and so on) only work while focus is inside the viewer, so they don't take over your app's keys. Ctrl+P outside the viewer prints your page as usual.

Ctrl+wheel and pinch work the same way: over the viewer they zoom the PDF, anywhere else they zoom the page.

### Reopening a PDF

When a user opens a PDF they've opened before, it reopens at the page and zoom they left it at. pdf.js remembers this in the browser's `localStorage` for the last 20 files. Set `page-number` to always start on a given page, or pass `:options="{ viewOnLoad: 1 }"` to always start at the top.

### Unsaved edits

Highlights, drawings, comments and other edits live only in the viewer. Download saves them into the downloaded file. They're dropped without a prompt when the PDF changes or the viewer unmounts. If your app doesn't save edits anywhere, hide the editing tools through [`config`](#config).

## Colors

The viewer uses pdf.js's own CSS variables. Override them on `.pdf-app`:

```css
.pdf-app {
  --toolbar-bg-color: #1e3a5f;
  --main-color: white;
  --body-bg-color: #e5e7eb;
}
```

See `viewer.css` in pdf.js for the full list.

## Lazy loading

The package is about 3.4 MB (about 830 KB gzipped). Load it only when it's needed:

```vue
<script setup>
import { defineAsyncComponent } from 'vue';

const VuePdfApp = defineAsyncComponent(() => import('vue3-pdf-app'));
</script>
```

## TypeScript

Types ship with the package. Besides the component, it exports:

```ts
import VuePdfApp, {
  type ToolbarConfig, // the config prop
  type PdfOptions, // the options prop
  type PdfApp, // the app object the events pass
  type PdfDocument, // app.pdfDocument
  type PageScale, // the page-scale prop
  type Theme, // the theme prop
} from 'vue3-pdf-app';
```

## Licenses

The package is MIT licensed. It bundles pdf.js and the fonts, character maps and image decoders that come with it. Their license texts are in `dist/THIRD_PARTY_LICENSES.txt`.

## Upgrading from 1.x

2.0 moves from pdf.js 2.4 to pdf.js 6.5. pdf.js rebuilt its viewer in between, so these changed:

| 1.x                                                                      | 2.0                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import "vue3-pdf-app/dist/icons/main.css"`                              | Remove it. Styles and icons are built in, and the file no longer exists.                                                                                                |
| Custom icons through `.vue-pdf-app-icon`                                 | Not supported. The viewer uses pdf.js's own icons.                                                                                                                      |
| `id-config` prop (custom toolbar bound by element id)                    | Removed. Hide buttons with `config` and drive pdf.js from your own buttons through the `app` object from `after-created`, for example `app.zoomIn()` or `app.page = 3`. |
| Slots (`toolbar-left-prepend`, `footer`, `viewer-header` and the rest)   | Removed. Put your own buttons outside the viewer and use the `app` object as above.                                                                                     |
| `toggleTheme`, `isSidebarHidden`, `isFindbarHidden` slot props           | Removed with the slots. Use the `theme` prop.                                                                                                                           |
| `theme.sync` / `v-model:theme`                                           | `theme` is a plain prop now. Leaving it unset follows the browser's setting.                                                                                            |
| `.pdf-app.dark` / `.pdf-app.light` classes and `--pdf-*` color variables | Removed. See [Colors](#colors).                                                                                                                                         |
| `config.errorWrapper`                                                    | Removed. pdf.js 6 shows load errors in its own dialog.                                                                                                                  |
| `config` keys                                                            | Still work. Added `secondaryToolbar.scrollPage` and the editor buttons under `toolbarViewerRight`.                                                                      |
| UMD build, `<script>` tag, CommonJS `require`                            | ES module only.                                                                                                                                                         |
| `<link rel="resource" type="application/l10n">` translations             | Only English is bundled.                                                                                                                                                |
| Old browsers                                                             | Chrome 125+ and Safari 18+ are needed.                                                                                                                                  |
| Keyboard shortcuts and Ctrl+wheel zoom on the whole page                 | Only inside the viewer.                                                                                                                                                 |
| Links in the PDF replaced your app                                       | Open in a new tab. `:options="{ externalLinkTarget: 1 }"` restores the old behavior.                                                                                    |
| Two viewers on one page broke both                                       | The newer one wins, the older one closes.                                                                                                                               |

New in 2.0: the `options` prop, the editing tools (highlight, text, drawing, image, signature, comment), bundled JPEG 2000 and JBIG2 decoders, bundled character maps and fonts, and nothing to host next to your app.
