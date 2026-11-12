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
import { AnnotationEditorLayer } from "../pdf.js";
import { GenericL10n } from "../web/genericl10n.js";
class AnnotationEditorLayerBuilder {
  #annotationLayer = null;
  #drawLayer = null;
  #onAppend = null;
  #structTreeLayer = null;
  #textLayer = null;
  #uiManager;
  constructor(options) {
    this.pageIndex = options.pageIndex;
    this.accessibilityManager = options.accessibilityManager;
    this.l10n = options.l10n;
    this.l10n ||= new GenericL10n();
    this.annotationEditorLayer = null;
    this.div = null;
    this._cancelled = false;
    this.#uiManager = options.uiManager;
    this.#annotationLayer = options.annotationLayer || null;
    this.#textLayer = options.textLayer || null;
    this.#drawLayer = options.drawLayer || null;
    this.#onAppend = options.onAppend || null;
    this.#structTreeLayer = options.structTreeLayer || null;
  }
  updatePageIndex(newPageIndex) {
    this.pageIndex = newPageIndex;
    this.annotationEditorLayer?.updatePageIndex(newPageIndex);
  }
  async render({
    viewport,
    intent = "display"
  }) {
    if (intent !== "display" || this._cancelled) {
      return;
    }
    const clonedViewport = viewport.clone({
      dontFlip: true
    });
    if (this.div) {
      this.annotationEditorLayer.update({
        viewport: clonedViewport
      });
      this.show();
      return;
    }
    const div = this.div = document.createElement("div");
    div.className = "annotationEditorLayer";
    div.hidden = true;
    div.dir = this.#uiManager.direction;
    this.#onAppend?.(div);
    this.annotationEditorLayer = new AnnotationEditorLayer({
      uiManager: this.#uiManager,
      div,
      structTreeLayer: this.#structTreeLayer,
      accessibilityManager: this.accessibilityManager,
      pageIndex: this.pageIndex,
      l10n: this.l10n,
      viewport: clonedViewport,
      annotationLayer: this.#annotationLayer,
      textLayer: this.#textLayer,
      drawLayer: this.#drawLayer
    });
    const parameters = {
      viewport: clonedViewport,
      div,
      annotations: null,
      intent
    };
    await this.annotationEditorLayer.render(parameters);
    this.show();
  }
  update(viewport) {
    if (this.div) {
      this.annotationEditorLayer.update({
        viewport: viewport.clone({
          dontFlip: true
        })
      });
    }
  }
  cancel() {
    this._cancelled = true;
    if (!this.div) {
      return;
    }
    this.annotationEditorLayer.destroy();
  }
  hide() {
    if (!this.div) {
      return;
    }
    this.annotationEditorLayer.pause(true);
    this.div.hidden = true;
  }
  show() {
    if (!this.div || this.annotationEditorLayer.isInvisible) {
      return;
    }
    this.div.hidden = false;
    this.annotationEditorLayer.pause(false);
  }
}
export { AnnotationEditorLayerBuilder };