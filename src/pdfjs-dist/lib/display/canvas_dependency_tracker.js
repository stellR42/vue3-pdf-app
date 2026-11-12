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
import "core-js/modules/es.iterator.for-each.js";
import "core-js/modules/es.iterator.take.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import "core-js/modules/es.typed-array.with.js";
import "core-js/modules/es.uint8-array.set-from-base64.js";
import "core-js/modules/es.uint8-array.set-from-hex.js";
import "core-js/modules/es.uint8-array.to-base64.js";
import "core-js/modules/es.uint8-array.to-hex.js";
import { BBOX_INIT, FeatureTest, Util } from "../shared/util.js";
import { getCurrentTransform } from "./display_utils.js";
import { MathClamp } from "../shared/math_clamp.js";
const FORCED_DEPENDENCY_LABEL = "__forcedDependency";
const {
  floor,
  ceil
} = Math;
function expandBBox(array, index, minX, minY, maxX, maxY) {
  array[index * 4 + 0] = Math.min(array[index * 4 + 0], minX);
  array[index * 4 + 1] = Math.min(array[index * 4 + 1], minY);
  array[index * 4 + 2] = Math.max(array[index * 4 + 2], maxX);
  array[index * 4 + 3] = Math.max(array[index * 4 + 3], maxY);
}
function scaleCharBBox(scaleX, scaleY, x, y, bbox) {
  let temp;
  if (scaleX) {
    if (scaleX < 0) {
      temp = bbox[0];
      bbox[0] = bbox[2];
      bbox[2] = temp;
    }
    bbox[0] *= scaleX;
    bbox[2] *= scaleX;
    if (scaleY < 0) {
      temp = bbox[1];
      bbox[1] = bbox[3];
      bbox[3] = temp;
    }
    bbox[1] *= scaleY;
    bbox[3] *= scaleY;
  } else {
    bbox.fill(0);
  }
  bbox[0] += x;
  bbox[1] += y;
  bbox[2] += x;
  bbox[3] += y;
}
const EMPTY_BBOX = new Uint32Array(new Uint8Array([255, 255, 0, 0]).buffer)[0];
class BBoxReader {
  #bboxes;
  #coords;
  constructor(bboxes, coords) {
    this.#bboxes = bboxes;
    this.#coords = coords;
  }
  static fromBuffer(buffer) {
    return new BBoxReader(new Uint32Array(buffer), new Uint8ClampedArray(buffer));
  }
  get buffer() {
    return this.#bboxes.buffer;
  }
  get length() {
    return this.#bboxes.length;
  }
  isEmpty(i) {
    return this.#bboxes[i] === EMPTY_BBOX;
  }
  minX(i) {
    return this.#coords[i * 4 + 0] / 256;
  }
  minY(i) {
    return this.#coords[i * 4 + 1] / 256;
  }
  maxX(i) {
    return (this.#coords[i * 4 + 2] + 1) / 256;
  }
  maxY(i) {
    return (this.#coords[i * 4 + 3] + 1) / 256;
  }
}
const ensureDebugMetadata = (map, key) => map?.getOrInsertComputed(key, () => ({
  dependencies: new Set(),
  isRenderingOperation: false
}));
class CanvasBBoxTracker {
  #baseTransformStack = [[1, 0, 0, 1, 0, 0]];
  #clipBox = [-Infinity, -Infinity, Infinity, Infinity];
  #pendingBBox = new Float64Array(BBOX_INIT);
  _pendingBBoxIdx = -1;
  #canvasWidth;
  #canvasHeight;
  #bboxesCoords;
  #bboxes;
  _savesStack = [];
  _markedContentStack = [];
  constructor(canvas, operationsCount) {
    this.#canvasWidth = canvas.width;
    this.#canvasHeight = canvas.height;
    this.#initializeBBoxes(operationsCount);
  }
  growOperationsCount(operationsCount) {
    if (operationsCount >= this.#bboxes.length) {
      this.#initializeBBoxes(operationsCount, this.#bboxes);
    }
  }
  #initializeBBoxes(operationsCount, oldBBoxes) {
    const buffer = new ArrayBuffer(operationsCount * 4);
    this.#bboxesCoords = new Uint8ClampedArray(buffer);
    this.#bboxes = new Uint32Array(buffer);
    if (oldBBoxes && oldBBoxes.length > 0) {
      this.#bboxes.set(oldBBoxes);
      this.#bboxes.fill(EMPTY_BBOX, oldBBoxes.length);
    } else {
      this.#bboxes.fill(EMPTY_BBOX);
    }
  }
  get clipBox() {
    return this.#clipBox;
  }
  save(opIdx) {
    this.#clipBox = {
      __proto__: this.#clipBox
    };
    this._savesStack.push(opIdx);
    return this;
  }
  restore(opIdx, onSavePopped) {
    const previous = Object.getPrototypeOf(this.#clipBox);
    if (previous === null) {
      return this;
    }
    this.#clipBox = previous;
    const lastSave = this._savesStack.pop();
    if (lastSave !== undefined) {
      onSavePopped?.(lastSave, opIdx);
      this.#bboxes[opIdx] = this.#bboxes[lastSave];
    }
    return this;
  }
  recordOpenMarker(idx) {
    this._savesStack.push(idx);
    return this;
  }
  getOpenMarker() {
    return this._savesStack.length === 0 ? null : this._savesStack.at(-1);
  }
  recordCloseMarker(opIdx, onSavePopped) {
    const lastSave = this._savesStack.pop();
    if (lastSave !== undefined) {
      onSavePopped?.(lastSave, opIdx);
      this.#bboxes[opIdx] = this.#bboxes[lastSave];
    }
    return this;
  }
  beginMarkedContent(opIdx) {
    this._markedContentStack.push(opIdx);
    return this;
  }
  endMarkedContent(opIdx, onSavePopped) {
    const lastSave = this._markedContentStack.pop();
    if (lastSave !== undefined) {
      onSavePopped?.(lastSave, opIdx);
      this.#bboxes[opIdx] = this.#bboxes[lastSave];
    }
    return this;
  }
  pushBaseTransform(ctx) {
    this.#baseTransformStack.push(Util.multiplyByDOMMatrix(this.#baseTransformStack.at(-1), ctx.getTransform()));
    return this;
  }
  popBaseTransform() {
    if (this.#baseTransformStack.length > 1) {
      this.#baseTransformStack.pop();
    }
    return this;
  }
  resetBBox(idx) {
    if (this._pendingBBoxIdx !== idx) {
      this._pendingBBoxIdx = idx;
      this.#pendingBBox.set(BBOX_INIT, 0);
    }
    return this;
  }
  recordClipBox(idx, ctx, minX, maxX, minY, maxY) {
    const transform = Util.multiplyByDOMMatrix(this.#baseTransformStack.at(-1), ctx.getTransform());
    const clipBox = BBOX_INIT.slice();
    Util.axialAlignedBoundingBox([minX, minY, maxX, maxY], transform, clipBox);
    const intersection = Util.intersect(this.#clipBox, clipBox);
    if (intersection) {
      this.#clipBox[0] = intersection[0];
      this.#clipBox[1] = intersection[1];
      this.#clipBox[2] = intersection[2];
      this.#clipBox[3] = intersection[3];
    } else {
      this.#clipBox[0] = this.#clipBox[1] = Infinity;
      this.#clipBox[2] = this.#clipBox[3] = -Infinity;
    }
    return this;
  }
  recordBBox(idx, ctx, minX, maxX, minY, maxY) {
    const clipBox = this.#clipBox;
    if (clipBox[0] === Infinity) {
      return this;
    }
    const transform = Util.multiplyByDOMMatrix(this.#baseTransformStack.at(-1), ctx.getTransform());
    if (clipBox[0] === -Infinity) {
      Util.axialAlignedBoundingBox([minX, minY, maxX, maxY], transform, this.#pendingBBox);
      return this;
    }
    const bbox = BBOX_INIT.slice();
    Util.axialAlignedBoundingBox([minX, minY, maxX, maxY], transform, bbox);
    this.#pendingBBox[0] = MathClamp(bbox[0], clipBox[0], this.#pendingBBox[0]);
    this.#pendingBBox[1] = MathClamp(bbox[1], clipBox[1], this.#pendingBBox[1]);
    this.#pendingBBox[2] = MathClamp(bbox[2], this.#pendingBBox[2], clipBox[2]);
    this.#pendingBBox[3] = MathClamp(bbox[3], this.#pendingBBox[3], clipBox[3]);
    return this;
  }
  recordFullPageBBox(idx) {
    this.#pendingBBox[0] = Math.max(0, this.#clipBox[0]);
    this.#pendingBBox[1] = Math.max(0, this.#clipBox[1]);
    this.#pendingBBox[2] = Math.min(this.#canvasWidth, this.#clipBox[2]);
    this.#pendingBBox[3] = Math.min(this.#canvasHeight, this.#clipBox[3]);
    return this;
  }
  recordOperation(idx, preserve = false, dependencyLists) {
    if (this._pendingBBoxIdx !== idx) {
      return this;
    }
    const minX = floor(this.#pendingBBox[0] * 256 / this.#canvasWidth);
    const minY = floor(this.#pendingBBox[1] * 256 / this.#canvasHeight);
    const maxX = ceil(this.#pendingBBox[2] * 256 / this.#canvasWidth);
    const maxY = ceil(this.#pendingBBox[3] * 256 / this.#canvasHeight);
    expandBBox(this.#bboxesCoords, idx, minX, minY, maxX, maxY);
    if (dependencyLists) {
      for (const dependencies of dependencyLists) {
        for (const depIdx of dependencies) {
          if (depIdx !== idx) {
            expandBBox(this.#bboxesCoords, depIdx, minX, minY, maxX, maxY);
          }
        }
      }
    }
    if (!preserve) {
      this._pendingBBoxIdx = -1;
    }
    return this;
  }
  bboxToClipBoxDropOperation(idx) {
    if (this._pendingBBoxIdx === idx) {
      this._pendingBBoxIdx = -1;
      this.#clipBox[0] = Math.max(this.#clipBox[0], this.#pendingBBox[0]);
      this.#clipBox[1] = Math.max(this.#clipBox[1], this.#pendingBBox[1]);
      this.#clipBox[2] = Math.min(this.#clipBox[2], this.#pendingBBox[2]);
      this.#clipBox[3] = Math.min(this.#clipBox[3], this.#pendingBBox[3]);
    }
    return this;
  }
  take() {
    return new BBoxReader(this.#bboxes, this.#bboxesCoords);
  }
  takeDebugMetadata() {
    throw new Error("Unreachable");
  }
  recordSimpleData(name, idx) {
    return this;
  }
  recordIncrementalData(name, idx) {
    return this;
  }
  resetIncrementalData(name, idx) {
    return this;
  }
  recordNamedData(name, idx) {
    return this;
  }
  recordSimpleDataFromNamed(name, depName, fallbackIdx) {
    return this;
  }
  recordFutureForcedDependency(name, idx) {
    return this;
  }
  inheritSimpleDataAsFutureForcedDependencies(names) {
    return this;
  }
  inheritPendingDependenciesAsFutureForcedDependencies() {
    return this;
  }
  recordCharacterBBox(idx, ctx, font, scale = 1, x = 0, y = 0, getMeasure) {
    return this;
  }
  getSimpleIndex(dependencyName) {
    return undefined;
  }
  recordDependencies(idx, dependencyNames) {
    return this;
  }
  recordNamedDependency(idx, name) {
    return this;
  }
  recordShowTextOperation(idx, preserve = false) {
    return this;
  }
}
class CanvasDependencyTracker {
  #simple = {
    __proto__: null
  };
  #incremental = {
    __proto__: null,
    transform: [],
    moveText: [],
    sameLineText: [],
    [FORCED_DEPENDENCY_LABEL]: []
  };
  #namedDependencies = new Map();
  #pendingDependencies = new Set();
  #fontBBoxTrustworthy = new Map();
  #debugMetadata;
  #recordDebugMetadataDepenencyAfterRestore;
  #bboxTracker;
  constructor(bboxTracker, recordDebugMetadata = false) {
    this.#bboxTracker = bboxTracker;
    if (recordDebugMetadata) {
      this.#debugMetadata = new Map();
      this.#recordDebugMetadataDepenencyAfterRestore = (lastSave, opIdx) => {
        ensureDebugMetadata(this.#debugMetadata, opIdx).dependencies.add(lastSave);
      };
    }
  }
  get clipBox() {
    return this.#bboxTracker.clipBox;
  }
  growOperationsCount(operationsCount) {
    this.#bboxTracker.growOperationsCount(operationsCount);
  }
  save(opIdx) {
    this.#simple = {
      __proto__: this.#simple
    };
    this.#incremental = {
      __proto__: this.#incremental,
      transform: {
        __proto__: this.#incremental.transform
      },
      moveText: {
        __proto__: this.#incremental.moveText
      },
      sameLineText: {
        __proto__: this.#incremental.sameLineText
      },
      [FORCED_DEPENDENCY_LABEL]: {
        __proto__: this.#incremental[FORCED_DEPENDENCY_LABEL]
      }
    };
    this.#bboxTracker.save(opIdx);
    return this;
  }
  restore(opIdx) {
    this.#bboxTracker.restore(opIdx, this.#recordDebugMetadataDepenencyAfterRestore);
    const previous = Object.getPrototypeOf(this.#simple);
    if (previous === null) {
      return this;
    }
    this.#simple = previous;
    this.#incremental = Object.getPrototypeOf(this.#incremental);
    return this;
  }
  recordOpenMarker(opIdx) {
    this.#bboxTracker.recordOpenMarker(opIdx, this.#recordDebugMetadataDepenencyAfterRestore);
    return this;
  }
  getOpenMarker() {
    return this.#bboxTracker.getOpenMarker();
  }
  recordCloseMarker(opIdx) {
    this.#bboxTracker.recordCloseMarker(opIdx, this.#recordDebugMetadataDepenencyAfterRestore);
    return this;
  }
  beginMarkedContent(opIdx) {
    this.#bboxTracker.beginMarkedContent(opIdx);
    return this;
  }
  endMarkedContent(opIdx) {
    this.#bboxTracker.endMarkedContent(opIdx, this.#recordDebugMetadataDepenencyAfterRestore);
    return this;
  }
  pushBaseTransform(ctx) {
    this.#bboxTracker.pushBaseTransform(ctx);
    return this;
  }
  popBaseTransform() {
    this.#bboxTracker.popBaseTransform();
    return this;
  }
  recordSimpleData(name, idx) {
    this.#simple[name] = idx;
    return this;
  }
  recordIncrementalData(name, idx) {
    this.#incremental[name].push(idx);
    return this;
  }
  resetIncrementalData(name, idx) {
    this.#incremental[name].length = 0;
    return this;
  }
  recordNamedData(name, idx) {
    this.#namedDependencies.set(name, idx);
    return this;
  }
  recordSimpleDataFromNamed(name, depName, fallbackIdx) {
    this.#simple[name] = this.#namedDependencies.get(depName) ?? fallbackIdx;
  }
  recordFutureForcedDependency(name, idx) {
    this.recordIncrementalData(FORCED_DEPENDENCY_LABEL, idx);
    return this;
  }
  inheritSimpleDataAsFutureForcedDependencies(names) {
    for (const name of names) {
      if (name in this.#simple) {
        this.recordFutureForcedDependency(name, this.#simple[name]);
      }
    }
    return this;
  }
  inheritPendingDependenciesAsFutureForcedDependencies() {
    for (const dep of this.#pendingDependencies) {
      this.recordFutureForcedDependency(FORCED_DEPENDENCY_LABEL, dep);
    }
    return this;
  }
  resetBBox(idx) {
    this.#bboxTracker.resetBBox(idx);
    return this;
  }
  recordClipBox(idx, ctx, minX, maxX, minY, maxY) {
    this.#bboxTracker.recordClipBox(idx, ctx, minX, maxX, minY, maxY);
    return this;
  }
  recordBBox(idx, ctx, minX, maxX, minY, maxY) {
    this.#bboxTracker.recordBBox(idx, ctx, minX, maxX, minY, maxY);
    return this;
  }
  recordCharacterBBox(idx, ctx, font, scale = 1, x = 0, y = 0, getMeasure) {
    const fontBBox = font.bbox;
    let isBBoxTrustworthy;
    let computedBBox;
    if (fontBBox) {
      isBBoxTrustworthy = fontBBox[2] !== fontBBox[0] && fontBBox[3] !== fontBBox[1] && this.#fontBBoxTrustworthy.get(font);
      if (isBBoxTrustworthy !== false) {
        computedBBox = [0, 0, 0, 0];
        Util.axialAlignedBoundingBox(fontBBox, font.fontMatrix, computedBBox);
        if (scale !== 1 || x !== 0 || y !== 0) {
          scaleCharBBox(scale, -scale, x, y, computedBBox);
        }
        if (isBBoxTrustworthy) {
          return this.recordBBox(idx, ctx, computedBBox[0], computedBBox[2], computedBBox[1], computedBBox[3]);
        }
      }
    }
    if (!getMeasure) {
      return this.recordFullPageBBox(idx);
    }
    const measure = getMeasure();
    if (fontBBox && computedBBox && isBBoxTrustworthy === undefined) {
      isBBoxTrustworthy = computedBBox[0] <= x - measure.actualBoundingBoxLeft && computedBBox[2] >= x + measure.actualBoundingBoxRight && computedBBox[1] <= y - measure.actualBoundingBoxAscent && computedBBox[3] >= y + measure.actualBoundingBoxDescent;
      this.#fontBBoxTrustworthy.set(font, isBBoxTrustworthy);
      if (isBBoxTrustworthy) {
        return this.recordBBox(idx, ctx, computedBBox[0], computedBBox[2], computedBBox[1], computedBBox[3]);
      }
    }
    return this.recordBBox(idx, ctx, x - measure.actualBoundingBoxLeft, x + measure.actualBoundingBoxRight, y - measure.actualBoundingBoxAscent, y + measure.actualBoundingBoxDescent);
  }
  recordFullPageBBox(idx) {
    this.#bboxTracker.recordFullPageBBox(idx);
    return this;
  }
  getSimpleIndex(dependencyName) {
    return this.#simple[dependencyName];
  }
  recordDependencies(idx, dependencyNames) {
    const pendingDependencies = this.#pendingDependencies;
    const simple = this.#simple;
    const incremental = this.#incremental;
    for (const name of dependencyNames) {
      if (name in this.#simple) {
        pendingDependencies.add(simple[name]);
      } else if (name in incremental) {
        incremental[name].forEach(pendingDependencies.add, pendingDependencies);
      }
    }
    return this;
  }
  recordNamedDependency(idx, name) {
    if (this.#namedDependencies.has(name)) {
      this.#pendingDependencies.add(this.#namedDependencies.get(name));
    }
    return this;
  }
  recordOperation(idx, preserve = false) {
    this.recordDependencies(idx, [FORCED_DEPENDENCY_LABEL]);
    if (this.#debugMetadata) {
      const metadata = ensureDebugMetadata(this.#debugMetadata, idx);
      const {
        dependencies
      } = metadata;
      this.#pendingDependencies.forEach(dependencies.add, dependencies);
      this.#bboxTracker._savesStack.forEach(dependencies.add, dependencies);
      this.#bboxTracker._markedContentStack.forEach(dependencies.add, dependencies);
      dependencies.delete(idx);
      metadata.isRenderingOperation = true;
    }
    const needsCleanup = !preserve && idx === this.#bboxTracker._pendingBBoxIdx;
    this.#bboxTracker.recordOperation(idx, preserve, [this.#pendingDependencies, this.#bboxTracker._savesStack, this.#bboxTracker._markedContentStack]);
    if (needsCleanup) {
      this.#pendingDependencies.clear();
    }
    return this;
  }
  recordShowTextOperation(idx, preserve = false) {
    const deps = Array.from(this.#pendingDependencies);
    this.recordOperation(idx, preserve);
    this.recordIncrementalData("sameLineText", idx);
    for (const dep of deps) {
      this.recordIncrementalData("sameLineText", dep);
    }
    return this;
  }
  bboxToClipBoxDropOperation(idx, preserve = false) {
    const needsCleanup = !preserve && idx === this.#bboxTracker._pendingBBoxIdx;
    this.#bboxTracker.bboxToClipBoxDropOperation(idx);
    if (needsCleanup) {
      this.#pendingDependencies.clear();
    }
    return this;
  }
  take() {
    this.#fontBBoxTrustworthy.clear();
    return this.#bboxTracker.take();
  }
  takeDebugMetadata() {
    return this.#debugMetadata;
  }
}
class CanvasNestedDependencyTracker {
  #dependencyTracker;
  #opIdx;
  #ignoreBBoxes;
  #nestingLevel = 0;
  #savesLevel = 0;
  constructor(dependencyTracker, opIdx, ignoreBBoxes) {
    if (dependencyTracker instanceof CanvasNestedDependencyTracker && dependencyTracker.#ignoreBBoxes === !!ignoreBBoxes) {
      return dependencyTracker;
    }
    this.#dependencyTracker = dependencyTracker;
    this.#opIdx = opIdx;
    this.#ignoreBBoxes = !!ignoreBBoxes;
  }
  get clipBox() {
    return this.#dependencyTracker.clipBox;
  }
  growOperationsCount() {
    throw new Error("Unreachable");
  }
  save(opIdx) {
    this.#savesLevel++;
    this.#dependencyTracker.save(this.#opIdx);
    return this;
  }
  restore(opIdx) {
    if (this.#savesLevel > 0) {
      this.#dependencyTracker.restore(this.#opIdx);
      this.#savesLevel--;
    }
    return this;
  }
  recordOpenMarker(idx) {
    this.#nestingLevel++;
    return this;
  }
  getOpenMarker() {
    return this.#nestingLevel > 0 ? this.#opIdx : this.#dependencyTracker.getOpenMarker();
  }
  recordCloseMarker(idx) {
    this.#nestingLevel--;
    return this;
  }
  beginMarkedContent(opIdx) {
    return this;
  }
  endMarkedContent(opIdx) {
    return this;
  }
  pushBaseTransform(ctx) {
    this.#dependencyTracker.pushBaseTransform(ctx);
    return this;
  }
  popBaseTransform() {
    this.#dependencyTracker.popBaseTransform();
    return this;
  }
  recordSimpleData(name, idx) {
    this.#dependencyTracker.recordSimpleData(name, this.#opIdx);
    return this;
  }
  recordIncrementalData(name, idx) {
    this.#dependencyTracker.recordIncrementalData(name, this.#opIdx);
    return this;
  }
  resetIncrementalData(name, idx) {
    this.#dependencyTracker.resetIncrementalData(name, this.#opIdx);
    return this;
  }
  recordNamedData(name, idx) {
    return this;
  }
  recordSimpleDataFromNamed(name, depName, fallbackIdx) {
    this.#dependencyTracker.recordSimpleDataFromNamed(name, depName, this.#opIdx);
    return this;
  }
  recordFutureForcedDependency(name, idx) {
    this.#dependencyTracker.recordFutureForcedDependency(name, this.#opIdx);
    return this;
  }
  inheritSimpleDataAsFutureForcedDependencies(names) {
    this.#dependencyTracker.inheritSimpleDataAsFutureForcedDependencies(names);
    return this;
  }
  inheritPendingDependenciesAsFutureForcedDependencies() {
    this.#dependencyTracker.inheritPendingDependenciesAsFutureForcedDependencies();
    return this;
  }
  resetBBox(idx) {
    if (!this.#ignoreBBoxes) {
      this.#dependencyTracker.resetBBox(this.#opIdx);
    }
    return this;
  }
  recordClipBox(idx, ctx, minX, maxX, minY, maxY) {
    if (!this.#ignoreBBoxes) {
      this.#dependencyTracker.recordClipBox(this.#opIdx, ctx, minX, maxX, minY, maxY);
    }
    return this;
  }
  recordBBox(idx, ctx, minX, maxX, minY, maxY) {
    if (!this.#ignoreBBoxes) {
      this.#dependencyTracker.recordBBox(this.#opIdx, ctx, minX, maxX, minY, maxY);
    }
    return this;
  }
  recordCharacterBBox(idx, ctx, font, scale, x, y, getMeasure) {
    if (!this.#ignoreBBoxes) {
      this.#dependencyTracker.recordCharacterBBox(this.#opIdx, ctx, font, scale, x, y, getMeasure);
    }
    return this;
  }
  recordFullPageBBox(idx) {
    if (!this.#ignoreBBoxes) {
      this.#dependencyTracker.recordFullPageBBox(this.#opIdx);
    }
    return this;
  }
  getSimpleIndex(dependencyName) {
    return this.#dependencyTracker.getSimpleIndex(dependencyName);
  }
  recordDependencies(idx, dependencyNames) {
    this.#dependencyTracker.recordDependencies(this.#opIdx, dependencyNames);
    return this;
  }
  recordNamedDependency(idx, name) {
    this.#dependencyTracker.recordNamedDependency(this.#opIdx, name);
    return this;
  }
  recordOperation(idx) {
    this.#dependencyTracker.recordOperation(this.#opIdx, true);
    return this;
  }
  recordShowTextOperation(idx) {
    this.#dependencyTracker.recordShowTextOperation(this.#opIdx, true);
    return this;
  }
  bboxToClipBoxDropOperation(idx) {
    if (!this.#ignoreBBoxes) {
      this.#dependencyTracker.bboxToClipBoxDropOperation(this.#opIdx, true);
    }
    return this;
  }
  take() {
    throw new Error("Unreachable");
  }
  takeDebugMetadata() {
    throw new Error("Unreachable");
  }
}
const Dependencies = {
  stroke: ["path", "transform", "filter", "strokeColor", "strokeAlpha", "lineWidth", "lineCap", "lineJoin", "miterLimit", "dash"],
  fill: ["path", "transform", "filter", "fillColor", "fillAlpha", "globalCompositeOperation", "SMask"],
  imageXObject: ["transform", "SMask", "filter", "fillAlpha", "strokeAlpha", "globalCompositeOperation"],
  rawFillPath: ["filter", "fillColor", "fillAlpha"],
  showText: ["transform", "leading", "charSpacing", "wordSpacing", "hScale", "textRise", "moveText", "textMatrix", "font", "fontObj", "filter", "fillColor", "textRenderingMode", "SMask", "fillAlpha", "strokeAlpha", "globalCompositeOperation", "sameLineText"],
  transform: ["transform"],
  transformAndFill: ["transform", "filter", "fillColor"]
};
class CanvasImagesTracker {
  #canvasWidth;
  #canvasHeight;
  #capacity = 4;
  #count = 0;
  #coords = new CanvasImagesTracker.#CoordsArray(this.#capacity * 6);
  static #CoordsArray = FeatureTest.isFloat16ArraySupported ? Float16Array : Float32Array;
  constructor(canvas) {
    this.#canvasWidth = canvas.width;
    this.#canvasHeight = canvas.height;
  }
  record(ctx, width, height, clipBox) {
    if (this.#count === this.#capacity) {
      this.#capacity *= 2;
      const newCoords = new CanvasImagesTracker.#CoordsArray(this.#capacity * 6);
      newCoords.set(this.#coords);
      this.#coords = newCoords;
    }
    const transform = getCurrentTransform(ctx);
    let coords;
    if (clipBox[0] !== Infinity) {
      const bbox = BBOX_INIT.slice();
      Util.axialAlignedBoundingBox([0, -height, width, 0], transform, bbox);
      const finalBBox = Util.intersect(clipBox, bbox);
      if (!finalBBox) {
        return;
      }
      const [minX, minY, maxX, maxY] = finalBBox;
      if (minX !== bbox[0] || minY !== bbox[1] || maxX !== bbox[2] || maxY !== bbox[3]) {
        const rotationAngle = Math.atan2(transform[1], transform[0]);
        const sin = Math.abs(Math.sin(rotationAngle));
        const cos = Math.abs(Math.cos(rotationAngle));
        if (sin < 1e-6 || cos < 1e-6 || Math.abs(sin - cos) < 1e-6) {
          coords = [minX, minY, minX, maxY, maxX, minY];
        } else {
          const finalBBoxWidth = maxX - minX;
          const finalBBoxHeight = maxY - minY;
          const sin2 = sin * sin;
          const cos2 = cos * cos;
          const cosSin = cos * sin;
          const denom = cos2 - sin2;
          const a = (finalBBoxHeight * cos2 - finalBBoxWidth * cosSin) / denom;
          const b = (finalBBoxHeight * cosSin - finalBBoxWidth * sin2) / denom;
          coords = [minX + b, minY, minX, minY + a, maxX, maxY - a];
        }
      }
    }
    if (!coords) {
      coords = [0, -height, 0, 0, width, -height];
      Util.applyTransform(coords, transform, 0);
      Util.applyTransform(coords, transform, 2);
      Util.applyTransform(coords, transform, 4);
    }
    coords[0] /= this.#canvasWidth;
    coords[1] /= this.#canvasHeight;
    coords[2] /= this.#canvasWidth;
    coords[3] /= this.#canvasHeight;
    coords[4] /= this.#canvasWidth;
    coords[5] /= this.#canvasHeight;
    this.#coords.set(coords, this.#count * 6);
    this.#count++;
  }
  take() {
    return this.#coords.subarray(0, this.#count * 6);
  }
}
function createCanvasTrackers(canvas, operationsCount, {
  recordOperations = false,
  recordImages = false,
  recordDebugMetadata = false
}) {
  const bboxTracker = recordOperations || recordImages ? new CanvasBBoxTracker(canvas, operationsCount) : null;
  return {
    dependencyTracker: recordOperations ? new CanvasDependencyTracker(bboxTracker, recordDebugMetadata) : bboxTracker,
    imagesTracker: recordImages ? new CanvasImagesTracker(canvas) : null
  };
}
export { BBoxReader, CanvasBBoxTracker, CanvasDependencyTracker, CanvasImagesTracker, CanvasNestedDependencyTracker, createCanvasTrackers, Dependencies };