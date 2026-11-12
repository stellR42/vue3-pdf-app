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
import "core-js/modules/es.array.includes.js";
import "core-js/modules/es.array.push.js";
import "core-js/modules/es.iterator.constructor.js";
import "core-js/modules/es.iterator.filter.js";
import "core-js/modules/es.iterator.to-array.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import "core-js/modules/es.weak-map.get-or-insert.js";
import "core-js/modules/es.weak-map.get-or-insert-computed.js";
import { DOMSVGFactory } from "./svg_factory.js";
import { shadow } from "../shared/util.js";
function compareTextLayers(a, b) {
  if (a === b) {
    return 0;
  }
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}
function getTextLayer(node) {
  if (!node) {
    return null;
  }
  return node.nodeType === Node.ELEMENT_NODE ? node.closest(".textLayer") : node.parentElement?.closest(".textLayer") || null;
}
function isPointBefore(nodeA, offsetA, nodeB, offsetB) {
  if (nodeA === nodeB) {
    return offsetA <= offsetB;
  }
  const relation = nodeA.compareDocumentPosition(nodeB);
  if (relation & Node.DOCUMENT_POSITION_FOLLOWING) {
    return true;
  }
  if (relation & Node.DOCUMENT_POSITION_PRECEDING) {
    return false;
  }
  return null;
}
function normalizeEdgeBoundary(container, offset, textLayer) {
  if (container.nodeType !== Node.ELEMENT_NODE || !container.classList.contains("textLayer") || offset !== container.childNodes.length) {
    return {
      container,
      offset
    };
  }
  let lastNode = container.lastChild;
  if (lastNode?.nodeType === Node.ELEMENT_NODE && lastNode.classList.contains("endOfContent")) {
    lastNode = lastNode.previousSibling;
  }
  if (!lastNode || !textLayer.contains(lastNode)) {
    return null;
  }
  return lastNode.nodeType === Node.TEXT_NODE ? {
    container: lastNode,
    offset: lastNode.textContent.length
  } : {
    container: lastNode,
    offset: lastNode.childNodes.length
  };
}
class DrawLayer {
  #parent = null;
  #mapping = new Map();
  #textLayer = null;
  #filterFactory = null;
  #pageColors = null;
  #textLayerObserver = null;
  #toUpdate = new Map();
  static #id = 0;
  static #selectionId = 0;
  static #selectionChangeAC = null;
  static #selections = new Set();
  static #isSelecting = false;
  static #textLayerSet = new Set();
  static #textLayers = new WeakMap();
  constructor({
    filterFactory = null,
    pageColors = null,
    pageIndex,
    textLayer = null
  }) {
    this.pageIndex = pageIndex;
    this.#filterFactory = filterFactory;
    this.#pageColors = pageColors;
    if (textLayer) {
      const previousData = DrawLayer.#textLayers.get(textLayer);
      if (previousData?.selectionDiv) {
        previousData.selectionDiv.remove();
        DrawLayer.#selections.delete(previousData.selectionDiv);
      }
      DrawLayer.#textLayers.set(textLayer, {
        drawLayer: this
      });
      DrawLayer.#textLayerSet.add(textLayer);
      this.#textLayer = textLayer;
      this.#textLayerObserver = new MutationObserver(records => {
        if (!this.#parent || !this.#textLayer?.isConnected || !DrawLayer.#hasSelection()) {
          return;
        }
        for (const {
          addedNodes
        } of records) {
          for (const node of addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("endOfContent")) {
              DrawLayer.#selectionChange();
              return;
            }
          }
        }
      });
      this.#textLayerObserver.observe(textLayer, {
        childList: true
      });
      if (DrawLayer.#selectionChangeAC === null) {
        DrawLayer.#selectionChangeAC = new AbortController();
        const {
          signal
        } = DrawLayer.#selectionChangeAC;
        document.addEventListener("selectionchange", DrawLayer.#selectionChange.bind(DrawLayer), {
          signal
        });
        document.addEventListener("pointerdown", () => {
          DrawLayer.#isSelecting = true;
        }, {
          signal
        });
        document.addEventListener("pointerup", () => {
          DrawLayer.#isSelecting = false;
        }, {
          signal
        });
        window.addEventListener("blur", () => {
          DrawLayer.#isSelecting = false;
        }, {
          signal
        });
      }
    }
  }
  setParent(parent) {
    if (!this.#parent) {
      this.#parent = parent;
      if (this.#textLayer?.isConnected && DrawLayer.#hasSelection()) {
        DrawLayer.#selectionChange();
      }
      return;
    }
    if (this.#parent !== parent) {
      if (this.#mapping.size > 0) {
        for (const root of this.#mapping.values()) {
          root.remove();
          parent.append(root);
        }
      }
      this.#parent = parent;
    }
  }
  static #cleanupTextLayerSelection(textLayer) {
    const textLayerData = this.#textLayers.get(textLayer);
    if (!textLayerData?.selectionDiv) {
      return;
    }
    textLayerData.selectionDiv.remove();
    this.#selections.delete(textLayerData.selectionDiv);
    textLayerData.selectionDiv = null;
    textLayerData.path = null;
  }
  static #hasSelection() {
    const selection = document.getSelection();
    return !!selection && !selection.isCollapsed;
  }
  static #getOrderedTextLayers() {
    return this.#textLayerSet.keys().filter(textLayer => textLayer.isConnected).toArray().sort(compareTextLayers);
  }
  static #selectionChange() {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) {
      for (const root of this.#selections) {
        root.remove();
      }
      this.#selections.clear();
      return;
    }
    const rotators = new WeakMap();
    const orderedTextLayers = this.#getOrderedTextLayers();
    const ranges = [];
    for (let i = 0, ii = selection.rangeCount; i < ii; i++) {
      const range = selection.getRangeAt(i);
      if (range.collapsed) {
        continue;
      }
      let {
        startContainer,
        startOffset,
        endContainer,
        endOffset
      } = range;
      let startTextLayer = getTextLayer(startContainer);
      let endTextLayer = getTextLayer(endContainer);
      const startMissing = startTextLayer === null;
      const endMissing = endTextLayer === null;
      if (this.#isSelecting && startMissing !== endMissing) {
        return;
      }
      if (selection.rangeCount === 1) {
        const {
          anchorNode,
          anchorOffset,
          focusNode,
          focusOffset
        } = selection;
        const anchorLayer = getTextLayer(anchorNode);
        const focusLayer = getTextLayer(focusNode);
        const anchorBeforeFocus = isPointBefore(anchorNode, anchorOffset, focusNode, focusOffset);
        if (anchorLayer && focusLayer && anchorBeforeFocus !== null) {
          if (anchorBeforeFocus) {
            startContainer = anchorNode;
            startOffset = anchorOffset;
            startTextLayer = anchorLayer;
            endContainer = focusNode;
            endOffset = focusOffset;
            endTextLayer = focusLayer;
          } else {
            startContainer = focusNode;
            startOffset = focusOffset;
            startTextLayer = focusLayer;
            endContainer = anchorNode;
            endOffset = anchorOffset;
            endTextLayer = anchorLayer;
          }
        }
      }
      const activeTextLayers = orderedTextLayers.filter(textLayer => range.intersectsNode(textLayer));
      if (activeTextLayers.length === 0) {
        continue;
      }
      let boundarySubstituted = false;
      if (!startTextLayer) {
        startTextLayer = activeTextLayers[0];
        startContainer = startTextLayer;
        startOffset = 0;
        boundarySubstituted = true;
      }
      if (!endTextLayer) {
        endTextLayer = activeTextLayers.at(-1);
        endContainer = endTextLayer;
        endOffset = endTextLayer.childNodes.length;
        boundarySubstituted = true;
      }
      if (endContainer.nodeType === Node.ELEMENT_NODE) {
        if (endContainer.classList.contains("endOfContent")) {
          const previousNode = endContainer.previousSibling;
          if (!previousNode) {
            continue;
          }
          endContainer = previousNode;
          endOffset = previousNode.nodeType === Node.TEXT_NODE ? previousNode.textContent.length : previousNode.childNodes.length;
        } else if (endContainer.classList.contains("textLayer") && endContainer.childNodes.length === endOffset) {
          const normalizedEnd = normalizeEdgeBoundary(endContainer, endOffset, endTextLayer);
          if (!normalizedEnd) {
            continue;
          }
          endContainer = normalizedEnd.container;
          endOffset = normalizedEnd.offset;
        }
      }
      if (startContainer.nodeType === Node.ELEMENT_NODE) {
        const normalizedStart = normalizeEdgeBoundary(startContainer, startOffset, startTextLayer);
        if (!normalizedStart) {
          continue;
        }
        startContainer = normalizedStart.container;
        startOffset = normalizedStart.offset;
      }
      if (startTextLayer === endTextLayer && !boundarySubstituted && activeTextLayers.includes(startTextLayer)) {
        ranges.push([range, startTextLayer]);
        continue;
      }
      for (const textLayer of activeTextLayers) {
        const firstNode = textLayer.firstChild;
        if (!firstNode) {
          continue;
        }
        const subRange = document.createRange();
        if (textLayer === startTextLayer) {
          subRange.setStart(startContainer, startOffset);
        } else {
          subRange.setStartBefore(firstNode);
        }
        if (textLayer === endTextLayer) {
          subRange.setEnd(endContainer, endOffset);
        } else {
          const lastNode = textLayer.lastChild;
          if (!lastNode) {
            continue;
          }
          if (lastNode.nodeType === Node.ELEMENT_NODE && lastNode.classList.contains("endOfContent")) {
            const lastTextNode = lastNode.previousSibling;
            if (!lastTextNode) {
              continue;
            }
            subRange.setEndAfter(lastTextNode);
          } else {
            subRange.setEndAfter(lastNode);
          }
        }
        if (!subRange.collapsed) {
          ranges.push([subRange, textLayer]);
        }
      }
    }
    const selectedTextLayers = new Set(ranges.map(range => range[1]));
    for (const textLayer of this.#textLayerSet) {
      if (!selectedTextLayers.has(textLayer)) {
        this.#cleanupTextLayerSelection(textLayer);
      }
    }
    for (const [range, textLayer] of ranges) {
      const textLayerData = DrawLayer.#textLayers.get(textLayer);
      if (!textLayerData) {
        continue;
      }
      let rotator = rotators.get(textLayer);
      if (!rotator) {
        const clientRect = textLayer.getBoundingClientRect();
        rotator = (x, y, w, h) => ({
          x: (x - clientRect.x) / clientRect.width,
          y: (y - clientRect.y) / clientRect.height,
          width: w / clientRect.width,
          height: h / clientRect.height
        });
        rotators.set(textLayer, rotator);
      }
      const boxes = [];
      for (let {
        x,
        y,
        width,
        height
      } of range.getClientRects()) {
        if (width === 0 || height === 0) {
          continue;
        }
        ({
          x,
          y,
          width,
          height
        } = rotator(x, y, width, height));
        if (width === 1 && height === 1) {
          continue;
        }
        boxes.push(`M${x} ${y} h${width} v${height} h-${width} Z`);
      }
      if (boxes.length === 0) {
        continue;
      }
      const drawLayer = textLayerData.drawLayer;
      let div = textLayerData.selectionDiv;
      let path = textLayerData.path;
      if (!div) {
        const clipPathId = `clip_selection_${DrawLayer.#selectionId++}`;
        div = document.createElement("div");
        div.className = "selection";
        div.style.clipPath = `url(#${clipPathId})`;
        const selectionStyle = drawLayer.#filterFactory?.createSelectionStyle(drawLayer.#pageColors);
        if (selectionStyle) {
          for (const [name, value] of Object.entries(selectionStyle)) {
            div.style.setProperty(name, value);
          }
        }
        const svg = DrawLayer._svgFactory.create(1, 1, true);
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        const clipPath = DrawLayer._svgFactory.createElement("clipPath");
        clipPath.setAttribute("id", clipPathId);
        clipPath.setAttribute("clipPathUnits", "objectBoundingBox");
        path = DrawLayer._svgFactory.createElement("path");
        clipPath.append(path);
        svg.append(clipPath);
        div.append(svg);
        textLayerData.path = path;
        textLayerData.selectionDiv = div;
      }
      if (drawLayer.#parent && div.parentNode !== drawLayer.#parent) {
        drawLayer.#parent.append(div);
        this.#selections.add(div);
      }
      path.setAttribute("d", boxes.join(" "));
    }
  }
  static get _svgFactory() {
    return shadow(this, "_svgFactory", new DOMSVGFactory());
  }
  static #setBox(element, [x, y, width, height]) {
    const {
      style
    } = element;
    style.top = `${100 * y}%`;
    style.left = `${100 * x}%`;
    style.width = `${100 * width}%`;
    style.height = `${100 * height}%`;
  }
  #createSVG() {
    const svg = DrawLayer._svgFactory.create(1, 1, true);
    this.#parent.append(svg);
    svg.setAttribute("aria-hidden", "true");
    return svg;
  }
  #createClipPath(defs, pathId) {
    const clipPath = DrawLayer._svgFactory.createElement("clipPath");
    defs.append(clipPath);
    const clipPathId = `clip_${pathId}`;
    clipPath.setAttribute("id", clipPathId);
    clipPath.setAttribute("clipPathUnits", "objectBoundingBox");
    const clipPathUse = DrawLayer._svgFactory.createElement("use");
    clipPath.append(clipPathUse);
    clipPathUse.setAttribute("href", `#${pathId}`);
    clipPathUse.classList.add("clip");
    return clipPathId;
  }
  #updateProperties(element, properties) {
    for (const [key, value] of Object.entries(properties)) {
      if (value === null) {
        element.removeAttribute(key);
      } else {
        element.setAttribute(key, value);
      }
    }
  }
  draw(properties, isPathUpdatable = false, hasClip = false) {
    const id = DrawLayer.#id++;
    const root = this.#createSVG();
    const defs = DrawLayer._svgFactory.createElement("defs");
    root.append(defs);
    const path = DrawLayer._svgFactory.createElement("path");
    defs.append(path);
    const pathId = `path_${id}`;
    path.setAttribute("id", pathId);
    path.setAttribute("vector-effect", "non-scaling-stroke");
    if (isPathUpdatable) {
      this.#toUpdate.set(id, path);
    }
    const clipPathId = hasClip ? this.#createClipPath(defs, pathId) : null;
    const use = DrawLayer._svgFactory.createElement("use");
    root.append(use);
    use.setAttribute("href", `#${pathId}`);
    this.updateProperties(root, properties);
    this.#mapping.set(id, root);
    return {
      id,
      clipPathId: `url(#${clipPathId})`
    };
  }
  drawOutline(properties, mustRemoveSelfIntersections) {
    const id = DrawLayer.#id++;
    const root = this.#createSVG();
    const defs = DrawLayer._svgFactory.createElement("defs");
    root.append(defs);
    const path = DrawLayer._svgFactory.createElement("path");
    defs.append(path);
    const pathId = `path_${id}`;
    path.setAttribute("id", pathId);
    path.setAttribute("vector-effect", "non-scaling-stroke");
    let maskId;
    if (mustRemoveSelfIntersections) {
      const mask = DrawLayer._svgFactory.createElement("mask");
      defs.append(mask);
      maskId = `mask_${id}`;
      mask.setAttribute("id", maskId);
      mask.setAttribute("maskUnits", "objectBoundingBox");
      const rect = DrawLayer._svgFactory.createElement("rect");
      mask.append(rect);
      rect.setAttribute("width", "1");
      rect.setAttribute("height", "1");
      rect.setAttribute("fill", "white");
      const use = DrawLayer._svgFactory.createElement("use");
      mask.append(use);
      use.setAttribute("href", `#${pathId}`);
      use.setAttribute("stroke", "none");
      use.setAttribute("fill", "black");
      use.setAttribute("fill-rule", "nonzero");
      use.classList.add("mask");
    }
    const use1 = DrawLayer._svgFactory.createElement("use");
    root.append(use1);
    use1.setAttribute("href", `#${pathId}`);
    if (maskId) {
      use1.setAttribute("mask", `url(#${maskId})`);
    }
    const use2 = use1.cloneNode();
    root.append(use2);
    use1.classList.add("mainOutline");
    use2.classList.add("secondaryOutline");
    this.updateProperties(root, properties);
    this.#mapping.set(id, root);
    return id;
  }
  finalizeDraw(id, properties) {
    this.#toUpdate.delete(id);
    this.updateProperties(id, properties);
  }
  updateProperties(elementOrId, properties) {
    if (!properties) {
      return;
    }
    const {
      root,
      bbox,
      rootClass,
      path
    } = properties;
    const element = typeof elementOrId === "number" ? this.#mapping.get(elementOrId) : elementOrId;
    if (!element) {
      return;
    }
    if (root) {
      this.#updateProperties(element, root);
    }
    if (bbox) {
      DrawLayer.#setBox(element, bbox);
    }
    if (rootClass) {
      const {
        classList
      } = element;
      for (const [className, value] of Object.entries(rootClass)) {
        classList.toggle(className, value);
      }
    }
    if (path) {
      const defs = element.firstElementChild;
      const pathElement = defs.firstElementChild;
      this.#updateProperties(pathElement, path);
    }
  }
  updateParent(id, layer) {
    if (layer === this) {
      return;
    }
    const root = this.#mapping.get(id);
    if (!root) {
      return;
    }
    layer.#parent.append(root);
    this.#mapping.delete(id);
    layer.#mapping.set(id, root);
  }
  remove(id) {
    this.#toUpdate.delete(id);
    if (this.#parent === null) {
      return;
    }
    this.#mapping.get(id).remove();
    this.#mapping.delete(id);
  }
  destroy() {
    this.#parent = null;
    for (const root of this.#mapping.values()) {
      root.remove();
    }
    this.#mapping.clear();
    this.#toUpdate.clear();
    this.#textLayerObserver?.disconnect();
    this.#textLayerObserver = null;
    if (this.#textLayer) {
      const data = DrawLayer.#textLayers.get(this.#textLayer);
      if (data?.drawLayer === this) {
        DrawLayer.#cleanupTextLayerSelection(this.#textLayer);
        DrawLayer.#textLayers.delete(this.#textLayer);
        DrawLayer.#textLayerSet.delete(this.#textLayer);
        if (DrawLayer.#textLayerSet.size === 0) {
          DrawLayer.#selectionChangeAC?.abort();
          DrawLayer.#selectionChangeAC = null;
          DrawLayer.#isSelecting = false;
        }
      }
      this.#textLayer = null;
    }
  }
}
export { DrawLayer };