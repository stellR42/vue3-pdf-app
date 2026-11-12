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
import "core-js/modules/es.iterator.constructor.js";
import "core-js/modules/es.iterator.find.js";
import "core-js/modules/es.iterator.for-each.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import { normalizeUnicode, stopEvent, TextLayer } from "../pdf.js";
import { removeNullCharacters } from "./ui_utils.js";
class TextLayerBuilder {
  #abortSignal = null;
  #enablePermissions = false;
  #onAppend = null;
  #renderingDone = false;
  #textLayer = null;
  static #textLayers = new Map();
  static #selectionChangeAC = null;
  constructor({
    pdfPage,
    highlighter = null,
    accessibilityManager = null,
    enablePermissions = false,
    onAppend = null,
    abortSignal = null
  }) {
    this.pdfPage = pdfPage;
    this.highlighter = highlighter;
    this.accessibilityManager = accessibilityManager;
    this.#enablePermissions = enablePermissions === true;
    this.#onAppend = onAppend;
    this.#abortSignal = abortSignal;
    this.div = document.createElement("div");
    this.div.tabIndex = 0;
    this.div.className = "textLayer";
  }
  async render({
    viewport,
    images,
    textContentParams = null
  }) {
    if (this.#renderingDone && this.#textLayer) {
      this.#textLayer.update({
        viewport
      });
      this.show();
      return;
    }
    this.cancel();
    this.#textLayer = new TextLayer({
      textContentSource: this.pdfPage.streamTextContent(textContentParams || {
        includeMarkedContent: true,
        disableNormalization: true
      }),
      images,
      container: this.div,
      viewport
    });
    const {
      textDivs,
      textContentItemsStr
    } = this.#textLayer;
    this.highlighter?.setTextMapping(textDivs, textContentItemsStr);
    this.accessibilityManager?.setTextMapping(textDivs);
    await this.#textLayer.render();
    this.#renderingDone = true;
    const endOfContent = document.createElement("div");
    endOfContent.className = "endOfContent";
    this.div.append(endOfContent);
    this.#bindMouse(endOfContent);
    this.#onAppend?.(this.div);
    this.highlighter?.enable();
    this.accessibilityManager?.enable();
  }
  hide() {
    if (!this.div.hidden && this.#renderingDone) {
      this.highlighter?.disable();
      this.div.hidden = true;
    }
  }
  show() {
    if (this.div.hidden && this.#renderingDone) {
      this.div.hidden = false;
      this.highlighter?.enable();
    }
  }
  cancel() {
    this.#textLayer?.cancel();
    this.#textLayer = null;
    this.#renderingDone = false;
    this.div.replaceChildren();
    this.highlighter?.disable();
    this.accessibilityManager?.disable();
    TextLayerBuilder.#removeGlobalSelectionListener(this.div);
  }
  #bindMouse(end) {
    const {
      div
    } = this;
    const abortSignal = this.#abortSignal;
    const opts = abortSignal ? {
      signal: abortSignal
    } : null;
    div.addEventListener("mousedown", () => {
      div.classList.add("selecting");
    }, opts);
    div.addEventListener("copy", event => {
      if (!this.#enablePermissions) {
        const selection = document.getSelection();
        event.clipboardData.setData("text/plain", removeNullCharacters(normalizeUnicode(selection.toString())));
      }
      stopEvent(event);
    }, opts);
    TextLayerBuilder.#textLayers.set(div, end);
    TextLayerBuilder.#enableGlobalSelectionListener(abortSignal);
  }
  static #removeGlobalSelectionListener(textLayerDiv) {
    this.#textLayers.delete(textLayerDiv);
    if (this.#textLayers.size === 0) {
      this.#selectionChangeAC?.abort();
      this.#selectionChangeAC = null;
    }
  }
  static #enableGlobalSelectionListener(globalAbortSignal) {
    if (this.#selectionChangeAC) {
      return;
    }
    this.#selectionChangeAC = new AbortController();
    const signal = globalAbortSignal ? AbortSignal.any([this.#selectionChangeAC.signal, globalAbortSignal]) : this.#selectionChangeAC.signal;
    const reset = (end, textLayer) => {
      textLayer.append(end);
      end.style.width = "";
      end.style.height = "";
      textLayer.classList.remove("selecting");
    };
    let isPointerDown = false;
    document.addEventListener("pointerdown", () => {
      isPointerDown = true;
    }, {
      signal
    });
    document.addEventListener("pointerup", () => {
      isPointerDown = false;
      this.#textLayers.forEach(reset);
    }, {
      signal
    });
    window.addEventListener("blur", () => {
      isPointerDown = false;
      this.#textLayers.forEach(reset);
    }, {
      signal
    });
    document.addEventListener("keyup", () => {
      if (!isPointerDown) {
        this.#textLayers.forEach(reset);
      }
    }, {
      signal
    });
    var isFirefoxOrModernChromium, prevRange;
    document.addEventListener("selectionchange", () => {
      const selection = document.getSelection();
      if (selection.rangeCount === 0) {
        this.#textLayers.forEach(reset);
        return;
      }
      const activeTextLayers = new Set();
      for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i);
        if (range.collapsed && !isPointerDown) {
          continue;
        }
        for (const textLayerDiv of this.#textLayers.keys()) {
          if (!activeTextLayers.has(textLayerDiv) && range.intersectsNode(textLayerDiv)) {
            activeTextLayers.add(textLayerDiv);
          }
        }
      }
      for (const [textLayerDiv, endDiv] of this.#textLayers) {
        if (activeTextLayers.has(textLayerDiv)) {
          textLayerDiv.classList.add("selecting");
        } else {
          reset(endDiv, textLayerDiv);
        }
      }
      if (isFirefoxOrModernChromium === undefined) {
        isFirefoxOrModernChromium = getComputedStyle(this.#textLayers.values().next().value).getPropertyValue("-moz-user-select") === "none";
        if (!isFirefoxOrModernChromium) {
          const chromiumVersion = navigator.userAgentData ? navigator.userAgentData.brands.find(({
            brand
          }) => brand === "Chromium")?.version : /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1];
          isFirefoxOrModernChromium = !!chromiumVersion && parseInt(chromiumVersion, 10) >= 148;
        }
      }
      if (isFirefoxOrModernChromium) {
        return;
      }
      const range = selection.getRangeAt(0);
      const modifyStart = prevRange && (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 || range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
      let anchor = modifyStart ? range.startContainer : range.endContainer;
      if (anchor.nodeType === Node.TEXT_NODE) {
        anchor = anchor.parentNode;
      }
      if (anchor.classList?.contains("highlight")) {
        anchor = anchor.parentNode;
      }
      if (!modifyStart && range.endOffset === 0) {
        do {
          while (!anchor.previousSibling) {
            anchor = anchor.parentNode;
          }
          anchor = anchor.previousSibling;
        } while (!anchor.childNodes.length);
      }
      const parentTextLayer = anchor.parentElement?.closest(".textLayer");
      const endDiv = this.#textLayers.get(parentTextLayer);
      if (endDiv) {
        endDiv.style.width = parentTextLayer.style.width;
        endDiv.style.height = parentTextLayer.style.height;
        endDiv.style.userSelect = "text";
        anchor.parentElement.insertBefore(endDiv, modifyStart ? anchor : anchor.nextSibling);
      }
      prevRange = range.cloneRange();
    }, {
      signal
    });
  }
}
export { TextLayerBuilder };