/* Copyright 2024 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import "core-js/modules/es.array.push.js";
import "core-js/modules/es.iterator.constructor.js";
import "core-js/modules/es.iterator.every.js";
import "core-js/modules/es.iterator.filter.js";
import "core-js/modules/es.json.stringify.js";
import { AnnotationMode, PixelsPerInch, RenderingCancelledException, shadow } from "../pdf.js";
import { BasePrintServiceFactory, getXfaHtmlForPrinting } from "./print_utils.js";
let activeService = null;
let dialog = null;
let overlayManager = null;
let viewerApp = {
  initialized: false
};
function renderPage(activeServiceOnEntry, pdfDocument, pageNumber, size, printResolution, optionalContentConfigPromise, printAnnotationStoragePromise) {
  const scratchCanvas = activeService.scratchCanvas;
  const PRINT_UNITS = printResolution / PixelsPerInch.PDF;
  scratchCanvas.width = Math.floor(size.width * PRINT_UNITS);
  scratchCanvas.height = Math.floor(size.height * PRINT_UNITS);
  const ctx = scratchCanvas.getContext("2d");
  ctx.save();
  ctx.fillStyle = "rgb(255, 255, 255)";
  ctx.fillRect(0, 0, scratchCanvas.width, scratchCanvas.height);
  ctx.restore();
  return Promise.all([pdfDocument.getPage(pageNumber), printAnnotationStoragePromise]).then(function ([pdfPage, printAnnotationStorage]) {
    const renderContext = {
      canvas: scratchCanvas,
      transform: [PRINT_UNITS, 0, 0, PRINT_UNITS, 0, 0],
      viewport: pdfPage.getViewport({
        scale: 1,
        rotation: size.rotation
      }),
      intent: "print",
      annotationMode: AnnotationMode.ENABLE_STORAGE,
      optionalContentConfigPromise,
      printAnnotationStorage
    };
    const renderTask = pdfPage.render(renderContext);
    return renderTask.promise.catch(reason => {
      if (!(reason instanceof RenderingCancelledException)) {
        console.error(reason);
      }
      throw reason;
    });
  });
}
class PDFPrintService {
  constructor({
    pdfDocument,
    pagesOverview,
    printContainer,
    printResolution,
    printAnnotationStoragePromise = null
  }) {
    this.pdfDocument = pdfDocument;
    this.pagesOverview = pagesOverview;
    this.printContainer = printContainer;
    this._printResolution = printResolution || 150;
    this._optionalContentConfigPromise = pdfDocument.getOptionalContentConfig({
      intent: "print"
    });
    this._printAnnotationStoragePromise = printAnnotationStoragePromise || Promise.resolve();
    this.currentPage = -1;
    this.scratchCanvas = document.createElement("canvas");
  }
  layout() {
    this.throwIfInactive();
    const body = document.querySelector("body");
    body.setAttribute("data-pdfjsprinting", true);
    const {
      width,
      height
    } = this.pagesOverview[0];
    const hasEqualPageSizes = this.pagesOverview.every(size => size.width === width && size.height === height);
    if (!hasEqualPageSizes) {
      console.warn("Not all pages have the same size. The printed result may be incorrect!");
    }
    this.pageStyleSheet = new CSSStyleSheet();
    this.pageStyleSheet.replaceSync(`@page { size: ${width}pt ${height}pt; margin: 0;}`);
    document.adoptedStyleSheets.push(this.pageStyleSheet);
  }
  destroy() {
    if (activeService !== this) {
      return;
    }
    this.printContainer.textContent = "";
    const body = document.querySelector("body");
    body.removeAttribute("data-pdfjsprinting");
    if (this.pageStyleSheet) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(styleSheet => styleSheet !== this.pageStyleSheet);
      this.pageStyleSheet = null;
    }
    if (this._blobURLs) {
      for (const url of this._blobURLs) {
        URL.revokeObjectURL(url);
      }
      this._blobURLs = null;
    }
    this.scratchCanvas.width = this.scratchCanvas.height = 0;
    this.scratchCanvas = null;
    activeService = null;
    ensureOverlay().then(function () {
      overlayManager.closeIfActive(dialog);
    });
  }
  renderPages() {
    if (this.pdfDocument.isPureXfa) {
      getXfaHtmlForPrinting(this.printContainer, this.pdfDocument);
      return Promise.resolve();
    }
    const pageCount = this.pagesOverview.length;
    const renderNextPage = (resolve, reject) => {
      this.throwIfInactive();
      if (++this.currentPage >= pageCount) {
        renderProgress(pageCount, pageCount);
        resolve();
        return;
      }
      const index = this.currentPage;
      renderProgress(index, pageCount);
      renderPage(this, this.pdfDocument, index + 1, this.pagesOverview[index], this._printResolution, this._optionalContentConfigPromise, this._printAnnotationStoragePromise).then(this.useRenderedPage.bind(this)).then(function () {
        renderNextPage(resolve, reject);
      }, reject);
    };
    return new Promise(renderNextPage);
  }
  useRenderedPage() {
    this.throwIfInactive();
    const img = document.createElement("img");
    this.scratchCanvas.toBlob(blob => {
      const blobURL = URL.createObjectURL(blob);
      img.src = blobURL;
      (this._blobURLs ??= []).push(blobURL);
    });
    const wrapper = document.createElement("div");
    wrapper.className = "printedPage";
    wrapper.append(img);
    this.printContainer.append(wrapper);
    const {
      promise,
      resolve,
      reject
    } = Promise.withResolvers();
    img.onload = resolve;
    img.onerror = reject;
    promise.catch(() => {});
    return promise;
  }
  performPrint() {
    this.throwIfInactive();
    return new Promise(resolve => {
      setTimeout(() => {
        if (!this.active) {
          resolve();
          return;
        }
        print.call(window);
        setTimeout(resolve, 20);
      }, 0);
    });
  }
  get active() {
    return this === activeService;
  }
  throwIfInactive() {
    if (!this.active) {
      throw new Error("This print request was cancelled or completed.");
    }
  }
}
const print = window.print;
window.print = function () {
  if (activeService) {
    console.warn("Ignored window.print() because of a pending print job.");
    return;
  }
  ensureOverlay().then(function () {
    if (activeService) {
      overlayManager.open(dialog);
    }
  });
  try {
    dispatchEvent("beforeprint");
  } finally {
    if (!activeService) {
      console.error("Expected print service to be initialized.");
      ensureOverlay().then(function () {
        overlayManager.closeIfActive(dialog);
      });
    } else {
      const activeServiceOnEntry = activeService;
      activeService.renderPages().then(() => activeServiceOnEntry.performPrint()).catch(() => {}).then(() => {
        if (activeServiceOnEntry.active) {
          abort();
        }
      });
    }
  }
};
function dispatchEvent(eventType) {
  const event = new CustomEvent(eventType, {
    bubbles: false,
    cancelable: false,
    detail: "custom"
  });
  window.dispatchEvent(event);
}
function abort() {
  if (activeService) {
    activeService.destroy();
    dispatchEvent("afterprint");
  }
}
function renderProgress(index, total) {
  dialog ||= document.getElementById("printServiceDialog");
  const progress = Math.round(100 * index / total);
  const progressBar = dialog.querySelector("progress");
  const progressPerc = dialog.querySelector(".relative-progress");
  progressBar.value = progress;
  progressPerc.setAttribute("data-l10n-args", JSON.stringify({
    progress
  }));
}
window.addEventListener("keydown", function (event) {
  if (event.target.closest?.(".pdf-app") && event.keyCode === 80 && (event.ctrlKey || event.metaKey) && !event.altKey && (!event.shiftKey || window.chrome || window.opera)) {
    window.print();
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);
if ("onbeforeprint" in window) {
  const stopPropagationIfNeeded = function (event) {
    if (event.detail !== "custom" && document.querySelector(".pdf-app")) {
      event.stopImmediatePropagation();
    }
  };
  window.addEventListener("beforeprint", stopPropagationIfNeeded);
  window.addEventListener("afterprint", stopPropagationIfNeeded);
}
let overlayPromise;
function ensureOverlay() {
  if (!overlayPromise) {
    overlayManager = viewerApp.overlayManager;
    if (!overlayManager) {
      throw new Error("The overlay manager has not yet been initialized.");
    }
    dialog ||= document.getElementById("printServiceDialog");
    overlayPromise = overlayManager.register(dialog, true);
    document.getElementById("printCancel").onclick = abort;
    dialog.addEventListener("close", abort);
  }
  return overlayPromise;
}
class PDFPrintServiceFactory extends BasePrintServiceFactory {
  static initGlobals(app) {
    viewerApp = app;
  }
  static get supportsPrinting() {
    return shadow(this, "supportsPrinting", true);
  }
  static createPrintService(params) {
    if (activeService) {
      throw new Error("The print service is created and active.");
    }
    return activeService = new PDFPrintService(params);
  }
}
export { PDFPrintServiceFactory };