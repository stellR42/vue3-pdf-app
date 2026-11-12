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
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import { BaseTreeViewer } from "./base_tree_viewer.js";
import { internalOpt } from "./internal_evt.js";
class PDFLayerViewer extends BaseTreeViewer {
  constructor(options) {
    super(options);
    const {
      eventBus
    } = this;
    eventBus.on("optionalcontentconfigchanged", evt => {
      this.#updateLayers(evt.promise);
    }, internalOpt);
    eventBus.on("resetlayers", () => {
      this.#updateLayers();
    }, internalOpt);
    eventBus.on("togglelayerstree", this._toggleAllTreeItems.bind(this), internalOpt);
  }
  reset() {
    super.reset();
    this._optionalContentConfig = null;
    this._optionalContentVisibility?.clear();
    this._optionalContentVisibility = null;
  }
  _dispatchEvent(layersCount) {
    this.eventBus.dispatch("layersloaded", {
      source: this,
      layersCount
    });
  }
  _bindLink(element, {
    groupId,
    input
  }) {
    const setVisibility = () => {
      const visible = input.checked;
      this._optionalContentConfig.setVisibility(groupId, visible);
      const cached = this._optionalContentVisibility.get(groupId);
      if (cached) {
        cached.visible = visible;
      }
      this.eventBus.dispatch("optionalcontentconfig", {
        source: this,
        promise: Promise.resolve(this._optionalContentConfig)
      });
    };
    element.onclick = evt => {
      if (evt.target === input) {
        setVisibility();
        return true;
      } else if (evt.target !== element) {
        return true;
      }
      input.checked = !input.checked;
      setVisibility();
      return false;
    };
  }
  _setNestedName(element, {
    name = null
  }) {
    if (typeof name === "string") {
      element.textContent = this._normalizeTextContent(name);
      return;
    }
    element.setAttribute("data-l10n-id", "pdfjs-additional-layers");
    element.style.fontStyle = "italic";
    this._l10n.translateOnce(element);
  }
  _addToggleButton(div, {
    name = null
  }) {
    super._addToggleButton(div, name === null);
  }
  _toggleAllTreeItems() {
    if (!this._optionalContentConfig) {
      return;
    }
    super._toggleAllTreeItems();
  }
  render({
    optionalContentConfig,
    pdfDocument
  }) {
    if (this._optionalContentConfig) {
      this.reset();
    }
    this._optionalContentConfig = optionalContentConfig || null;
    this._pdfDocument = pdfDocument || null;
    const groups = optionalContentConfig?.getOrder();
    if (!groups) {
      this._dispatchEvent(0);
      return;
    }
    this._optionalContentVisibility = new Map();
    const fragment = document.createDocumentFragment(),
      queue = [{
        parent: fragment,
        groups
      }];
    let layersCount = 0,
      hasAnyNesting = false;
    while (queue.length > 0) {
      const levelData = queue.shift();
      for (const groupId of levelData.groups) {
        const div = document.createElement("div");
        div.className = "treeItem";
        const element = document.createElement("a");
        div.append(element);
        if (typeof groupId === "object") {
          hasAnyNesting = true;
          this._addToggleButton(div, groupId);
          this._setNestedName(element, groupId);
          const itemsDiv = document.createElement("div");
          itemsDiv.className = "treeItems";
          div.append(itemsDiv);
          queue.push({
            parent: itemsDiv,
            groups: groupId.order
          });
        } else {
          const group = optionalContentConfig.getGroup(groupId);
          const label = document.createElement("label");
          const input = document.createElement("input");
          label.append(input, document.createTextNode(this._normalizeTextContent(group.name)));
          this._bindLink(element, {
            groupId,
            input
          });
          input.type = "checkbox";
          input.checked = group.visible;
          this._optionalContentVisibility.set(groupId, {
            input,
            visible: input.checked
          });
          element.append(label);
          layersCount++;
        }
        levelData.parent.append(div);
      }
    }
    this._finishRendering(fragment, layersCount, hasAnyNesting);
  }
  async #updateLayers(promise = null) {
    if (!this._optionalContentConfig) {
      return;
    }
    const pdfDocument = this._pdfDocument;
    const optionalContentConfig = await (promise || pdfDocument.getOptionalContentConfig({
      intent: "display"
    }));
    if (pdfDocument !== this._pdfDocument) {
      return;
    }
    if (promise) {
      for (const [groupId, cached] of this._optionalContentVisibility) {
        const group = optionalContentConfig.getGroup(groupId);
        if (group && cached.visible !== group.visible) {
          cached.input.checked = cached.visible = !cached.visible;
        }
      }
      return;
    }
    this.eventBus.dispatch("optionalcontentconfig", {
      source: this,
      promise: Promise.resolve(optionalContentConfig)
    });
    this.render({
      optionalContentConfig,
      pdfDocument: this._pdfDocument
    });
  }
}
export { PDFLayerViewer };