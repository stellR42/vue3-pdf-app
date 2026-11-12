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
import "core-js/modules/es.iterator.map.js";
import "core-js/modules/es.typed-array.with.js";
import { BBOX_INIT, FormatError, info, unreachable, Util } from "../shared/util.js";
import { drawMeshWithGPU, isGPUReady, loadMeshShader } from "./webgpu.js";
import { CanvasNestedDependencyTracker } from "./canvas_dependency_tracker.js";
import { getCurrentTransform } from "./display_utils.js";
const PathType = {
  FILL: "Fill",
  STROKE: "Stroke",
  SHADING: "Shading"
};
function applyBoundingBox(ctx, bbox) {
  if (!bbox) {
    return;
  }
  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];
  const region = new Path2D();
  region.rect(bbox[0], bbox[1], width, height);
  ctx.clip(region);
}
class BaseShadingPattern {
  matrix = null;
  isModifyingCurrentTransform() {
    return false;
  }
  getPattern() {
    unreachable("Abstract method `getPattern` called.");
  }
}
class RadialAxialShadingPattern extends BaseShadingPattern {
  constructor(IR) {
    super();
    this._type = IR[1];
    this._bbox = IR[2];
    this._colorStops = IR[3];
    this._p0 = IR[4];
    this._p1 = IR[5];
    this._r0 = IR[6];
    this._r1 = IR[7];
  }
  isOriginBased() {
    return this._p0[0] === 0 && this._p0[1] === 0 && (!this.isRadial() || this._p1[0] === 0 && this._p1[1] === 0);
  }
  isRadial() {
    return this._type === "radial";
  }
  areConic() {
    if (!this.isRadial()) {
      return false;
    }
    const dist = Math.hypot(this._p0[0] - this._p1[0], this._p0[1] - this._p1[1]);
    return dist + this._r1 > this._r0 && dist + this._r0 > this._r1;
  }
  _createGradient(ctx, transform = null) {
    let grad;
    let firstPoint = this._p0;
    let secondPoint = this._p1;
    if (transform) {
      firstPoint = firstPoint.slice();
      secondPoint = secondPoint.slice();
      Util.applyTransform(firstPoint, transform);
      Util.applyTransform(secondPoint, transform);
    }
    if (this._type === "axial") {
      grad = ctx.createLinearGradient(firstPoint[0], firstPoint[1], secondPoint[0], secondPoint[1]);
    } else if (this._type === "radial") {
      let r0 = this._r0;
      let r1 = this._r1;
      if (transform) {
        const scale = new Float32Array(2);
        Util.singularValueDecompose2dScale(transform, scale);
        r0 *= scale[0];
        r1 *= scale[0];
      }
      grad = ctx.createRadialGradient(firstPoint[0], firstPoint[1], r0, secondPoint[0], secondPoint[1], r1);
    }
    for (const colorStop of this._colorStops) {
      grad.addColorStop(colorStop[0], colorStop[1]);
    }
    return grad;
  }
  _createReversedGradient(ctx, transform = null) {
    let firstPoint = this._p1;
    let secondPoint = this._p0;
    if (transform) {
      firstPoint = firstPoint.slice();
      secondPoint = secondPoint.slice();
      Util.applyTransform(firstPoint, transform);
      Util.applyTransform(secondPoint, transform);
    }
    let r0 = this._r1;
    let r1 = this._r0;
    if (transform) {
      const scale = new Float32Array(2);
      Util.singularValueDecompose2dScale(transform, scale);
      r0 *= scale[0];
      r1 *= scale[0];
    }
    const grad = ctx.createRadialGradient(firstPoint[0], firstPoint[1], r0, secondPoint[0], secondPoint[1], r1);
    const reversedStops = this._colorStops.map(([t, c]) => [1 - t, c]).reverse();
    for (const [t, c] of reversedStops) {
      grad.addColorStop(t, c);
    }
    return grad;
  }
  _createRasterPattern(ctx, owner, inverse, bbox, transform, transferMaps) {
    const width = Math.ceil(bbox[2] - bbox[0]) || 1;
    const height = Math.ceil(bbox[3] - bbox[1]) || 1;
    const tmpCanvas = owner.canvasFactory.create(width, height);
    const tmpCtx = tmpCanvas.context;
    tmpCtx.clearRect(0, 0, width, height);
    tmpCtx.beginPath();
    tmpCtx.rect(0, 0, width, height);
    tmpCtx.translate(-bbox[0], -bbox[1]);
    inverse = Util.transform(inverse, [1, 0, 0, 1, bbox[0], bbox[1]]);
    tmpCtx.transform(...transform);
    applyBoundingBox(tmpCtx, this._bbox);
    if (this.areConic()) {
      tmpCtx.fillStyle = this._createReversedGradient(tmpCtx);
      tmpCtx.fill();
    }
    tmpCtx.fillStyle = this._createGradient(tmpCtx);
    tmpCtx.fill();
    transferMaps?.applyToCanvas(tmpCtx);
    const pattern = ctx.createPattern(tmpCanvas.canvas, "no-repeat");
    owner.canvasFactory.destroy(tmpCanvas);
    pattern.setTransform(new DOMMatrix(inverse));
    return pattern;
  }
  getPattern(ctx, owner, inverse, pathType) {
    const transferMaps = owner.current.transferMapsFallback;
    if (pathType === PathType.STROKE || pathType === PathType.FILL) {
      if (this.isOriginBased() && !transferMaps) {
        let transf = Util.transform(inverse, owner.baseTransform);
        if (this.matrix) {
          transf = Util.transform(transf, this.matrix);
        }
        const precision = 1e-3;
        const n1 = Math.hypot(transf[0], transf[1]);
        const n2 = Math.hypot(transf[2], transf[3]);
        const ps = (transf[0] * transf[2] + transf[1] * transf[3]) / (n1 * n2);
        if (Math.abs(ps) < precision) {
          if (this.isRadial()) {
            if (Math.abs(n1 - n2) < precision) {
              return this._createGradient(ctx, transf);
            }
          } else {
            return this._createGradient(ctx, transf);
          }
        }
      }
      const ownerBBox = owner.current.getClippedPathBoundingBox(pathType, getCurrentTransform(ctx)) || [0, 0, 0, 0];
      const transform = this.matrix ? Util.transform(owner.baseTransform, this.matrix) : owner.baseTransform;
      return this._createRasterPattern(ctx, owner, inverse, ownerBBox, transform, transferMaps);
    }
    if (transferMaps && inverse) {
      return this._createRasterPattern(ctx, owner, inverse, owner.current.clipBox, getCurrentTransform(ctx), transferMaps);
    }
    if (this.areConic()) {
      ctx.save();
      applyBoundingBox(ctx, this._bbox);
      ctx.fillStyle = this._createReversedGradient(ctx);
      ctx.fillRect(-1e10, -1e10, 2e10, 2e10);
      ctx.restore();
    }
    applyBoundingBox(ctx, this._bbox);
    return this._createGradient(ctx);
  }
}
function drawTriangle(data, context, p1, p2, p3, c1, c2, c3) {
  const coords = context.coords,
    colors = context.colors;
  const bytes = data.data,
    rowSize = data.width * 4;
  let tmp;
  if (coords[p1 * 2 + 1] > coords[p2 * 2 + 1]) {
    tmp = p1;
    p1 = p2;
    p2 = tmp;
    tmp = c1;
    c1 = c2;
    c2 = tmp;
  }
  if (coords[p2 * 2 + 1] > coords[p3 * 2 + 1]) {
    tmp = p2;
    p2 = p3;
    p3 = tmp;
    tmp = c2;
    c2 = c3;
    c3 = tmp;
  }
  if (coords[p1 * 2 + 1] > coords[p2 * 2 + 1]) {
    tmp = p1;
    p1 = p2;
    p2 = tmp;
    tmp = c1;
    c1 = c2;
    c2 = tmp;
  }
  const x1 = (coords[p1 * 2] + context.offsetX) * context.scaleX;
  const y1 = (coords[p1 * 2 + 1] + context.offsetY) * context.scaleY;
  const x2 = (coords[p2 * 2] + context.offsetX) * context.scaleX;
  const y2 = (coords[p2 * 2 + 1] + context.offsetY) * context.scaleY;
  const x3 = (coords[p3 * 2] + context.offsetX) * context.scaleX;
  const y3 = (coords[p3 * 2 + 1] + context.offsetY) * context.scaleY;
  if (y1 >= y3) {
    return;
  }
  const c1r = colors[c1 * 4],
    c1g = colors[c1 * 4 + 1],
    c1b = colors[c1 * 4 + 2];
  const c2r = colors[c2 * 4],
    c2g = colors[c2 * 4 + 1],
    c2b = colors[c2 * 4 + 2];
  const c3r = colors[c3 * 4],
    c3g = colors[c3 * 4 + 1],
    c3b = colors[c3 * 4 + 2];
  const minY = Math.round(y1),
    maxY = Math.round(y3);
  let xa, car, cag, cab;
  let xb, cbr, cbg, cbb;
  for (let y = minY; y <= maxY; y++) {
    if (y < y2) {
      const k = y < y1 ? 0 : (y1 - y) / (y1 - y2);
      xa = x1 - (x1 - x2) * k;
      car = c1r - (c1r - c2r) * k;
      cag = c1g - (c1g - c2g) * k;
      cab = c1b - (c1b - c2b) * k;
    } else {
      let k;
      if (y > y3) {
        k = 1;
      } else if (y2 === y3) {
        k = 0;
      } else {
        k = (y2 - y) / (y2 - y3);
      }
      xa = x2 - (x2 - x3) * k;
      car = c2r - (c2r - c3r) * k;
      cag = c2g - (c2g - c3g) * k;
      cab = c2b - (c2b - c3b) * k;
    }
    let k;
    if (y < y1) {
      k = 0;
    } else if (y > y3) {
      k = 1;
    } else {
      k = (y1 - y) / (y1 - y3);
    }
    xb = x1 - (x1 - x3) * k;
    cbr = c1r - (c1r - c3r) * k;
    cbg = c1g - (c1g - c3g) * k;
    cbb = c1b - (c1b - c3b) * k;
    const x1_ = Math.round(Math.min(xa, xb));
    const x2_ = Math.round(Math.max(xa, xb));
    let j = rowSize * y + x1_ * 4;
    for (let x = x1_; x <= x2_; x++) {
      k = (xa - x) / (xa - xb);
      if (k < 0) {
        k = 0;
      } else if (k > 1) {
        k = 1;
      }
      bytes[j++] = car - (car - cbr) * k | 0;
      bytes[j++] = cag - (cag - cbg) * k | 0;
      bytes[j++] = cab - (cab - cbb) * k | 0;
      bytes[j++] = 255;
    }
  }
}
class MeshShadingPattern extends BaseShadingPattern {
  constructor(IR) {
    super();
    this._posData = IR[2];
    this._colData = IR[3];
    this._vertexCount = IR[4];
    this._bounds = IR[5];
    this._bbox = IR[6];
    this._background = IR[7];
    loadMeshShader();
  }
  _createMeshCanvas(combinedScale, backgroundColor, canvasFactory, transferMaps = null) {
    const EXPECTED_SCALE = 1.1;
    const MAX_PATTERN_SIZE = 3000;
    const BORDER_SIZE = 2;
    const offsetX = Math.floor(this._bounds[0]);
    const offsetY = Math.floor(this._bounds[1]);
    const boundsWidth = Math.ceil(this._bounds[2]) - offsetX;
    const boundsHeight = Math.ceil(this._bounds[3]) - offsetY;
    const width = Math.min(Math.ceil(Math.abs(boundsWidth * combinedScale[0] * EXPECTED_SCALE)), MAX_PATTERN_SIZE) || 1;
    const height = Math.min(Math.ceil(Math.abs(boundsHeight * combinedScale[1] * EXPECTED_SCALE)), MAX_PATTERN_SIZE) || 1;
    const scaleX = boundsWidth ? boundsWidth / width : 1;
    const scaleY = boundsHeight ? boundsHeight / height : 1;
    const context = {
      coords: this._posData,
      colors: this._colData,
      offsetX: -offsetX,
      offsetY: -offsetY,
      scaleX: 1 / scaleX,
      scaleY: 1 / scaleY
    };
    const paddedWidth = width + BORDER_SIZE * 2;
    const paddedHeight = height + BORDER_SIZE * 2;
    const tmpCanvas = canvasFactory.create(paddedWidth, paddedHeight);
    if (isGPUReady() && this._vertexCount > 48) {
      tmpCanvas.context.drawImage(drawMeshWithGPU(this._posData, this._colData, this._vertexCount, context, backgroundColor, paddedWidth, paddedHeight, BORDER_SIZE), 0, 0);
    } else {
      const data = tmpCanvas.context.createImageData(width, height);
      if (backgroundColor) {
        const bytes = data.data;
        for (let i = 0, ii = bytes.length; i < ii; i += 4) {
          bytes[i] = backgroundColor[0];
          bytes[i + 1] = backgroundColor[1];
          bytes[i + 2] = backgroundColor[2];
          bytes[i + 3] = 255;
        }
      }
      for (let i = 0, ii = this._vertexCount; i < ii; i += 3) {
        drawTriangle(data, context, i, i + 1, i + 2, i, i + 1, i + 2);
      }
      tmpCanvas.context.putImageData(data, BORDER_SIZE, BORDER_SIZE);
    }
    transferMaps?.applyToCanvas(tmpCanvas.context);
    return {
      canvas: tmpCanvas.canvas,
      offsetX: offsetX - BORDER_SIZE * scaleX,
      offsetY: offsetY - BORDER_SIZE * scaleY,
      scaleX,
      scaleY
    };
  }
  isModifyingCurrentTransform() {
    return true;
  }
  getPattern(ctx, owner, inverse, pathType) {
    applyBoundingBox(ctx, this._bbox);
    const scale = new Float32Array(2);
    if (pathType === PathType.SHADING) {
      Util.singularValueDecompose2dScale(getCurrentTransform(ctx), scale);
    } else if (this.matrix) {
      Util.singularValueDecompose2dScale(this.matrix, scale);
      const [matrixScaleX, matrixScaleY] = scale;
      Util.singularValueDecompose2dScale(owner.baseTransform, scale);
      scale[0] *= matrixScaleX;
      scale[1] *= matrixScaleY;
    } else {
      Util.singularValueDecompose2dScale(owner.baseTransform, scale);
    }
    const temporaryPatternCanvas = this._createMeshCanvas(scale, pathType === PathType.SHADING ? null : this._background, owner.canvasFactory, owner.current.transferMapsFallback);
    if (pathType !== PathType.SHADING) {
      ctx.setTransform(...owner.baseTransform);
      if (this.matrix) {
        ctx.transform(...this.matrix);
      }
    }
    ctx.translate(temporaryPatternCanvas.offsetX, temporaryPatternCanvas.offsetY);
    ctx.scale(temporaryPatternCanvas.scaleX, temporaryPatternCanvas.scaleY);
    const pattern = ctx.createPattern(temporaryPatternCanvas.canvas, "no-repeat");
    owner.canvasFactory.destroy(temporaryPatternCanvas);
    return pattern;
  }
}
class DummyShadingPattern extends BaseShadingPattern {
  getPattern() {
    return "hotpink";
  }
}
function getShadingPattern(IR) {
  switch (IR[0]) {
    case "RadialAxial":
      return new RadialAxialShadingPattern(IR);
    case "Mesh":
      return new MeshShadingPattern(IR);
    case "Dummy":
      return new DummyShadingPattern();
  }
  throw new Error(`Unknown IR type: ${IR[0]}`);
}
const PaintType = {
  COLORED: 1,
  UNCOLORED: 2
};
class TilingPattern {
  static MAX_PATTERN_SIZE = 3000;
  constructor(IR, ctx, canvasGraphicsFactory, baseTransform) {
    this.color = IR[1];
    this.operatorList = IR[2];
    this.matrix = IR[3];
    this.bbox = IR[4];
    this.xstep = IR[5];
    this.ystep = IR[6];
    this.paintType = IR[7];
    this.tilingType = IR[8];
    this.needsIsolation = IR[9] ?? true;
    this.ctx = ctx;
    this.canvasGraphicsFactory = canvasGraphicsFactory;
    this.baseTransform = baseTransform;
    this.patternBaseMatrix = this.matrix ? Util.transform(baseTransform, this.matrix) : baseTransform;
  }
  canSkipPatternCanvas([width, height, offsetX, offsetY]) {
    const [x0, y0, x1, y1] = this.bbox;
    const absXStep = Math.abs(this.xstep);
    const absYStep = Math.abs(this.ystep);
    if (width > absXStep + 1e-6 || height > absYStep + 1e-6) {
      return null;
    }
    const nXFirst = Math.floor((offsetX - x1) / absXStep) + 1;
    const nXLast = Math.ceil((offsetX + width - x0) / absXStep) - 1;
    const nYFirst = Math.floor((offsetY - y1) / absYStep) + 1;
    const nYLast = Math.ceil((offsetY + height - y0) / absYStep) - 1;
    return nXLast <= nXFirst && nYLast <= nYFirst ? [nXFirst, nYFirst] : null;
  }
  updatePatternDims(clippedBBox, dims) {
    const bbox = BBOX_INIT.slice();
    Util.axialAlignedBoundingBox(clippedBBox, Util.inverseTransform(this.patternBaseMatrix), bbox);
    dims[0] = bbox[2] - bbox[0];
    dims[1] = bbox[3] - bbox[1];
    dims[2] = bbox[0];
    dims[3] = bbox[1];
  }
  _renderTileCanvas(owner, opIdx, dimx, dimy) {
    const [x0, y0, x1, y1] = this.bbox;
    const tmpCanvas = owner.canvasFactory.create(dimx.size, dimy.size);
    const tmpCtx = tmpCanvas.context;
    const graphics = this.canvasGraphicsFactory.createCanvasGraphics(tmpCtx, opIdx);
    graphics.groupLevel = owner.groupLevel;
    graphics.current.transferMapsFallback = owner.current.transferMapsFallback;
    this.setFillAndStrokeStyleToContext(graphics, this.paintType, this.color);
    tmpCtx.translate(-dimx.scale * x0, -dimy.scale * y0);
    graphics.transform(0, dimx.scale, 0, 0, dimy.scale, 0, 0);
    tmpCtx.save();
    graphics.dependencyTracker?.save();
    this.clipBbox(graphics, x0, y0, x1, y1);
    graphics.baseTransform = getCurrentTransform(graphics.ctx);
    graphics.executeOperatorList(this.operatorList);
    graphics.endDrawing();
    graphics.dependencyTracker?.restore();
    tmpCtx.restore();
    return tmpCanvas;
  }
  _getCombinedScales() {
    const scale = new Float32Array(2);
    Util.singularValueDecompose2dScale(this.matrix, scale);
    const [matrixScaleX, matrixScaleY] = scale;
    Util.singularValueDecompose2dScale(this.baseTransform, scale);
    return [matrixScaleX * scale[0], matrixScaleY * scale[1]];
  }
  drawPattern(owner, path, useEOFill = false, [n, m], opIdx) {
    const [x0, y0, x1, y1] = this.bbox;
    const dependencyTracker = owner.dependencyTracker;
    if (dependencyTracker) {
      owner.dependencyTracker = new CanvasNestedDependencyTracker(dependencyTracker, opIdx);
    }
    try {
      owner.save();
      if (useEOFill) {
        owner.ctx.clip(path, "evenodd");
      } else {
        owner.ctx.clip(path);
      }
      owner.ctx.setTransform(...this.patternBaseMatrix);
      owner.ctx.translate(n * this.xstep, m * this.ystep);
      if (this.needsIsolation || owner.ctx.globalAlpha !== 1 || owner.ctx.globalCompositeOperation !== "source-over" || owner.inSMaskMode) {
        const bboxWidth = x1 - x0;
        const bboxHeight = y1 - y0;
        const [combinedScaleX, combinedScaleY] = this._getCombinedScales();
        const dimx = this.getSizeAndScale(bboxWidth, this.ctx.canvas.width, combinedScaleX);
        const dimy = this.getSizeAndScale(bboxHeight, this.ctx.canvas.height, combinedScaleY);
        const tmpCanvas = this._renderTileCanvas(owner, opIdx, dimx, dimy);
        owner.ctx.drawImage(tmpCanvas.canvas, x0, y0, bboxWidth, bboxHeight);
        owner.canvasFactory.destroy(tmpCanvas);
      } else {
        owner.resetGraphicsState();
        this.setFillAndStrokeStyleToContext(owner, this.paintType, this.color);
        this.clipBbox(owner, x0, y0, x1, y1);
        owner.baseTransformStack.push(owner.baseTransform);
        owner.baseTransform = getCurrentTransform(owner.ctx);
        owner.executeOperatorList(this.operatorList);
        owner.baseTransform = owner.baseTransformStack.pop();
      }
      owner.restore();
    } finally {
      if (dependencyTracker) {
        owner.dependencyTracker = dependencyTracker;
      }
    }
  }
  createPatternCanvas(owner, opIdx) {
    const [x0, y0, x1, y1] = this.bbox;
    const width = x1 - x0;
    const height = y1 - y0;
    let {
      xstep,
      ystep
    } = this;
    xstep = Math.abs(xstep);
    ystep = Math.abs(ystep);
    info("TilingType: " + this.tilingType);
    const [combinedScaleX, combinedScaleY] = this._getCombinedScales();
    let canvasWidth = width,
      canvasHeight = height,
      redrawHorizontally = false,
      redrawVertically = false;
    if (Math.ceil(xstep * combinedScaleX) >= Math.ceil(width * combinedScaleX)) {
      canvasWidth = xstep;
    } else {
      redrawHorizontally = true;
    }
    if (Math.ceil(ystep * combinedScaleY) >= Math.ceil(height * combinedScaleY)) {
      canvasHeight = ystep;
    } else {
      redrawVertically = true;
    }
    const dimx = this.getSizeAndScale(canvasWidth, this.ctx.canvas.width, combinedScaleX);
    const dimy = this.getSizeAndScale(canvasHeight, this.ctx.canvas.height, combinedScaleY);
    const tmpCanvas = this._renderTileCanvas(owner, opIdx, dimx, dimy);
    if (redrawHorizontally || redrawVertically) {
      const image = tmpCanvas.canvas;
      if (redrawHorizontally) {
        canvasWidth = xstep;
      }
      if (redrawVertically) {
        canvasHeight = ystep;
      }
      const dimx2 = this.getSizeAndScale(canvasWidth, this.ctx.canvas.width, combinedScaleX);
      const dimy2 = this.getSizeAndScale(canvasHeight, this.ctx.canvas.height, combinedScaleY);
      const xSize = dimx2.size;
      const ySize = dimy2.size;
      const tmpCanvas2 = owner.canvasFactory.create(xSize, ySize);
      const tmpCtx2 = tmpCanvas2.context;
      const ii = redrawHorizontally ? Math.min(Math.floor(width / xstep), Math.ceil(image.width / xSize)) : 0;
      const jj = redrawVertically ? Math.min(Math.floor(height / ystep), Math.ceil(image.height / ySize)) : 0;
      let rowSource = image;
      let bandCanvas = null;
      if (redrawVertically) {
        bandCanvas = owner.canvasFactory.create(image.width, ySize);
        const bandCtx = bandCanvas.context;
        for (let j = jj; j >= 0; j--) {
          bandCtx.drawImage(image, 0, ySize * j, image.width, ySize, 0, 0, image.width, ySize);
        }
        rowSource = bandCanvas.canvas;
      }
      for (let i = ii; i >= 0; i--) {
        tmpCtx2.drawImage(rowSource, xSize * i, 0, xSize, ySize, 0, 0, xSize, ySize);
      }
      if (bandCanvas) {
        owner.canvasFactory.destroy(bandCanvas);
      }
      owner.canvasFactory.destroy(tmpCanvas);
      return {
        canvas: tmpCanvas2.canvas,
        canvasEntry: tmpCanvas2,
        scaleX: dimx2.scale,
        scaleY: dimy2.scale,
        offsetX: x0,
        offsetY: y0
      };
    }
    return {
      canvas: tmpCanvas.canvas,
      canvasEntry: tmpCanvas,
      scaleX: dimx.scale,
      scaleY: dimy.scale,
      offsetX: x0,
      offsetY: y0
    };
  }
  getSizeAndScale(step, realOutputSize, scale) {
    const maxSize = Math.max(TilingPattern.MAX_PATTERN_SIZE, realOutputSize);
    let size = Math.ceil(step * scale);
    if (size >= maxSize) {
      size = maxSize;
    } else {
      scale = size / step;
    }
    return {
      scale,
      size
    };
  }
  clipBbox(graphics, x0, y0, x1, y1) {
    const bboxWidth = x1 - x0;
    const bboxHeight = y1 - y0;
    const clip = new Path2D();
    clip.rect(x0, y0, bboxWidth, bboxHeight);
    Util.axialAlignedBoundingBox([x0, y0, x1, y1], getCurrentTransform(graphics.ctx), graphics.current.minMax);
    graphics.ctx.clip(clip);
    graphics.current.updateClipFromPath();
  }
  setFillAndStrokeStyleToContext(graphics, paintType, color) {
    switch (paintType) {
      case PaintType.COLORED:
        color = "#000000";
        break;
      case PaintType.UNCOLORED:
        break;
      default:
        throw new FormatError(`Unsupported paint type: ${paintType}`);
    }
    const {
      ctx,
      current
    } = graphics;
    current.patternFill = current.patternStroke = false;
    ctx.fillStyle = ctx.strokeStyle = current.transferMapsFallback?.applyToColor(color) ?? color;
    current.fillColor = current.strokeColor = color;
  }
  isModifyingCurrentTransform() {
    return false;
  }
  getPattern(ctx, owner, inverse, pathType, opIdx) {
    const matrix = pathType !== PathType.SHADING ? Util.transform(inverse, this.patternBaseMatrix) : inverse;
    const temporaryPatternCanvas = this.createPatternCanvas(owner, opIdx);
    let domMatrix = new DOMMatrix(matrix);
    domMatrix = domMatrix.translate(temporaryPatternCanvas.offsetX, temporaryPatternCanvas.offsetY);
    domMatrix = domMatrix.scale(1 / temporaryPatternCanvas.scaleX, 1 / temporaryPatternCanvas.scaleY);
    const pattern = ctx.createPattern(temporaryPatternCanvas.canvas, "repeat");
    owner.canvasFactory.destroy(temporaryPatternCanvas.canvasEntry);
    pattern.setTransform(domMatrix);
    return pattern;
  }
}
export { getShadingPattern, PathType, TilingPattern };