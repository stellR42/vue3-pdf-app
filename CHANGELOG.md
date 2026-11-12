# vue3-pdf-app 2.0.0

Moves from pdf.js 2.4 to pdf.js 6.5 and rebuilds the package with Vite. Breaking changes are listed in [Upgrading from 1.x](./README.md#upgrading-from-1x) in the README.

## Features

1. The editing tools from pdf.js 6: highlight, text, drawing, image, signature and comment.
1. `options` prop, passed to pdf.js's `AppOptions`.
1. JPEG 2000 and JBIG2 images, character maps (Chinese, Japanese, Korean) and the standard fonts are bundled. They load only when a PDF needs them.
1. Nothing to host next to your app: the worker, CSS and icons are bundled too.
1. TypeScript types for the toolbar config, the common pdf.js options and the `app` object the events pass.
1. The license texts of everything bundled are in `dist/THIRD_PARTY_LICENSES.txt`.

## Changes

1. ⚠️ **breaking** Removed the `id-config` prop and the toolbar slots.
1. ⚠️ **breaking** Removed the icons CSS file, custom icons and the `--pdf-*` color variables. Colors use pdf.js's own CSS variables.
1. ⚠️ **breaking** ES module only. The UMD build and the `<script>` tag usage are gone.
1. ⚠️ **breaking** Needs Chrome or Edge 125+, Safari 18+ or a current Firefox.
1. ⚠️ **breaking** `config.errorWrapper` removed. pdf.js shows load errors in its own dialog.
1. Keyboard shortcuts only work while focus is inside the viewer.
1. Links in the PDF open in a new tab instead of replacing your app.
1. Mounting a second viewer closes the first one instead of breaking both.
1. The interface is always English and left to right, whatever the browser's language.

## Bugs

1. Unmounting, remounting or switching files quickly no longer leaks listeners, shows the wrong file or logs errors.

# vue3-pdf-app 1.0.3

1. `page-number` is applied when a PDF is first opened.

# vue3-pdf-app 1.0.2

1. `pages-rendered` also fires when a PDF is opened.

# vue3-pdf-app 1.0.0 - 1.0.1

1. First release of the Vue 3 fork of vue-pdf-app: moved to Vue 3 and the composition API.

---

The entries below are from the original [vue-pdf-app](https://github.com/sandanat/vue-pdf-app) for Vue 2 and use its version numbers.

# vue-pdf-app v2.1.0

## Features

1. Toolbar custom UI
1. Introduced prop `fileName`
1. Introduced prop `pageScale`
1. Introduced prop `pageNumber`

## Bugs

1. The loading bar (progress bar) is displayed only for the first time - [b87b092](https://github.com/sandanat/vue-pdf-app/commit/b87b092676fa644305266fc5d91d6ef7d8e7b6c1), closes [#48](https://github.com/sandanat/vue-pdf-app/issues/48)

# vue-pdf-app v2.0.0

## Features

1. ⚠️ **breaking** Added pdf-viewer icons customization.
1. Added pdf viewer color customization via custom css properties.
1. Added slots for toolbar and footer.
1. Added events `pages-rendered` and `after-created`.
1. Added light/dark theme with toggle.
1. Added `title` prop.

## Other

1. ⚠️ **breaking** Changed `v-bind:config` prop. Deleted `config.viewerContextMenu` and `config.toolbar.toolbarViewerRight.secondaryToolbarToggle`. Visibility of **secondaryToolbarToggle** depends from `config.secondaryToolbar`. Moved prop `config.findbar` into `config.toolbar.toolbarViewerLeft.findbar`.
1. ⚠️ **breaking** Renamed `v-bind:config` **toolbar.toolbarViewerMiddle.scaleSelectContatiner** prop to `toolbar.toolbarViewerMiddle.scaleSelectContainer`.
1. ⚠️ **breaking** Renamed lib from _pdf-viewer_ to _vue-pdf-app_. Use `window["vue-pdf-app"]` instead of `window["pdf-viewer"]` for script tag.

# vue-pdf-app v1.0.2

## Bugs

1. #mainContainer min-width hides secondary toolbar button - [a0b09c4](https://github.com/sandanat/vue-pdf-app/pull/20/commits/a0b09c4b86632f0b816856534f3975a2c0817e62), [PR #20](https://github.com/sandanat/vue-pdf-app/pull/20).

# vue-pdf-app v1.0.1

## Bugs

1. Pdf styles mutate global styles - [dc3c6ba](https://github.com/sandanat/vue-pdf-app/pull/13/commits/dc3c6ba7d9fde22753a9073c117628179e07e63e), closes [#11](https://github.com/sandanat/vue-pdf-app/issues/11).
