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
import { AnnotationMode, PixelsPerInch, RenderingCancelledException, shadow } from "../pdf.js";
import { BasePrintServiceFactory, getXfaHtmlForPrinting } from "./print_utils.js";
import { AppOptions } from "./app_options.js";
function composePage(pdfDocument, pageNumber, size, printContainer, printResolution, shouldPostMessageAfterPrintCallback, optionalContentConfigPromise, printAnnotationStoragePromise) {
  const canvas = document.createElement("canvas");
  const PRINT_UNITS = printResolution / PixelsPerInch.PDF;
  canvas.width = Math.floor(size.width * PRINT_UNITS);
  canvas.height = Math.floor(size.height * PRINT_UNITS);
  const canvasWrapper = document.createElement("div");
  canvasWrapper.className = "printedPage";
  canvasWrapper.append(canvas);
  printContainer.append(canvasWrapper);
  let currentRenderTask = null;
  canvas.mozPrintCallback = function (obj) {
    const ctx = obj.context;
    ctx.save();
    ctx.fillStyle = "rgb(255, 255, 255)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    let thisRenderTask = null;
    Promise.all([pdfDocument.getPage(pageNumber), printAnnotationStoragePromise]).then(function ([pdfPage, printAnnotationStorage]) {
      if (currentRenderTask) {
        currentRenderTask.cancel();
        currentRenderTask = null;
      }
      const renderContext = {
        canvasContext: ctx,
        canvas: null,
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
      currentRenderTask = thisRenderTask = pdfPage.render(renderContext);
      return thisRenderTask.promise;
    }).then(function () {
      if (currentRenderTask === thisRenderTask) {
        currentRenderTask = null;
      }
      obj.done();
      if (shouldPostMessageAfterPrintCallback) {
        window.postMessage("ready", "*");
      }
    }, function (reason) {
      if (!(reason instanceof RenderingCancelledException)) {
        console.error(reason);
      }
      if (currentRenderTask === thisRenderTask) {
        currentRenderTask.cancel();
        currentRenderTask = null;
      }
      if ("abort" in obj) {
        obj.abort();
      } else {
        obj.done();
      }
      if (shouldPostMessageAfterPrintCallback) {
        window.postMessage("error", "*");
      }
    });
  };
}
class FirefoxPrintService {
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
  }
  layout() {
    const {
      pdfDocument,
      pagesOverview,
      printContainer,
      _printResolution,
      _optionalContentConfigPromise,
      _printAnnotationStoragePromise
    } = this;
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
    this.pageStyleSheet.replaceSync(`@page { size: ${width}pt ${height}pt;}`);
    document.adoptedStyleSheets.push(this.pageStyleSheet);
    if (pdfDocument.isPureXfa) {
      getXfaHtmlForPrinting(printContainer, pdfDocument);
      return;
    }
    const shouldPostMessageAfterPrintCallback = AppOptions.get("postMessageAfterPrintCallback");
    for (let i = 0, ii = pagesOverview.length; i < ii; ++i) {
      composePage(pdfDocument, i + 1, pagesOverview[i], printContainer, _printResolution, shouldPostMessageAfterPrintCallback, _optionalContentConfigPromise, _printAnnotationStoragePromise);
    }
  }
  destroy() {
    this.printContainer.textContent = "";
    const body = document.querySelector("body");
    body.removeAttribute("data-pdfjsprinting");
    if (this.pageStyleSheet) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(styleSheet => styleSheet !== this.pageStyleSheet);
      this.pageStyleSheet = null;
    }
  }
}
class PDFPrintServiceFactory extends BasePrintServiceFactory {
  static get supportsPrinting() {
    const canvas = document.createElement("canvas");
    return shadow(this, "supportsPrinting", "mozPrintCallback" in canvas);
  }
  static createPrintService(params) {
    return new FirefoxPrintService(params);
  }
}
export { PDFPrintServiceFactory };