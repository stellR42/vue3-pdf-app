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
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import "core-js/modules/es.typed-array.with.js";
import { BBOX_INIT, Util } from "../../../shared/util.js";
import { FreeDrawOutline, FreeDrawOutliner } from "./freedraw.js";
import { Outline } from "./outline.js";
function getHighlightSVGProperties(outline) {
  return {
    bbox: outline.box,
    root: {
      viewBox: "0 0 1 1"
    },
    rootClass: {
      highlight: true,
      free: outline.isFree
    },
    path: {
      d: outline.toSVGPath()
    }
  };
}
function getHighlightFocusSVGProperties(outline, rotation) {
  const {
    focusOutline
  } = outline;
  return {
    bbox: Outline._rotateBox(focusOutline.box, rotation),
    root: {
      "data-main-rotation": rotation
    },
    rootClass: {
      highlightOutline: true,
      free: outline.isFree
    },
    path: {
      d: focusOutline.toSVGPath()
    }
  };
}
class HighlightOutliner {
  #box;
  #firstPoint;
  #lastPoint;
  #verticalEdges = [];
  #intervals = [];
  constructor(boxes, borderWidth = 0, innerMargin = 0, isLTR = true) {
    const minMax = BBOX_INIT.slice();
    const NUMBER_OF_DIGITS = 4;
    const EPSILON = 10 ** -NUMBER_OF_DIGITS;
    for (const {
      x,
      y,
      width,
      height
    } of boxes) {
      const x1 = Math.floor((x - borderWidth) / EPSILON) * EPSILON;
      const x2 = Math.ceil((x + width + borderWidth) / EPSILON) * EPSILON;
      const y1 = Math.floor((y - borderWidth) / EPSILON) * EPSILON;
      const y2 = Math.ceil((y + height + borderWidth) / EPSILON) * EPSILON;
      const left = [x1, y1, y2, true];
      const right = [x2, y1, y2, false];
      this.#verticalEdges.push(left, right);
      Util.rectBoundingBox(x1, y1, x2, y2, minMax);
    }
    const bboxWidth = minMax[2] - minMax[0] + 2 * innerMargin;
    const bboxHeight = minMax[3] - minMax[1] + 2 * innerMargin;
    const shiftedMinX = minMax[0] - innerMargin;
    const shiftedMinY = minMax[1] - innerMargin;
    let firstPointX = isLTR ? -Infinity : Infinity;
    let firstPointY = Infinity;
    const lastEdge = this.#verticalEdges.at(isLTR ? -1 : -2);
    const lastPoint = [lastEdge[0], lastEdge[2]];
    for (const edge of this.#verticalEdges) {
      const [x, y1, y2, left] = edge;
      if (!left && isLTR) {
        if (y1 < firstPointY) {
          firstPointY = y1;
          firstPointX = x;
        } else if (y1 === firstPointY) {
          firstPointX = Math.max(firstPointX, x);
        }
      } else if (left && !isLTR) {
        if (y1 < firstPointY) {
          firstPointY = y1;
          firstPointX = x;
        } else if (y1 === firstPointY) {
          firstPointX = Math.min(firstPointX, x);
        }
      }
      edge[0] = (x - shiftedMinX) / bboxWidth;
      edge[1] = (y1 - shiftedMinY) / bboxHeight;
      edge[2] = (y2 - shiftedMinY) / bboxHeight;
    }
    this.#box = new Float32Array([shiftedMinX, shiftedMinY, bboxWidth, bboxHeight]);
    this.#firstPoint = [firstPointX, firstPointY];
    this.#lastPoint = lastPoint;
  }
  getOutlines() {
    this.#verticalEdges.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const outlineVerticalEdges = [];
    for (const edge of this.#verticalEdges) {
      if (edge[3]) {
        outlineVerticalEdges.push(...this.#breakEdge(edge));
        this.#insert(edge);
      } else {
        this.#remove(edge);
        outlineVerticalEdges.push(...this.#breakEdge(edge));
      }
    }
    return this.#getOutlines(outlineVerticalEdges);
  }
  #getOutlines(outlineVerticalEdges) {
    const edges = [];
    const allEdges = new Set();
    for (const edge of outlineVerticalEdges) {
      const [x, y1, y2] = edge;
      edges.push([x, y1, edge], [x, y2, edge]);
    }
    edges.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (let i = 0, ii = edges.length; i < ii; i += 2) {
      const edge1 = edges[i][2];
      const edge2 = edges[i + 1][2];
      edge1.push(edge2);
      edge2.push(edge1);
      allEdges.add(edge1);
      allEdges.add(edge2);
    }
    const outlines = [];
    while (allEdges.size > 0) {
      const edge = allEdges.values().next().value;
      let [x, y1, y2, edge1, edge2] = edge;
      allEdges.delete(edge);
      let lastPointX = x;
      let lastPointY = y1;
      const outline = [x, y2];
      outlines.push(outline);
      while (true) {
        let e;
        if (allEdges.has(edge1)) {
          e = edge1;
        } else if (allEdges.has(edge2)) {
          e = edge2;
        } else {
          break;
        }
        allEdges.delete(e);
        [x, y1, y2, edge1, edge2] = e;
        if (lastPointX !== x) {
          outline.push(lastPointX, lastPointY, x, lastPointY === y1 ? y1 : y2);
          lastPointX = x;
        }
        lastPointY = lastPointY === y1 ? y2 : y1;
      }
      outline.push(lastPointX, lastPointY);
    }
    return new HighlightOutline(outlines, this.#box, this.#firstPoint, this.#lastPoint);
  }
  #binarySearch(y) {
    const array = this.#intervals;
    let start = 0;
    let end = array.length - 1;
    while (start <= end) {
      const middle = start + end >> 1;
      const y1 = array[middle][0];
      if (y1 === y) {
        return middle;
      }
      if (y1 < y) {
        start = middle + 1;
      } else {
        end = middle - 1;
      }
    }
    return end + 1;
  }
  #insert([, y1, y2]) {
    const index = this.#binarySearch(y1);
    this.#intervals.splice(index, 0, [y1, y2]);
  }
  #remove([, y1, y2]) {
    const index = this.#binarySearch(y1);
    for (let i = index; i < this.#intervals.length; i++) {
      const [start, end] = this.#intervals[i];
      if (start !== y1) {
        break;
      }
      if (start === y1 && end === y2) {
        this.#intervals.splice(i, 1);
        return;
      }
    }
    for (let i = index - 1; i >= 0; i--) {
      const [start, end] = this.#intervals[i];
      if (start !== y1) {
        break;
      }
      if (start === y1 && end === y2) {
        this.#intervals.splice(i, 1);
        return;
      }
    }
  }
  #breakEdge(edge) {
    const [x, y1, y2] = edge;
    const results = [[x, y1, y2]];
    const index = this.#binarySearch(y2);
    for (let i = 0; i < index; i++) {
      const [start, end] = this.#intervals[i];
      for (let j = 0, jj = results.length; j < jj; j++) {
        const [, y3, y4] = results[j];
        if (end <= y3 || y4 <= start) {
          continue;
        }
        if (y3 >= start) {
          if (y4 > end) {
            results[j][1] = end;
          } else {
            if (jj === 1) {
              return [];
            }
            results.splice(j, 1);
            j--;
            jj--;
          }
          continue;
        }
        results[j][2] = start;
        if (y4 > end) {
          results.push([x, end, y4]);
        }
      }
    }
    return results;
  }
}
class HighlightOutline extends Outline {
  #box;
  #boxes = null;
  #outlines;
  constructor(outlines, box, firstPoint, lastPoint) {
    super();
    this.#outlines = outlines;
    this.#box = box;
    this.firstPoint = firstPoint;
    this.lastPoint = lastPoint;
  }
  static build(boxes, isLTR) {
    const outline = new HighlightOutliner(boxes, 0.001).getOutlines();
    outline.#boxes = boxes;
    outline.focusOutline = new HighlightOutliner(boxes, 0.0025, 0.001, isLTR).getOutlines();
    return outline;
  }
  get isFree() {
    return false;
  }
  get defaultSVGProperties() {
    return getHighlightSVGProperties(this);
  }
  getFocusSVGProperties(rotation) {
    return getHighlightFocusSVGProperties(this, rotation);
  }
  updateRotation(rotation) {
    return {
      root: {
        "data-main-rotation": rotation
      }
    };
  }
  serializeQuadPoints([pageX, pageY], [pageWidth, pageHeight]) {
    const boxes = this.#boxes;
    const quadPoints = new Float32Array(boxes.length * 8);
    let i = 0;
    for (const {
      x,
      y,
      width,
      height
    } of boxes) {
      const sx = x * pageWidth + pageX;
      const sy = (1 - y) * pageHeight + pageY;
      quadPoints[i] = quadPoints[i + 4] = sx;
      quadPoints[i + 1] = quadPoints[i + 3] = sy;
      quadPoints[i + 2] = quadPoints[i + 6] = sx + width * pageWidth;
      quadPoints[i + 5] = quadPoints[i + 7] = sy - height * pageHeight;
      i += 8;
    }
    return quadPoints;
  }
  toSVGPath() {
    const buffer = [];
    for (const polygon of this.#outlines) {
      let [prevX, prevY] = polygon;
      buffer.push(`M${prevX} ${prevY}`);
      for (let i = 2; i < polygon.length; i += 2) {
        const x = polygon[i];
        const y = polygon[i + 1];
        if (x === prevX) {
          buffer.push(`V${y}`);
          prevY = y;
        } else if (y === prevY) {
          buffer.push(`H${x}`);
          prevX = x;
        }
      }
      buffer.push("Z");
    }
    return buffer.join(" ");
  }
  serialize([blX, blY, trX, trY], _rotation) {
    const outlines = [];
    const width = trX - blX;
    const height = trY - blY;
    for (const outline of this.#outlines) {
      const points = new Array(outline.length);
      for (let i = 0; i < outline.length; i += 2) {
        points[i] = blX + outline[i] * width;
        points[i + 1] = trY - outline[i + 1] * height;
      }
      outlines.push(points);
    }
    return outlines;
  }
  get box() {
    return this.#box;
  }
}
class FreeHighlightOutliner extends FreeDrawOutliner {
  newFreeDrawOutline(outline, points, box, scaleFactor, innerMargin, isLTR) {
    return new FreeHighlightOutline(outline, points, box, scaleFactor, innerMargin, isLTR);
  }
}
class FreeHighlightDrawer {
  #outliner;
  #thickness;
  constructor(x, y, box, scaleFactor, thickness, isLTR, innerMargin) {
    this.#outliner = new FreeHighlightOutliner(x, y, box, scaleFactor, thickness, isLTR, innerMargin);
    this.#thickness = thickness;
  }
  add(x, y) {
    return this.#outliner.add(x, y) ? {
      path: {
        d: this.#outliner.toSVGPath()
      }
    } : null;
  }
  addPoints(points) {
    let hasChanged = false;
    for (let i = 0, ii = points.length; i < ii; i += 2) {
      hasChanged = this.#outliner.add(points[i], points[i + 1]) || hasChanged;
    }
    return hasChanged ? {
      path: {
        d: this.#outliner.toSVGPath()
      }
    } : null;
  }
  end(x, y) {
    return x === undefined ? null : this.add(x, y);
  }
  isEmpty() {
    return this.#outliner.isEmpty();
  }
  isCancellable() {
    return this.#outliner.isCancellable();
  }
  removeLastElement() {
    return this.#outliner.removeLastElement();
  }
  updateProperty(_name, _value) {
    return null;
  }
  getOutlines() {
    const outlines = this.#outliner.getOutlines();
    outlines.buildFocusOutline(2 * this.#thickness);
    return outlines;
  }
  get defaultSVGProperties() {
    return {
      bbox: [0, 0, 1, 1],
      root: {
        viewBox: "0 0 1 1"
      },
      rootClass: {
        highlight: true,
        free: true
      },
      path: {
        d: this.#outliner.toSVGPath()
      }
    };
  }
}
class FreeHighlightOutline extends FreeDrawOutline {
  static #EXTRA_THICKNESS = 1.5;
  newOutliner(x, y, box, scaleFactor, thickness, isLTR, innerMargin = 0) {
    return new FreeHighlightOutliner(x, y, box, scaleFactor, thickness, isLTR, innerMargin);
  }
  get isFree() {
    return true;
  }
  buildFocusOutline(thickness) {
    this.focusOutline = this.getNewOutline(thickness / 2 + FreeHighlightOutline.#EXTRA_THICKNESS, 0.0025);
  }
  get defaultSVGProperties() {
    return getHighlightSVGProperties(this);
  }
  getFocusSVGProperties(rotation) {
    return getHighlightFocusSVGProperties(this, rotation);
  }
  get focusMustRemoveSelfIntersections() {
    return true;
  }
  updateRotation(rotation) {
    return {
      root: {
        "data-main-rotation": rotation
      }
    };
  }
  updateProperty(name, value) {
    if (name !== "thickness") {
      return null;
    }
    const bbox = this.updateThickness(value / 2);
    this.buildFocusOutline(value);
    return bbox;
  }
  getPathResizedSVGProperties() {
    return {
      path: {
        d: this.toSVGPath()
      }
    };
  }
}
export { FreeHighlightDrawer, FreeHighlightOutliner, HighlightOutline, HighlightOutliner };