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
import "core-js/modules/es.typed-array.with.js";
import { unreachable } from "../../../shared/util.js";
class Outline {
  static PRECISION = 1e-4;
  focusOutline = null;
  toSVGPath() {
    unreachable("Abstract method `toSVGPath` must be implemented.");
  }
  get box() {
    unreachable("Abstract getter `box` must be implemented.");
  }
  serialize(_bbox, _rotation) {
    unreachable("Abstract method `serialize` must be implemented.");
  }
  get defaultSVGProperties() {
    unreachable("Abstract getter `defaultSVGProperties` must be implemented.");
  }
  get defaultProperties() {
    return this.defaultSVGProperties;
  }
  getFocusSVGProperties(_rotation) {
    return null;
  }
  get focusMustRemoveSelfIntersections() {
    return false;
  }
  updateProperty(_name, _value) {
    return null;
  }
  updateParentDimensions(_dimensions, _scale) {
    return null;
  }
  serializeQuadPoints(_pageTranslation, _pageDimensions) {
    return null;
  }
  updateRotation(_rotation) {
    return {};
  }
  getPathResizingSVGProperties(_bbox) {
    return {};
  }
  getPathResizedSVGProperties(_bbox) {
    return {};
  }
  getPathTranslatedSVGProperties(_bbox, _parentDimensions) {
    return {};
  }
  static _rotateBox([x, y, width, height], angle) {
    switch (angle) {
      case 90:
        return [1 - y - height, x, height, width];
      case 180:
        return [1 - x - width, 1 - y - height, width, height];
      case 270:
        return [y, 1 - x - width, height, width];
    }
    return [x, y, width, height];
  }
  static _rescale(src, tx, ty, sx, sy, dest) {
    dest ||= new Float32Array(src.length);
    for (let i = 0, ii = src.length; i < ii; i += 2) {
      dest[i] = tx + src[i] * sx;
      dest[i + 1] = ty + src[i + 1] * sy;
    }
    return dest;
  }
  static _rescaleAndSwap(src, tx, ty, sx, sy, dest) {
    dest ||= new Float32Array(src.length);
    for (let i = 0, ii = src.length; i < ii; i += 2) {
      dest[i] = tx + src[i + 1] * sx;
      dest[i + 1] = ty + src[i] * sy;
    }
    return dest;
  }
  static _translate(src, tx, ty, dest) {
    dest ||= new Float32Array(src.length);
    for (let i = 0, ii = src.length; i < ii; i += 2) {
      dest[i] = tx + src[i];
      dest[i + 1] = ty + src[i + 1];
    }
    return dest;
  }
  static svgRound(x) {
    return Math.round(x * 10000);
  }
  static _normalizePoint(x, y, parentWidth, parentHeight, rotation, dest = []) {
    switch (rotation) {
      case 90:
        dest[0] = 1 - y / parentWidth;
        dest[1] = x / parentHeight;
        break;
      case 180:
        dest[0] = 1 - x / parentWidth;
        dest[1] = 1 - y / parentHeight;
        break;
      case 270:
        dest[0] = y / parentWidth;
        dest[1] = 1 - x / parentHeight;
        break;
      default:
        dest[0] = x / parentWidth;
        dest[1] = y / parentHeight;
        break;
    }
    return dest;
  }
  static createBezierPoints(x1, y1, x2, y2, x3, y3, dest = []) {
    dest.push((x1 + 5 * x2) / 6, (y1 + 5 * y2) / 6, (5 * x2 + x3) / 6, (5 * y2 + y3) / 6, (x2 + x3) / 2, (y2 + y3) / 2);
    return dest;
  }
}
export { Outline };