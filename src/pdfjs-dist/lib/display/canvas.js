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
import "core-js/modules/es.iterator.filter.js";
import "core-js/modules/es.iterator.map.js";
import "core-js/modules/es.json.stringify.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import "core-js/modules/es.typed-array.with.js";
import "core-js/modules/es.weak-map.get-or-insert.js";
import "core-js/modules/es.weak-map.get-or-insert-computed.js";
import { CanvasNestedDependencyTracker, Dependencies } from "./canvas_dependency_tracker.js";
import { convertBlackAndWhiteToRGBA, convertRGBToRGBA } from "../shared/image_utils.js";
import { DEFAULT_VERTICAL_ADVANCE, DEFAULT_VERTICAL_ORIGIN_Y, F32_BBOX_INIT, FeatureTest, FONT_IDENTITY_MATRIX, ImageKind, info, makeArr, makeMap, OPS, shadow, TextRenderingMode, unreachable, Util, warn } from "../shared/util.js";
import { getCurrentTransform, getCurrentTransformInverse, getRGBA, makePathFromDrawOPS, OutputScale, PixelsPerInch } from "./display_utils.js";
import { getShadingPattern, PathType, TilingPattern } from "./pattern_helper.js";
import { MathClamp } from "../shared/math_clamp.js";
const MIN_FONT_SIZE = 16;
const MAX_FONT_SIZE = 100;
const EXECUTION_TIME = 15;
const EXECUTION_STEPS = 10;
const FULL_CHUNK_HEIGHT = 16;
const XY = new Float32Array(2);
function mirrorContextOperations(ctx, destCtx) {
  if (ctx._removeMirroring) {
    throw new Error("Context is already forwarding operations.");
  }
  const originalMethods = new Map();
  for (const name of ["save", "restore", "rotate", "scale", "translate", "transform", "setTransform", "resetTransform", "clip", "moveTo", "lineTo", "bezierCurveTo", "quadraticCurveTo", "arc", "arcTo", "ellipse", "rect", "roundRect", "closePath", "beginPath"]) {
    const original = ctx[name];
    if (typeof original !== "function" || typeof destCtx[name] !== "function") {
      continue;
    }
    originalMethods.set(name, original);
    ctx[name] = function (...args) {
      destCtx[name](...args);
      return original.apply(this, args);
    };
  }
  ctx._removeMirroring = () => {
    for (const [name, original] of originalMethods) {
      ctx[name] = original;
    }
    delete ctx._removeMirroring;
  };
}
function drawImageAtIntegerCoords(ctx, srcImg, srcX, srcY, srcW, srcH, destX, destY, destW, destH) {
  const [a, b, c, d, tx, ty] = getCurrentTransform(ctx);
  if (b === 0 && c === 0) {
    const tlX = destX * a + tx;
    const rTlX = Math.round(tlX);
    const tlY = destY * d + ty;
    const rTlY = Math.round(tlY);
    const brX = (destX + destW) * a + tx;
    const rWidth = Math.abs(Math.round(brX) - rTlX) || 1;
    const brY = (destY + destH) * d + ty;
    const rHeight = Math.abs(Math.round(brY) - rTlY) || 1;
    ctx.setTransform(Math.sign(a), 0, 0, Math.sign(d), rTlX, rTlY);
    ctx.drawImage(srcImg, srcX, srcY, srcW, srcH, 0, 0, rWidth, rHeight);
    ctx.setTransform(a, b, c, d, tx, ty);
    return [rWidth, rHeight];
  }
  if (a === 0 && d === 0) {
    const tlX = destY * c + tx;
    const rTlX = Math.round(tlX);
    const tlY = destX * b + ty;
    const rTlY = Math.round(tlY);
    const brX = (destY + destH) * c + tx;
    const rWidth = Math.abs(Math.round(brX) - rTlX) || 1;
    const brY = (destX + destW) * b + ty;
    const rHeight = Math.abs(Math.round(brY) - rTlY) || 1;
    ctx.setTransform(0, Math.sign(b), Math.sign(c), 0, rTlX, rTlY);
    ctx.drawImage(srcImg, srcX, srcY, srcW, srcH, 0, 0, rHeight, rWidth);
    ctx.setTransform(a, b, c, d, tx, ty);
    return [rHeight, rWidth];
  }
  ctx.drawImage(srcImg, srcX, srcY, srcW, srcH, destX, destY, destW, destH);
  const scaleX = Math.hypot(a, b);
  const scaleY = Math.hypot(c, d);
  return [scaleX * destW, scaleY * destH];
}
class CanvasExtraState {
  alphaIsShape = false;
  fontSize = 0;
  fontSizeScale = 1;
  textMatrix = null;
  textMatrixScale = 1;
  fontMatrix = FONT_IDENTITY_MATRIX;
  leading = 0;
  x = 0;
  y = 0;
  lineX = 0;
  lineY = 0;
  charSpacing = 0;
  wordSpacing = 0;
  textHScale = 1;
  textRenderingMode = TextRenderingMode.FILL;
  textRise = 0;
  fillColor = "#000000";
  strokeColor = "#000000";
  tilingPatternDims = null;
  patternFill = false;
  patternStroke = false;
  fillAlpha = 1;
  strokeAlpha = 1;
  lineWidth = 1;
  activeSMask = null;
  transferMaps = "none";
  transferMapsFallback = null;
  minMax = F32_BBOX_INIT.slice();
  constructor(width, height) {
    this.clipBox = new Float32Array([0, 0, width, height]);
  }
  clone() {
    const clone = Object.create(this);
    clone.clipBox = this.clipBox.slice();
    clone.minMax = this.minMax.slice();
    clone.tilingPatternDims = this.tilingPatternDims?.slice();
    return clone;
  }
  getPathBoundingBox(pathType = PathType.FILL, transform = null) {
    const box = this.minMax.slice();
    if (pathType === PathType.STROKE) {
      if (!transform) {
        unreachable("Stroke bounding box must include transform.");
      }
      Util.singularValueDecompose2dScale(transform, XY);
      const xStrokePad = XY[0] * this.lineWidth / 2;
      const yStrokePad = XY[1] * this.lineWidth / 2;
      box[0] -= xStrokePad;
      box[1] -= yStrokePad;
      box[2] += xStrokePad;
      box[3] += yStrokePad;
    }
    return box;
  }
  updateClipFromPath() {
    const intersect = Util.intersect(this.clipBox, this.getPathBoundingBox());
    this.startNewPathAndClipBox(intersect || [0, 0, 0, 0]);
  }
  isEmptyClip() {
    return this.minMax[0] === Infinity;
  }
  startNewPathAndClipBox(box) {
    this.clipBox.set(box, 0);
    this.minMax.set(F32_BBOX_INIT, 0);
  }
  getClippedPathBoundingBox(pathType = PathType.FILL, transform = null) {
    return Util.intersect(this.clipBox, this.getPathBoundingBox(pathType, transform));
  }
}
function putBinaryImageData(ctx, imgData) {
  const {
    width,
    height,
    kind
  } = imgData;
  const partialChunkHeight = height % FULL_CHUNK_HEIGHT;
  const fullChunks = (height - partialChunkHeight) / FULL_CHUNK_HEIGHT;
  const totalChunks = partialChunkHeight === 0 ? fullChunks : fullChunks + 1;
  const chunkImgData = ctx.createImageData(width, FULL_CHUNK_HEIGHT);
  let srcPos = 0;
  const src = imgData.data;
  const dest = chunkImgData.data;
  let i;
  if (kind === ImageKind.GRAYSCALE_1BPP) {
    for (i = 0; i < totalChunks; i++) {
      ({
        srcPos
      } = convertBlackAndWhiteToRGBA({
        src,
        srcPos,
        dest,
        width,
        height: i < fullChunks ? FULL_CHUNK_HEIGHT : partialChunkHeight
      }));
      ctx.putImageData(chunkImgData, 0, i * FULL_CHUNK_HEIGHT);
    }
  } else if (kind === ImageKind.RGBA_32BPP) {
    let j = 0;
    let elemsInThisChunk = width * FULL_CHUNK_HEIGHT * 4;
    for (i = 0; i < fullChunks; i++) {
      dest.set(src.subarray(srcPos, srcPos + elemsInThisChunk));
      srcPos += elemsInThisChunk;
      ctx.putImageData(chunkImgData, 0, j);
      j += FULL_CHUNK_HEIGHT;
    }
    if (i < totalChunks) {
      elemsInThisChunk = width * partialChunkHeight * 4;
      dest.set(src.subarray(srcPos, srcPos + elemsInThisChunk));
      ctx.putImageData(chunkImgData, 0, j);
    }
  } else if (kind === ImageKind.RGB_24BPP) {
    for (i = 0; i < totalChunks; i++) {
      ({
        srcPos
      } = convertRGBToRGBA({
        src,
        srcPos,
        dest: new Uint32Array(dest.buffer),
        width,
        height: i < fullChunks ? FULL_CHUNK_HEIGHT : partialChunkHeight
      }));
      ctx.putImageData(chunkImgData, 0, i * FULL_CHUNK_HEIGHT);
    }
  } else {
    throw new Error(`bad image kind: ${kind}`);
  }
}
function putBinaryImageMask(ctx, imgData) {
  if (imgData.bitmap) {
    ctx.drawImage(imgData.bitmap, 0, 0);
    return;
  }
  const {
    width,
    height
  } = imgData;
  const partialChunkHeight = height % FULL_CHUNK_HEIGHT;
  const fullChunks = (height - partialChunkHeight) / FULL_CHUNK_HEIGHT;
  const totalChunks = partialChunkHeight === 0 ? fullChunks : fullChunks + 1;
  const chunkImgData = ctx.createImageData(width, FULL_CHUNK_HEIGHT);
  let srcPos = 0;
  const src = imgData.data;
  const dest = chunkImgData.data;
  for (let i = 0; i < totalChunks; i++) {
    ({
      srcPos
    } = convertBlackAndWhiteToRGBA({
      src,
      srcPos,
      dest,
      width,
      height: i < fullChunks ? FULL_CHUNK_HEIGHT : partialChunkHeight,
      nonBlackColor: 0
    }));
    ctx.putImageData(chunkImgData, 0, i * FULL_CHUNK_HEIGHT);
  }
}
function copyCtxState(sourceCtx, destCtx) {
  const properties = ["strokeStyle", "fillStyle", "fillRule", "globalAlpha", "lineWidth", "lineCap", "lineJoin", "miterLimit", "globalCompositeOperation", "font", "filter"];
  for (const property of properties) {
    if (sourceCtx[property] !== undefined) {
      destCtx[property] = sourceCtx[property];
    }
  }
  if (sourceCtx.setLineDash !== undefined) {
    destCtx.setLineDash(sourceCtx.getLineDash());
    destCtx.lineDashOffset = sourceCtx.lineDashOffset;
  }
}
function setAnnotationCanvasName(canvas, canvasName) {
  canvas.setAttribute?.("data-canvas-name", canvasName);
  canvas._pdfjsCanvasName = canvasName;
}
function getAnnotationCanvasName(canvas) {
  return canvas._pdfjsCanvasName ?? null;
}
function resetCtxToDefault(ctx) {
  ctx.strokeStyle = ctx.fillStyle = "#000000";
  ctx.fillRule = "nonzero";
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.miterLimit = 10;
  ctx.globalCompositeOperation = "source-over";
  ctx.font = "10px sans-serif";
  if (ctx.setLineDash !== undefined) {
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }
  const {
    filter
  } = ctx;
  if (filter !== "none" && filter !== "") {
    ctx.filter = "none";
  }
}
class TransferMapsFallback {
  #maps;
  constructor(maps) {
    const [mapR, mapG = mapR, mapB = mapR] = maps;
    const identityMap = Util.identity0to256Map.slice();
    this.#maps = [mapR || identityMap, mapG || identityMap, mapB || identityMap];
  }
  applyToColor(color) {
    if (typeof color !== "string" || !color.startsWith("#")) {
      return color;
    }
    const [r, g, b] = getRGBA(color);
    const [mapR, mapG, mapB] = this.#maps;
    return Util.makeHexColor(mapR[r], mapG[g], mapB[b]);
  }
  applyToImageData({
    data
  }) {
    const [mapR, mapG, mapB] = this.#maps;
    for (let i = 0, ii = data.length; i < ii; i += 4) {
      data[i] = mapR[data[i]];
      data[i + 1] = mapG[data[i + 1]];
      data[i + 2] = mapB[data[i + 2]];
    }
  }
  applyToCanvas(ctx) {
    const {
      width,
      height
    } = ctx.canvas;
    const imgData = ctx.getImageData(0, 0, width, height);
    this.applyToImageData(imgData);
    ctx.putImageData(imgData, 0, 0);
  }
}
function getImageSmoothingEnabled(transform, interpolate, pixelRatio) {
  if (interpolate) {
    return true;
  }
  Util.singularValueDecompose2dScale(transform, XY);
  const actualScale = Math.fround(pixelRatio * PixelsPerInch.PDF_TO_CSS_UNITS);
  return XY[0] <= actualScale && XY[1] <= actualScale;
}
const LINE_CAP_STYLES = ["butt", "round", "square"];
const LINE_JOIN_STYLES = ["miter", "round", "bevel"];
const NORMAL_CLIP = {};
const EO_CLIP = {};
class CanvasGraphics {
  static #SCALE_MATRIX = null;
  static #pathCaches = new WeakMap();
  #knockoutGroupLevel = 0;
  #knockoutElementDepth = 0;
  #knockoutTempCanvasEntry = null;
  #knockoutSavedCtx = null;
  #knockoutSavedSMaskCtx = null;
  #knockoutSavedGCO = null;
  #knockoutElementAlpha = 1;
  #knockoutFilterCache;
  #knockoutElementGroupMeta = null;
  #groupStackMeta = [];
  constructor(canvasCtx, commonObjs, objs, canvasFactory, filterFactory, {
    optionalContentConfig,
    markedContentStack = null,
    pixelRatio = OutputScale.pixelRatio
  }, annotationCanvasMap, pageColors, dependencyTracker, imagesTracker) {
    this.ctx = canvasCtx;
    this.current = new CanvasExtraState(this.ctx.canvas.width, this.ctx.canvas.height);
    this.stateStack = [];
    this.pendingClip = null;
    this.pendingEOFill = false;
    this.commonObjs = commonObjs;
    this.objs = objs;
    this.canvasFactory = canvasFactory;
    this.filterFactory = filterFactory;
    this.groupStack = [];
    this.baseTransform = null;
    this.baseTransformStack = [];
    this.groupLevel = 0;
    this.smaskStack = [];
    this.tempSMask = null;
    this.smaskGroupCanvases = [];
    this.smaskPreparedEntry = null;
    this.smaskPreparedFor = null;
    this.smaskPreparedOffsetX = 0;
    this.smaskPreparedOffsetY = 0;
    this.smaskPreparedOOBAlpha = null;
    this.suspendedCtx = null;
    this.contentVisible = true;
    this.markedContentStack = markedContentStack || [];
    this.optionalContentConfig = optionalContentConfig;
    this.pixelRatio = pixelRatio;
    this.cachedPatterns = new Map();
    this.annotationCanvasMap = annotationCanvasMap;
    this.viewportScale = 1;
    this.outputScaleX = 1;
    this.outputScaleY = 1;
    this.pageColors = pageColors;
    this._cachedScaleForStroking = [-1, 0];
    this._cachedBitmapsMap = new Map();
    this.dependencyTracker = dependencyTracker ?? null;
    this.imagesTracker = imagesTracker ?? null;
  }
  getObject(opIdx, data, fallback = null) {
    if (typeof data === "string") {
      this.dependencyTracker?.recordNamedDependency(opIdx, data);
      return data.startsWith("g_") ? this.commonObjs.get(data) : this.objs.get(data);
    }
    return fallback;
  }
  beginDrawing({
    transform,
    viewport,
    transparency = false,
    background = null
  }) {
    const width = this.ctx.canvas.width;
    const height = this.ctx.canvas.height;
    const savedFillStyle = this.ctx.fillStyle;
    this.ctx.fillStyle = background || "#ffffff";
    this.ctx.fillRect(0, 0, width, height);
    this.ctx.fillStyle = savedFillStyle;
    if (transparency) {
      const transparentCanvas = this.transparentCanvasEntry = this.canvasFactory.create(width, height);
      this.compositeCtx = this.ctx;
      ({
        canvas: this.transparentCanvas,
        context: this.ctx
      } = transparentCanvas);
      this.ctx.save();
      this.ctx.transform(...getCurrentTransform(this.compositeCtx));
    }
    this.ctx.save();
    resetCtxToDefault(this.ctx);
    if (transform) {
      this.ctx.transform(...transform);
      this.outputScaleX = transform[0];
      this.outputScaleY = transform[3];
    }
    this.ctx.transform(...viewport.transform);
    this.viewportScale = viewport.scale;
    this.baseTransform = getCurrentTransform(this.ctx);
  }
  executeOperatorList(operatorList, executionStartIdx, continueCallback, errorCallback, stepper, operationsFilter) {
    const argsArray = operatorList.argsArray;
    const fnArray = operatorList.fnArray;
    const prevPathCache = this._pathCache;
    this._pathCache = operatorList.pathCache ?? CanvasGraphics.#pathCaches.getOrInsertComputed(operatorList, makeMap);
    try {
      let i = executionStartIdx || 0;
      const argsArrayLen = argsArray.length;
      if (argsArrayLen === i) {
        return i;
      }
      const chunkOperations = argsArrayLen - i > EXECUTION_STEPS && typeof continueCallback === "function";
      const endTime = chunkOperations ? Date.now() + EXECUTION_TIME : 0;
      let steps = 0;
      const commonObjs = this.commonObjs;
      const objs = this.objs;
      let fnId, fnArgs;
      while (true) {
        if (stepper !== undefined) {
          if (i === stepper.nextBreakPoint) {
            stepper.breakIt(i, continueCallback);
            return i;
          }
          if (stepper.shouldSkip(i)) {
            if (++i === argsArrayLen) {
              return i;
            }
            continue;
          }
        }
        if (!operationsFilter || operationsFilter(i, operatorList)) {
          fnId = fnArray[i];
          fnArgs = argsArray[i] ?? null;
          if (fnId !== OPS.dependency) {
            if (fnArgs === null) {
              this[fnId](i);
            } else {
              this[fnId](i, ...fnArgs);
            }
          } else {
            for (const depObjId of fnArgs) {
              this.dependencyTracker?.recordNamedData(depObjId, i);
              const objsPool = depObjId.startsWith("g_") ? commonObjs : objs;
              if (!objsPool.has(depObjId)) {
                objsPool.get(depObjId, continueCallback, errorCallback);
                return i;
              }
            }
          }
        }
        i++;
        if (i === argsArrayLen) {
          return i;
        }
        if (chunkOperations && ++steps > EXECUTION_STEPS) {
          if (Date.now() > endTime) {
            continueCallback();
            return i;
          }
          steps = 0;
        }
      }
    } finally {
      this._pathCache = prevPathCache;
    }
  }
  #restoreInitialState() {
    while (this.stateStack.length || this.inSMaskMode) {
      this.restore();
    }
    this.current.activeSMask = null;
    this.ctx.restore();
    if (this.transparentCanvas) {
      this.ctx = this.compositeCtx;
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.drawImage(this.transparentCanvas, 0, 0);
      this.ctx.restore();
      this.canvasFactory.destroy(this.transparentCanvasEntry);
      this.transparentCanvas = null;
      this.transparentCanvasEntry = null;
    }
  }
  endDrawing() {
    this.#restoreInitialState();
    for (const canvas of this.smaskGroupCanvases) {
      this.canvasFactory.destroy(canvas);
    }
    this.smaskGroupCanvases.length = 0;
    this._clearPreparedSMask();
    this.tempSMask = null;
    this.smaskStack.length = 0;
    for (const meta of this.#groupStackMeta) {
      this.#destroyKnockoutPools(meta);
    }
    this.#groupStackMeta.length = 0;
    this.#knockoutTempCanvasEntry = null;
    this.#knockoutSavedCtx = null;
    this.#knockoutSavedSMaskCtx = null;
    this.#knockoutSavedGCO = null;
    this.#knockoutElementAlpha = 1;
    this.#knockoutElementGroupMeta = null;
    this.#knockoutElementDepth = 0;
    this.#knockoutGroupLevel = 0;
    this.cachedPatterns.clear();
    for (const cache of this._cachedBitmapsMap.values()) {
      for (const canvas of cache.values()) {
        if (typeof HTMLCanvasElement !== "undefined" && canvas instanceof HTMLCanvasElement) {
          canvas.width = canvas.height = 0;
        }
      }
      cache.clear();
    }
    this._cachedBitmapsMap.clear();
    this.#drawFilter();
  }
  #drawFilter() {
    if (this.pageColors) {
      const hcmFilterId = this.filterFactory.addHCMFilter(this.pageColors.foreground, this.pageColors.background);
      if (hcmFilterId !== "none") {
        const savedFilter = this.ctx.filter;
        this.ctx.filter = hcmFilterId;
        this.ctx.drawImage(this.ctx.canvas, 0, 0);
        this.ctx.filter = savedFilter;
      }
    }
  }
  _scaleImage(img, inverseTransform) {
    const width = img.width ?? img.displayWidth;
    const height = img.height ?? img.displayHeight;
    const widthScale = Math.max(Math.hypot(inverseTransform[0], inverseTransform[1]), 1);
    const heightScale = Math.max(Math.hypot(inverseTransform[2], inverseTransform[3]), 1);
    const scaleSteps = [];
    let ws = widthScale,
      hs = heightScale,
      pw = width,
      ph = height;
    while (ws > 2 && pw > 1 || hs > 2 && ph > 1) {
      let nw = pw,
        nh = ph;
      if (ws > 2 && pw > 1) {
        nw = Math.ceil(pw / 2);
        ws /= pw / nw;
      }
      if (hs > 2 && ph > 1) {
        nh = Math.ceil(ph / 2);
        hs /= ph / nh;
      }
      scaleSteps.push({
        newWidth: nw,
        newHeight: nh
      });
      pw = nw;
      ph = nh;
    }
    if (scaleSteps.length === 0) {
      return {
        img,
        paintWidth: width,
        paintHeight: height,
        tmpCanvas: null
      };
    }
    if (scaleSteps.length === 1) {
      const {
        newWidth,
        newHeight
      } = scaleSteps[0];
      const tmpCanvas = this.canvasFactory.create(newWidth, newHeight);
      tmpCanvas.context.drawImage(img, 0, 0, width, height, 0, 0, newWidth, newHeight);
      return {
        img: tmpCanvas.canvas,
        paintWidth: newWidth,
        paintHeight: newHeight,
        tmpCanvas
      };
    }
    let readEntry = this.canvasFactory.create(1, 1);
    let writeEntry = this.canvasFactory.create(1, 1);
    let paintWidth = width,
      paintHeight = height;
    let source = img;
    for (const {
      newWidth,
      newHeight
    } of scaleSteps) {
      this.canvasFactory.reset(writeEntry, newWidth, newHeight);
      writeEntry.context.drawImage(source, 0, 0, paintWidth, paintHeight, 0, 0, newWidth, newHeight);
      [readEntry, writeEntry] = [writeEntry, readEntry];
      source = readEntry.canvas;
      paintWidth = newWidth;
      paintHeight = newHeight;
    }
    this.canvasFactory.destroy(writeEntry);
    return {
      img: readEntry.canvas,
      paintWidth,
      paintHeight,
      tmpCanvas: readEntry
    };
  }
  _createMaskCanvas(opIdx, img) {
    const ctx = this.ctx;
    const {
      width,
      height
    } = img;
    const isPatternFill = this.current.patternFill;
    const fillColor = isPatternFill ? this.current.fillColor : ctx.fillStyle;
    const currentTransform = getCurrentTransform(ctx);
    let cache, cacheKey, scaled, maskCanvas;
    if ((img.bitmap || img.data) && img.count > 1) {
      const mainKey = img.bitmap || img.data.buffer;
      cacheKey = JSON.stringify(isPatternFill ? currentTransform : [currentTransform.slice(0, 4), fillColor]);
      cache = this._cachedBitmapsMap.getOrInsertComputed(mainKey, makeMap);
      const cachedImage = cache.get(cacheKey);
      if (cachedImage && !isPatternFill) {
        const offsetX = Math.round(Math.min(currentTransform[0], currentTransform[2]) + currentTransform[4]);
        const offsetY = Math.round(Math.min(currentTransform[1], currentTransform[3]) + currentTransform[5]);
        this.dependencyTracker?.recordDependencies(opIdx, Dependencies.transformAndFill);
        return {
          canvas: cachedImage,
          offsetX,
          offsetY
        };
      }
      scaled = cachedImage;
    }
    if (!scaled) {
      maskCanvas = this.canvasFactory.create(width, height);
      putBinaryImageMask(maskCanvas.context, img);
    }
    let maskToCanvas = Util.transform(currentTransform, [1 / width, 0, 0, -1 / height, 0, 0]);
    maskToCanvas = Util.transform(maskToCanvas, [1, 0, 0, 1, 0, -height]);
    const minMax = F32_BBOX_INIT.slice();
    Util.axialAlignedBoundingBox([0, 0, width, height], maskToCanvas, minMax);
    const [minX, minY, maxX, maxY] = minMax;
    const drawnWidth = Math.round(maxX - minX) || 1;
    const drawnHeight = Math.round(maxY - minY) || 1;
    const fillCanvas = this.canvasFactory.create(drawnWidth, drawnHeight);
    const fillCtx = fillCanvas.context;
    const offsetX = minX;
    const offsetY = minY;
    fillCtx.translate(-offsetX, -offsetY);
    fillCtx.transform(...maskToCanvas);
    let scaledEntry = null;
    if (!scaled) {
      const scaleResult = this._scaleImage(maskCanvas.canvas, getCurrentTransformInverse(fillCtx));
      scaled = scaleResult.img;
      scaledEntry = scaleResult.tmpCanvas;
      if (scaled !== maskCanvas.canvas) {
        this.canvasFactory.destroy(maskCanvas);
        maskCanvas = null;
      }
      if (cache && isPatternFill) {
        cache.set(cacheKey, scaled);
        scaledEntry = null;
        maskCanvas = null;
      }
    }
    fillCtx.imageSmoothingEnabled = getImageSmoothingEnabled(getCurrentTransform(fillCtx), img.interpolate, this.pixelRatio);
    drawImageAtIntegerCoords(fillCtx, scaled, 0, 0, scaled.width, scaled.height, 0, 0, width, height);
    if (scaledEntry) {
      this.canvasFactory.destroy(scaledEntry);
    }
    if (maskCanvas) {
      this.canvasFactory.destroy(maskCanvas);
    }
    fillCtx.globalCompositeOperation = "source-in";
    const inverse = Util.transform(getCurrentTransformInverse(fillCtx), [1, 0, 0, 1, -offsetX, -offsetY]);
    fillCtx.fillStyle = isPatternFill ? fillColor.getPattern(ctx, this, inverse, PathType.FILL, opIdx) : fillColor;
    fillCtx.fillRect(0, 0, width, height);
    if (cache && !isPatternFill) {
      cache.set(cacheKey, fillCanvas.canvas);
    }
    this.dependencyTracker?.recordDependencies(opIdx, Dependencies.transformAndFill);
    return {
      canvas: fillCanvas.canvas,
      canvasEntry: cache && !isPatternFill ? null : fillCanvas,
      offsetX: Math.round(offsetX),
      offsetY: Math.round(offsetY)
    };
  }
  setLineWidth(opIdx, width) {
    this.dependencyTracker?.recordSimpleData("lineWidth", opIdx);
    if (width !== this.current.lineWidth) {
      this._cachedScaleForStroking[0] = -1;
    }
    this.current.lineWidth = width;
    this.ctx.lineWidth = width;
  }
  setLineCap(opIdx, style) {
    this.dependencyTracker?.recordSimpleData("lineCap", opIdx);
    this.ctx.lineCap = LINE_CAP_STYLES[style];
  }
  setLineJoin(opIdx, style) {
    this.dependencyTracker?.recordSimpleData("lineJoin", opIdx);
    this.ctx.lineJoin = LINE_JOIN_STYLES[style];
  }
  setMiterLimit(opIdx, limit) {
    this.dependencyTracker?.recordSimpleData("miterLimit", opIdx);
    this.ctx.miterLimit = limit;
  }
  setDash(opIdx, dashArray, dashPhase) {
    this.dependencyTracker?.recordSimpleData("dash", opIdx);
    const ctx = this.ctx;
    if (ctx.setLineDash !== undefined) {
      ctx.setLineDash(dashArray);
      ctx.lineDashOffset = dashPhase;
    }
  }
  setRenderingIntent(opIdx, intent) {}
  setFlatness(opIdx, flatness) {}
  setGState(opIdx, states) {
    for (const [key, value] of states) {
      switch (key) {
        case "LW":
          this.setLineWidth(opIdx, value);
          break;
        case "LC":
          this.setLineCap(opIdx, value);
          break;
        case "LJ":
          this.setLineJoin(opIdx, value);
          break;
        case "ML":
          this.setMiterLimit(opIdx, value);
          break;
        case "D":
          this.setDash(opIdx, value[0], value[1]);
          break;
        case "RI":
          this.setRenderingIntent(opIdx, value);
          break;
        case "FL":
          this.setFlatness(opIdx, value);
          break;
        case "Font":
          this.setFont(opIdx, value[0], value[1]);
          break;
        case "CA":
          this.dependencyTracker?.recordSimpleData("strokeAlpha", opIdx);
          this.current.strokeAlpha = value;
          break;
        case "ca":
          this.dependencyTracker?.recordSimpleData("fillAlpha", opIdx);
          this.ctx.globalAlpha = this.current.fillAlpha = value;
          break;
        case "BM":
          this.dependencyTracker?.recordSimpleData("globalCompositeOperation", opIdx);
          this.ctx.globalCompositeOperation = value;
          break;
        case "SMask":
          this.dependencyTracker?.recordSimpleData("SMask", opIdx);
          this.current.activeSMask = value ? this.tempSMask : null;
          if (this.current.activeSMask) {
            this.current.activeSMask.blendMode = this.ctx.globalCompositeOperation;
          }
          this.tempSMask = null;
          this.checkSMaskState(opIdx);
          break;
        case "TR":
          {
            this.dependencyTracker?.recordSimpleData("filter", opIdx);
            let filter = this.filterFactory.addFilter(value);
            this.ctx.filter = filter;
            let fallback = null;
            if (value && (filter === "none" || !FeatureTest.isCanvasFilterSupported || this.ctx.filter === "none" || this.ctx.filter === "")) {
              this.ctx.filter = filter = "none";
              fallback = new TransferMapsFallback(value);
            }
            this.current.transferMaps = filter;
            if (fallback || this.current.transferMapsFallback) {
              this.current.transferMapsFallback = fallback;
              if (!this.current.patternFill) {
                this.ctx.fillStyle = this.#transferColor(this.current.fillColor);
              }
              if (!this.current.patternStroke) {
                this.ctx.strokeStyle = this.#transferColor(this.current.strokeColor);
              }
            }
            break;
          }
      }
    }
  }
  get inSMaskMode() {
    return !!this.suspendedCtx;
  }
  _clearPreparedSMask() {
    if (this.smaskPreparedEntry) {
      this.canvasFactory.destroy(this.smaskPreparedEntry);
      this.smaskPreparedEntry = null;
    }
    this.smaskPreparedFor = null;
    this.smaskPreparedOffsetX = 0;
    this.smaskPreparedOffsetY = 0;
    this.smaskPreparedOOBAlpha = null;
  }
  _ensurePreparedSMask(smask) {
    if (smask === this.smaskPreparedFor) {
      return;
    }
    this._clearPreparedSMask();
    this._prepareSMaskCanvas(smask);
  }
  checkSMaskState(opIdx) {
    const inSMaskMode = this.inSMaskMode;
    if (this.current.activeSMask && !inSMaskMode) {
      this.beginSMaskMode(opIdx);
    } else if (!this.current.activeSMask && inSMaskMode) {
      this.endSMaskMode();
    } else if (this.current.activeSMask && inSMaskMode) {
      this._ensurePreparedSMask(this.current.activeSMask);
    }
  }
  _prepareSMaskCanvas(smask) {
    const {
      canvas: maskCanvas,
      subtype,
      backdrop,
      transferMap
    } = smask;
    const hasFilter = subtype === "Luminosity" || subtype === "Alpha" && transferMap;
    if (!hasFilter && !(subtype === "Luminosity" && backdrop)) {
      this.smaskPreparedFor = smask;
      return;
    }
    let filteredOOBAlpha;
    if (subtype === "Luminosity" && backdrop) {
      const [r, g, b] = getRGBA(backdrop);
      const inputAlpha = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
      filteredOOBAlpha = transferMap?.[inputAlpha] ?? inputAlpha;
    } else {
      filteredOOBAlpha = transferMap?.[0] ?? 0;
    }
    const SMASK_LAYER_TO_MASK_AREA_RATIO = 4;
    const {
      width: layerW,
      height: layerH
    } = this.ctx.canvas;
    const maskArea = maskCanvas.width * maskCanvas.height;
    const useLayerSize = layerW * layerH < SMASK_LAYER_TO_MASK_AREA_RATIO * maskArea;
    const filterSpec = hasFilter ? {
      url: subtype === "Alpha" ? this.filterFactory.addAlphaFilter(transferMap) : this.filterFactory.addLuminosityFilter(transferMap),
      subtype,
      transferMap
    } : null;
    const bakedBackdrop = subtype === "Luminosity" ? backdrop : null;
    let preparedEntry, offsetX, offsetY;
    if (useLayerSize) {
      preparedEntry = this._bakeSMaskCanvas(maskCanvas, smask.offsetX, smask.offsetY, layerW, layerH, bakedBackdrop, filterSpec);
      offsetX = 0;
      offsetY = 0;
    } else {
      preparedEntry = this._bakeSMaskCanvas(maskCanvas, 0, 0, maskCanvas.width, maskCanvas.height, bakedBackdrop, filterSpec);
      offsetX = smask.offsetX;
      offsetY = smask.offsetY;
    }
    this.smaskPreparedEntry = preparedEntry;
    this.smaskPreparedFor = smask;
    this.smaskPreparedOffsetX = offsetX;
    this.smaskPreparedOffsetY = offsetY;
    this.smaskPreparedOOBAlpha = !useLayerSize && filteredOOBAlpha !== 0 ? filteredOOBAlpha : null;
  }
  _bakeSMaskCanvas(maskCanvas, drawX, drawY, w, h, backdrop, filterSpec) {
    if (!backdrop && !filterSpec) {
      unreachable("_bakeSMaskCanvas with neither backdrop nor filter");
    }
    const srcEntry = this.canvasFactory.create(w, h);
    const sCtx = srcEntry.context;
    sCtx.drawImage(maskCanvas, drawX, drawY);
    if (backdrop) {
      sCtx.globalCompositeOperation = "destination-atop";
      sCtx.fillStyle = backdrop;
      sCtx.fillRect(0, 0, w, h);
    }
    if (!filterSpec) {
      return srcEntry;
    }
    const preparedEntry = this.canvasFactory.create(w, h);
    const pCtx = preparedEntry.context;
    pCtx.filter = filterSpec.url;
    const filterApplied = FeatureTest.isCanvasFilterSupported && pCtx.filter !== "none" && pCtx.filter !== "";
    pCtx.drawImage(srcEntry.canvas, 0, 0);
    if (FeatureTest.isCanvasFilterSupported) {
      pCtx.filter = "none";
    }
    if (!filterApplied) {
      const img = pCtx.getImageData(0, 0, w, h);
      const {
        data
      } = img;
      const {
        transferMap
      } = filterSpec;
      if (filterSpec.subtype === "Luminosity") {
        for (let i = 0, ii = data.length; i < ii; i += 4) {
          const a = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2] + 0.5 | 0;
          data[i] = data[i + 1] = data[i + 2] = 0;
          data[i + 3] = transferMap?.[a] ?? a;
        }
      } else {
        for (let i = 3, ii = data.length; i < ii; i += 4) {
          data[i] = transferMap[data[i]];
        }
      }
      pCtx.putImageData(img, 0, 0);
    }
    this.canvasFactory.destroy(srcEntry);
    return preparedEntry;
  }
  beginSMaskMode(opIdx) {
    if (this.inSMaskMode) {
      throw new Error("beginSMaskMode called while already in smask mode");
    }
    const {
      width: drawnWidth,
      height: drawnHeight
    } = this.ctx.canvas;
    const scratchCanvas = this.canvasFactory.create(drawnWidth, drawnHeight);
    this.smaskScratchCanvas = scratchCanvas;
    this.suspendedCtx = this.ctx;
    const ctx = this.ctx = scratchCanvas.context;
    ctx.setTransform(this.suspendedCtx.getTransform());
    copyCtxState(this.suspendedCtx, ctx);
    mirrorContextOperations(ctx, this.suspendedCtx);
    this._ensurePreparedSMask(this.current.activeSMask);
    this.setGState(opIdx, [["BM", "source-over"]]);
  }
  endSMaskMode() {
    if (!this.inSMaskMode) {
      throw new Error("endSMaskMode called while not in smask mode");
    }
    this.ctx._removeMirroring();
    copyCtxState(this.ctx, this.suspendedCtx);
    this.ctx = this.suspendedCtx;
    this.suspendedCtx = null;
    this.canvasFactory.destroy(this.smaskScratchCanvas);
    this.smaskScratchCanvas = null;
    this._clearPreparedSMask();
  }
  #createKnockoutMaskCanvas(sourceCanvas, reuseEntry = null, alpha = 1) {
    const {
      width,
      height
    } = sourceCanvas;
    const maskEntry = reuseEntry ?? this.canvasFactory.create(width, height);
    const maskCtx = maskEntry.context;
    alpha = Math.round(alpha * 255) / 255;
    const needsAlphaScaling = alpha < 1;
    if (needsAlphaScaling && this.#knockoutFilterCache === undefined) {
      this.#knockoutFilterCache = FeatureTest.isCanvasFilterSupported ? new Map() : "none";
    }
    let knockoutFilter = "none";
    if (needsAlphaScaling && this.#knockoutFilterCache instanceof Map) {
      knockoutFilter = this.#knockoutFilterCache.getOrInsertComputed(alpha, () => this.filterFactory.addKnockoutFilter(alpha));
    }
    if (!needsAlphaScaling || knockoutFilter !== "none") {
      if (reuseEntry) {
        maskCtx.save();
        maskCtx.setTransform(1, 0, 0, 1, 0, 0);
        maskCtx.clearRect(0, 0, width, height);
        maskCtx.restore();
      }
      maskCtx.filter = knockoutFilter;
      maskCtx.drawImage(sourceCanvas, 0, 0);
      maskCtx.filter = "none";
      return maskEntry;
    }
    const sourceData = sourceCanvas.getContext("2d", {
      willReadFrequently: true
    }).getImageData(0, 0, width, height);
    const maskData = maskCtx.createImageData(width, height);
    const sourcePixels = sourceData.data,
      maskPixels = maskData.data;
    const alphaScale = alpha > 0 ? 1 / alpha : 1e6;
    for (let i = 3, ii = sourcePixels.length; i < ii; i += 4) {
      maskPixels[i] = Math.min(Math.round(sourcePixels[i] * alphaScale), 255);
    }
    maskCtx.putImageData(maskData, 0, 0);
    return maskEntry;
  }
  #getOrCreatePooledEntry(meta, key, width, height) {
    let entry = meta?.[key] ?? null;
    if (entry && (entry.canvas.width !== width || entry.canvas.height !== height)) {
      this.canvasFactory.destroy(entry);
      entry = null;
    }
    if (!entry) {
      entry = this.canvasFactory.create(width, height);
      if (meta) {
        meta[key] = entry;
      }
      return entry;
    }
    const ctx = entry.context;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.restore();
    return entry;
  }
  #compositeKnockoutSurface(destCtx, surfaceCanvas, options = {}) {
    const {
      backdropCanvas = null,
      destTransform = [1, 0, 0, 1, 0, 0],
      backdropOffset = [0, 0],
      reuseMaskEntry = null,
      poolMeta = null,
      sourceAlpha = 1,
      sourceFilter = "none",
      knockoutAlpha = 1
    } = options;
    const {
      width,
      height
    } = surfaceCanvas;
    const knockoutMaskEntry = this.#createKnockoutMaskCanvas(surfaceCanvas, reuseMaskEntry, knockoutAlpha);
    const sourceCompositeOperation = destCtx.globalCompositeOperation;
    destCtx.save();
    destCtx.setTransform(...destTransform);
    destCtx.globalAlpha = 1;
    if (FeatureTest.isCanvasFilterSupported) {
      destCtx.filter = "none";
    }
    destCtx.globalCompositeOperation = "destination-out";
    destCtx.drawImage(knockoutMaskEntry.canvas, 0, 0);
    if (backdropCanvas) {
      const [bx, by] = backdropOffset;
      const backdropEntry = this.#getOrCreatePooledEntry(poolMeta, "knockoutBackdropEntry", width, height);
      const backdropCtx = backdropEntry.context;
      backdropCtx.drawImage(backdropCanvas, bx, by, width, height, 0, 0, width, height);
      backdropCtx.globalCompositeOperation = "destination-in";
      backdropCtx.drawImage(knockoutMaskEntry.canvas, 0, 0);
      backdropCtx.globalCompositeOperation = "source-over";
      destCtx.globalCompositeOperation = "destination-over";
      destCtx.drawImage(backdropEntry.canvas, 0, 0);
      if (!poolMeta) {
        this.canvasFactory.destroy(backdropEntry);
      }
    }
    destCtx.globalCompositeOperation = sourceCompositeOperation;
    destCtx.globalAlpha = sourceAlpha;
    if (FeatureTest.isCanvasFilterSupported) {
      destCtx.filter = sourceFilter ?? "none";
    }
    destCtx.drawImage(surfaceCanvas, 0, 0);
    destCtx.restore();
    if (!reuseMaskEntry) {
      this.canvasFactory.destroy(knockoutMaskEntry);
    }
  }
  #beginKnockoutElement(alpha = 1) {
    if (this.#knockoutGroupLevel === 0 || this.#knockoutElementDepth > 0 || !this.contentVisible) {
      return false;
    }
    this.#knockoutElementDepth++;
    this.#knockoutElementAlpha = alpha;
    const groupMeta = this.#groupStackMeta.at(-1);
    const {
      canvas
    } = this.ctx;
    const tempEntry = this.#getOrCreatePooledEntry(groupMeta, "knockoutTempEntry", canvas.width, canvas.height);
    this.#knockoutTempCanvasEntry = tempEntry;
    const tempCtx = tempEntry.context;
    tempCtx.save();
    tempCtx.setTransform(this.ctx.getTransform());
    copyCtxState(this.ctx, tempCtx);
    this.#knockoutSavedGCO = tempCtx.globalCompositeOperation;
    tempCtx.globalCompositeOperation = "source-over";
    mirrorContextOperations(tempCtx, this.ctx);
    this.#knockoutElementGroupMeta = groupMeta;
    this.#knockoutSavedCtx = this.ctx;
    this.#knockoutSavedSMaskCtx = this.suspendedCtx;
    this.ctx = tempCtx;
    if (this.inSMaskMode) {
      this.suspendedCtx = tempCtx;
    }
    return true;
  }
  #endKnockoutElement(started) {
    if (!started) {
      return;
    }
    const tempEntry = this.#knockoutTempCanvasEntry;
    const savedCtx = this.#knockoutSavedCtx;
    const savedSMaskCtx = this.#knockoutSavedSMaskCtx;
    const tempCtx = tempEntry.context;
    this.#knockoutTempCanvasEntry = null;
    this.#knockoutSavedCtx = null;
    this.#knockoutSavedSMaskCtx = null;
    if (this.inSMaskMode && this.suspendedCtx === tempCtx && this.ctx !== tempCtx) {
      this.endSMaskMode();
    }
    if (this.inSMaskMode) {
      this.suspendedCtx = savedSMaskCtx;
    }
    this.ctx._removeMirroring();
    this.ctx.globalCompositeOperation = this.#knockoutSavedGCO;
    this.#knockoutSavedGCO = null;
    copyCtxState(this.ctx, savedCtx);
    this.ctx = savedCtx;
    const groupMeta = this.#knockoutElementGroupMeta;
    this.#knockoutElementGroupMeta = null;
    const knockoutAlpha = this.#knockoutElementAlpha;
    this.#knockoutElementAlpha = 1;
    try {
      this.#compositeKnockoutSurface(savedSMaskCtx ?? savedCtx, tempEntry.canvas, {
        backdropCanvas: groupMeta?.backdropCtx?.canvas ?? null,
        backdropOffset: groupMeta?.backdropCtx ? [groupMeta.offsetX, groupMeta.offsetY] : [0, 0],
        reuseMaskEntry: groupMeta?.knockoutMaskEntry ?? null,
        poolMeta: groupMeta,
        knockoutAlpha
      });
    } finally {
      tempCtx.restore();
      this.#knockoutElementDepth--;
      if (!groupMeta) {
        this.canvasFactory.destroy(tempEntry);
      }
    }
  }
  compose(dirtyBox) {
    if (!this.current.activeSMask) {
      return;
    }
    dirtyBox = dirtyBox ? [Math.floor(dirtyBox[0]), Math.floor(dirtyBox[1]), Math.ceil(dirtyBox[2]), Math.ceil(dirtyBox[3])] : [0, 0, this.ctx.canvas.width, this.ctx.canvas.height];
    const smask = this.current.activeSMask;
    const suspendedCtx = this.suspendedCtx;
    const applySMaskInPlace = this.#knockoutElementDepth > 0 && suspendedCtx === this.ctx;
    this.composeSMask(applySMaskInPlace ? null : suspendedCtx, smask, this.ctx, dirtyBox);
    if (applySMaskInPlace) {
      return;
    }
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    this.ctx.restore();
  }
  composeSMask(ctx, smask, layerCtx, layerBox) {
    const layerOffsetX = layerBox[0];
    const layerOffsetY = layerBox[1];
    const layerWidth = layerBox[2] - layerOffsetX;
    const layerHeight = layerBox[3] - layerOffsetY;
    if (layerWidth === 0 || layerHeight === 0) {
      return;
    }
    const preparedEntry = this.smaskPreparedEntry;
    if (preparedEntry) {
      let clipX = layerOffsetX;
      let clipY = layerOffsetY;
      let clipW = layerWidth;
      let clipH = layerHeight;
      const oobAlpha = this.smaskPreparedOOBAlpha;
      const hasOOBAlpha = oobAlpha !== null;
      if (hasOOBAlpha) {
        clipX = Math.max(layerOffsetX, smask.offsetX);
        clipY = Math.max(layerOffsetY, smask.offsetY);
        const x1 = Math.min(layerOffsetX + layerWidth, smask.offsetX + smask.canvas.width);
        const y1 = Math.min(layerOffsetY + layerHeight, smask.offsetY + smask.canvas.height);
        clipW = x1 - clipX;
        clipH = y1 - clipY;
      }
      if (clipW > 0 && clipH > 0) {
        const srcX = clipX - this.smaskPreparedOffsetX;
        const srcY = clipY - this.smaskPreparedOffsetY;
        layerCtx.save();
        layerCtx.globalAlpha = 1;
        layerCtx.setTransform(1, 0, 0, 1, 0, 0);
        const clip = new Path2D();
        clip.rect(clipX, clipY, clipW, clipH);
        layerCtx.clip(clip);
        layerCtx.globalCompositeOperation = "destination-in";
        layerCtx.drawImage(preparedEntry.canvas, srcX, srcY, clipW, clipH, clipX, clipY, clipW, clipH);
        layerCtx.restore();
      }
      if (hasOOBAlpha && oobAlpha < 255) {
        this._applySMaskOOBAlpha(layerCtx, layerOffsetX, layerOffsetY, layerWidth, layerHeight, clipX, clipY, clipX + clipW, clipY + clipH, oobAlpha);
      }
    } else {
      this.genericComposeSMask(smask, layerCtx, layerWidth, layerHeight, layerOffsetX, layerOffsetY);
    }
    if (!ctx) {
      return;
    }
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = smask.blendMode || "source-over";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layerCtx.canvas, layerOffsetX, layerOffsetY, layerWidth, layerHeight, layerOffsetX, layerOffsetY, layerWidth, layerHeight);
    ctx.restore();
  }
  _applySMaskOOBAlpha(layerCtx, layerOffsetX, layerOffsetY, layerWidth, layerHeight, maskX0, maskY0, maskX1, maskY1, alpha) {
    const hasInnerCutout = maskX0 < maskX1 && maskY0 < maskY1;
    if (hasInnerCutout && maskX0 === layerOffsetX && maskY0 === layerOffsetY && maskX1 === layerOffsetX + layerWidth && maskY1 === layerOffsetY + layerHeight) {
      return;
    }
    const path = new Path2D();
    path.rect(layerOffsetX, layerOffsetY, layerWidth, layerHeight);
    if (hasInnerCutout) {
      path.rect(maskX0, maskY0, maskX1 - maskX0, maskY1 - maskY0);
    }
    layerCtx.save();
    layerCtx.globalAlpha = alpha / 255;
    layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    layerCtx.clip(path, "evenodd");
    layerCtx.globalCompositeOperation = "destination-in";
    layerCtx.fillStyle = "#000000";
    layerCtx.fillRect(layerOffsetX, layerOffsetY, layerWidth, layerHeight);
    layerCtx.restore();
  }
  genericComposeSMask(smask, layerCtx, width, height, layerOffsetX, layerOffsetY) {
    const {
      context: maskCtx,
      offsetX: maskOffsetX,
      offsetY: maskOffsetY
    } = smask;
    layerCtx.save();
    layerCtx.globalAlpha = 1;
    layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    const clip = new Path2D();
    clip.rect(layerOffsetX, layerOffsetY, width, height);
    layerCtx.clip(clip);
    layerCtx.globalCompositeOperation = "destination-in";
    layerCtx.drawImage(maskCtx.canvas, layerOffsetX - maskOffsetX, layerOffsetY - maskOffsetY, width, height, layerOffsetX, layerOffsetY, width, height);
    layerCtx.restore();
  }
  save(opIdx) {
    if (this.inSMaskMode) {
      copyCtxState(this.ctx, this.suspendedCtx);
    }
    this.ctx.save();
    const old = this.current;
    this.stateStack.push(old);
    this.current = old.clone();
    this.dependencyTracker?.save(opIdx);
  }
  restore(opIdx) {
    this.dependencyTracker?.restore(opIdx);
    if (this.stateStack.length === 0) {
      if (this.inSMaskMode) {
        this.endSMaskMode();
      }
      return;
    }
    this.current = this.stateStack.pop();
    this.ctx.restore();
    if (this.inSMaskMode) {
      copyCtxState(this.suspendedCtx, this.ctx);
      this.ctx.setTransform(this.suspendedCtx.getTransform());
    }
    this.checkSMaskState(opIdx);
    this.pendingClip = null;
    this._cachedScaleForStroking[0] = -1;
  }
  resetGraphicsState() {
    const {
      clipBox,
      transferMaps,
      transferMapsFallback
    } = this.current;
    const current = this.current = new CanvasExtraState(0, 0);
    current.clipBox = clipBox;
    current.transferMaps = transferMaps;
    current.transferMapsFallback = transferMapsFallback;
    const ctx = this.ctx;
    ctx.lineWidth = 1;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.miterLimit = 10;
    if (ctx.setLineDash !== undefined) {
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
    this._cachedScaleForStroking[0] = -1;
  }
  transform(opIdx, a, b, c, d, e, f) {
    this.dependencyTracker?.recordIncrementalData("transform", opIdx);
    this.ctx.transform(a, b, c, d, e, f);
    this._cachedScaleForStroking[0] = -1;
  }
  constructPath(opIdx, op, data, minMax) {
    let path = this._pathCache.get(opIdx);
    if (!minMax) {
      if (!path) {
        path = new Path2D();
        this._pathCache.set(opIdx, path);
      }
      if (op !== OPS.stroke && op !== OPS.closeStroke) {
        this.current.tilingPatternDims = null;
      }
      this[op](opIdx, path);
      return;
    }
    if (this.dependencyTracker !== null) {
      const outerExtraSize = op === OPS.stroke ? this.current.lineWidth / 2 : 0;
      this.dependencyTracker.resetBBox(opIdx).recordBBox(opIdx, this.ctx, minMax[0] - outerExtraSize, minMax[2] + outerExtraSize, minMax[1] - outerExtraSize, minMax[3] + outerExtraSize).recordDependencies(opIdx, ["transform"]);
    }
    if (!path) {
      path = makePathFromDrawOPS(data[0]);
      this._pathCache.set(opIdx, path);
    }
    Util.axialAlignedBoundingBox(minMax, getCurrentTransform(this.ctx), this.current.minMax);
    const tilingDims = this.current.tilingPatternDims;
    if (tilingDims && op !== OPS.stroke && op !== OPS.closeStroke && this.current.fillColor instanceof TilingPattern) {
      const clippedBBox = Util.intersect(this.current.clipBox, this.current.minMax);
      if (!clippedBBox) {
        this.current.tilingPatternDims = null;
      } else {
        this.current.fillColor.updatePatternDims(clippedBBox, tilingDims);
      }
    }
    this[op](opIdx, path);
    this._pathStartIdx = opIdx;
  }
  closePath(opIdx) {
    this.ctx.closePath();
  }
  stroke(opIdx, path, consumePath = true) {
    const started = consumePath && this.#beginKnockoutElement(this.current.strokeAlpha);
    const ctx = this.ctx;
    const strokeColor = this.current.strokeColor;
    ctx.globalAlpha = this.current.strokeAlpha;
    if (this.contentVisible) {
      if (typeof strokeColor === "object" && strokeColor?.getPattern) {
        const baseTransform = strokeColor.isModifyingCurrentTransform() ? ctx.getTransform() : null;
        ctx.save();
        ctx.strokeStyle = strokeColor.getPattern(ctx, this, getCurrentTransformInverse(ctx), PathType.STROKE, opIdx);
        if (baseTransform) {
          const newPath = new Path2D();
          newPath.addPath(path, ctx.getTransform().invertSelf().multiplySelf(baseTransform));
          path = newPath;
        }
        this.rescaleAndStroke(path, false);
        ctx.restore();
      } else {
        this.rescaleAndStroke(path, true);
      }
    }
    this.dependencyTracker?.recordDependencies(opIdx, Dependencies.stroke);
    if (consumePath) {
      this.consumePath(opIdx, path, this.current.getClippedPathBoundingBox(PathType.STROKE, getCurrentTransform(this.ctx)));
    }
    ctx.globalAlpha = this.current.fillAlpha;
    this.#endKnockoutElement(started);
  }
  closeStroke(opIdx, path) {
    this.stroke(opIdx, path);
  }
  fill(opIdx, path, consumePath = true) {
    const started = consumePath && this.#beginKnockoutElement(this.current.fillAlpha);
    const ctx = this.ctx;
    const fillColor = this.current.fillColor;
    const isPatternFill = this.current.patternFill;
    let needRestore = false;
    const intersect = this.current.getClippedPathBoundingBox();
    this.dependencyTracker?.recordDependencies(opIdx, Dependencies.fill);
    if (isPatternFill) {
      const dims = this.current.tilingPatternDims;
      const tileIdx = dims && fillColor.canSkipPatternCanvas(dims);
      if (tileIdx) {
        const {
          pendingClip,
          pendingEOFill
        } = this;
        this.pendingClip = null;
        this.pendingEOFill = false;
        fillColor.drawPattern(this, path, pendingEOFill, tileIdx, opIdx);
        this.pendingClip = pendingClip;
        if (consumePath) {
          this.consumePath(opIdx, path, intersect);
        }
        this.current.tilingPatternDims = null;
        this.#endKnockoutElement(started);
        return;
      }
      const baseTransform = fillColor.isModifyingCurrentTransform() ? ctx.getTransform() : null;
      this.dependencyTracker?.save(opIdx);
      ctx.save();
      ctx.fillStyle = fillColor.getPattern(ctx, this, getCurrentTransformInverse(ctx), PathType.FILL, opIdx);
      if (baseTransform) {
        const newPath = new Path2D();
        newPath.addPath(path, ctx.getTransform().invertSelf().multiplySelf(baseTransform));
        path = newPath;
      }
      needRestore = true;
    }
    if (this.contentVisible && intersect !== null) {
      if (this.pendingEOFill) {
        ctx.fill(path, "evenodd");
        this.pendingEOFill = false;
      } else {
        ctx.fill(path);
      }
    }
    if (needRestore) {
      ctx.restore();
      this.dependencyTracker?.restore(opIdx);
    }
    if (consumePath) {
      this.consumePath(opIdx, path, intersect);
    }
    this.#endKnockoutElement(started);
  }
  eoFill(opIdx, path) {
    this.pendingEOFill = true;
    this.fill(opIdx, path);
  }
  fillStroke(opIdx, path) {
    const started = this.#beginKnockoutElement(Math.min(this.current.fillAlpha, this.current.strokeAlpha));
    this.fill(opIdx, path, false);
    this.stroke(opIdx, path, false);
    this.consumePath(opIdx, path);
    this.#endKnockoutElement(started);
  }
  eoFillStroke(opIdx, path) {
    this.pendingEOFill = true;
    this.fillStroke(opIdx, path);
  }
  closeFillStroke(opIdx, path) {
    this.fillStroke(opIdx, path);
  }
  closeEOFillStroke(opIdx, path) {
    this.pendingEOFill = true;
    this.fillStroke(opIdx, path);
  }
  endPath(opIdx, path) {
    this.consumePath(opIdx, path);
  }
  rawFillPath(opIdx, path) {
    const started = this.#beginKnockoutElement(this.current.fillAlpha);
    this.ctx.fill(path);
    this.dependencyTracker?.recordDependencies(opIdx, Dependencies.rawFillPath).recordOperation(opIdx);
    this.#endKnockoutElement(started);
  }
  clip(opIdx) {
    this.dependencyTracker?.recordFutureForcedDependency("clipMode", opIdx);
    this.pendingClip = NORMAL_CLIP;
  }
  eoClip(opIdx) {
    this.dependencyTracker?.recordFutureForcedDependency("clipMode", opIdx);
    this.pendingClip = EO_CLIP;
  }
  beginText(opIdx) {
    this.current.textMatrix = null;
    this.current.textMatrixScale = 1;
    this.current.x = this.current.lineX = 0;
    this.current.y = this.current.lineY = 0;
    this.dependencyTracker?.recordOpenMarker(opIdx).resetIncrementalData("sameLineText").resetIncrementalData("moveText", opIdx);
  }
  endText(opIdx) {
    const paths = this.pendingTextPaths;
    const ctx = this.ctx;
    if (this.dependencyTracker) {
      const {
        dependencyTracker
      } = this;
      if (paths !== undefined) {
        dependencyTracker.recordFutureForcedDependency("textClip", dependencyTracker.getOpenMarker()).recordFutureForcedDependency("textClip", opIdx);
      }
      dependencyTracker.recordCloseMarker(opIdx);
    }
    if (paths !== undefined) {
      const newPath = new Path2D();
      const invTransf = ctx.getTransform().invertSelf();
      for (const {
        transform,
        x,
        y,
        fontSize,
        path
      } of paths) {
        if (!path) {
          continue;
        }
        newPath.addPath(path, new DOMMatrix(transform).preMultiplySelf(invTransf).translate(x, y).scale(fontSize, -fontSize));
      }
      ctx.clip(newPath);
    }
    delete this.pendingTextPaths;
  }
  setCharSpacing(opIdx, spacing) {
    this.dependencyTracker?.recordSimpleData("charSpacing", opIdx);
    this.current.charSpacing = spacing;
  }
  setWordSpacing(opIdx, spacing) {
    this.dependencyTracker?.recordSimpleData("wordSpacing", opIdx);
    this.current.wordSpacing = spacing;
  }
  setHScale(opIdx, scale) {
    this.dependencyTracker?.recordSimpleData("hScale", opIdx);
    this.current.textHScale = scale / 100;
  }
  setLeading(opIdx, leading) {
    this.dependencyTracker?.recordSimpleData("leading", opIdx);
    this.current.leading = -leading;
  }
  setFont(opIdx, fontRefName, size) {
    this.dependencyTracker?.recordSimpleData("font", opIdx).recordSimpleDataFromNamed("fontObj", fontRefName, opIdx);
    const fontObj = this.commonObjs.get(fontRefName);
    const current = this.current;
    if (!fontObj) {
      throw new Error(`Can't find font for ${fontRefName}`);
    }
    current.fontMatrix = fontObj.fontMatrix || FONT_IDENTITY_MATRIX;
    if (current.fontMatrix[0] === 0 || current.fontMatrix[3] === 0) {
      warn("Invalid font matrix for font " + fontRefName);
    }
    if (size < 0) {
      size = -size;
      current.fontDirection = -1;
    } else {
      current.fontDirection = 1;
    }
    this.current.font = fontObj;
    this.current.fontSize = size;
    if (fontObj.isType3Font) {
      return;
    }
    const name = fontObj.loadedName || "sans-serif";
    const typeface = fontObj.systemFontInfo?.css || `"${name}", ${fontObj.fallbackName}`;
    let bold = "normal";
    if (fontObj.black) {
      bold = "900";
    } else if (fontObj.bold) {
      bold = "bold";
    }
    const italic = fontObj.italic ? "italic" : "normal";
    const browserFontSize = MathClamp(size, MIN_FONT_SIZE, MAX_FONT_SIZE);
    this.current.fontSizeScale = size / browserFontSize;
    this.ctx.font = `${italic} ${bold} ${browserFontSize}px ${typeface}`;
  }
  setTextRenderingMode(opIdx, mode) {
    this.dependencyTracker?.recordSimpleData("textRenderingMode", opIdx);
    this.current.textRenderingMode = mode;
  }
  setTextRise(opIdx, rise) {
    this.dependencyTracker?.recordSimpleData("textRise", opIdx);
    this.current.textRise = rise;
  }
  moveText(opIdx, x, y) {
    this.dependencyTracker?.resetIncrementalData("sameLineText").recordIncrementalData("moveText", opIdx);
    this.current.x = this.current.lineX += x;
    this.current.y = this.current.lineY += y;
  }
  setLeadingMoveText(opIdx, x, y) {
    this.setLeading(opIdx, -y);
    this.moveText(opIdx, x, y);
  }
  setTextMatrix(opIdx, matrix) {
    this.dependencyTracker?.resetIncrementalData("sameLineText").recordSimpleData("textMatrix", opIdx);
    const {
      current
    } = this;
    current.textMatrix = matrix;
    current.textMatrixScale = Math.hypot(matrix[0], matrix[1]);
    current.x = current.lineX = 0;
    current.y = current.lineY = 0;
  }
  nextLine(opIdx) {
    this.moveText(opIdx, 0, this.current.leading);
    this.dependencyTracker?.recordIncrementalData("moveText", this.dependencyTracker.getSimpleIndex("leading") ?? opIdx);
  }
  #getScaledPath(path, currentTransform, transform) {
    const newPath = new Path2D();
    newPath.addPath(path, new DOMMatrix(transform).invertSelf().multiplySelf(currentTransform));
    return newPath;
  }
  paintChar(opIdx, character, x, y, patternFillTransform, patternStrokeTransform) {
    const ctx = this.ctx;
    const current = this.current;
    const font = current.font;
    const textRenderingMode = current.textRenderingMode;
    const fontSize = current.fontSize / current.fontSizeScale;
    const fillStrokeMode = textRenderingMode & TextRenderingMode.FILL_STROKE_MASK;
    const isAddToPathSet = !!(textRenderingMode & TextRenderingMode.ADD_TO_PATH_FLAG);
    const patternFill = current.patternFill && !font.missingFile;
    const patternStroke = current.patternStroke && !font.missingFile;
    let path;
    if ((font.disableFontFace || isAddToPathSet || patternFill || patternStroke) && !font.missingFile) {
      path = font.getPathGenerator(this.commonObjs, character);
    }
    if (path && (font.disableFontFace || patternFill || patternStroke)) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(fontSize, -fontSize);
      this.dependencyTracker?.recordCharacterBBox(opIdx, ctx, font);
      let currentTransform;
      if (fillStrokeMode === TextRenderingMode.FILL || fillStrokeMode === TextRenderingMode.FILL_STROKE) {
        if (patternFillTransform) {
          currentTransform = ctx.getTransform();
          ctx.setTransform(...patternFillTransform);
          const scaledPath = this.#getScaledPath(path, currentTransform, patternFillTransform);
          ctx.fill(scaledPath);
        } else {
          ctx.fill(path);
        }
      }
      if (fillStrokeMode === TextRenderingMode.STROKE || fillStrokeMode === TextRenderingMode.FILL_STROKE) {
        if (patternStrokeTransform) {
          currentTransform ||= ctx.getTransform();
          ctx.setTransform(...patternStrokeTransform);
          const {
            a,
            b,
            c,
            d
          } = currentTransform;
          const invPatternTransform = Util.inverseTransform(patternStrokeTransform);
          const transf = Util.transform([a, b, c, d, 0, 0], invPatternTransform);
          Util.singularValueDecompose2dScale(transf, XY);
          ctx.lineWidth *= Math.max(XY[0], XY[1]) / fontSize;
          ctx.stroke(this.#getScaledPath(path, currentTransform, patternStrokeTransform));
        } else {
          ctx.lineWidth /= fontSize;
          ctx.stroke(path);
        }
      }
      ctx.restore();
    } else {
      if (fillStrokeMode === TextRenderingMode.FILL || fillStrokeMode === TextRenderingMode.FILL_STROKE) {
        ctx.fillText(character, x, y);
        this.dependencyTracker?.recordCharacterBBox(opIdx, ctx, font, fontSize, x, y, () => ctx.measureText(character));
      }
      if (fillStrokeMode === TextRenderingMode.STROKE || fillStrokeMode === TextRenderingMode.FILL_STROKE) {
        if (this.dependencyTracker) {
          this.dependencyTracker?.recordCharacterBBox(opIdx, ctx, font, fontSize, x, y, () => ctx.measureText(character)).recordDependencies(opIdx, Dependencies.stroke);
        }
        ctx.strokeText(character, x, y);
      }
    }
    if (isAddToPathSet) {
      const paths = this.pendingTextPaths ||= [];
      paths.push({
        transform: getCurrentTransform(ctx),
        x,
        y,
        fontSize,
        path
      });
      this.dependencyTracker?.recordCharacterBBox(opIdx, ctx, font, fontSize, x, y);
    }
  }
  get isFontSubpixelAAEnabled() {
    const tmpCanvas = this.canvasFactory.create(10, 10);
    const ctx = tmpCanvas.context;
    ctx.scale(1.5, 1);
    ctx.fillText("I", 0, 10);
    const data = ctx.getImageData(0, 0, 10, 10).data;
    this.canvasFactory.destroy(tmpCanvas);
    let enabled = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0 && data[i] < 255) {
        enabled = true;
        break;
      }
    }
    return shadow(this, "isFontSubpixelAAEnabled", enabled);
  }
  #getTextPattern(color, pathType, opIdx) {
    const ctx = this.ctx;
    ctx.save();
    const pattern = color.getPattern(ctx, this, getCurrentTransformInverse(ctx), pathType, opIdx);
    const transform = getCurrentTransform(ctx);
    ctx.restore();
    return [pattern, transform];
  }
  showText(opIdx, glyphs) {
    if (this.dependencyTracker) {
      this.dependencyTracker.recordDependencies(opIdx, Dependencies.showText).resetBBox(opIdx);
      if (this.current.textRenderingMode & TextRenderingMode.ADD_TO_PATH_FLAG) {
        this.dependencyTracker.recordFutureForcedDependency("textClip", opIdx).inheritPendingDependenciesAsFutureForcedDependencies();
      }
    }
    const current = this.current;
    const font = current.font;
    if (font.isType3Font) {
      const started = this.#beginKnockoutElement(current.fillAlpha);
      this.showType3Text(opIdx, glyphs);
      this.dependencyTracker?.recordShowTextOperation(opIdx);
      this.#endKnockoutElement(started);
      return;
    }
    const fontSize = current.fontSize;
    if (fontSize === 0) {
      this.dependencyTracker?.recordOperation(opIdx);
      return;
    }
    const started = this.#beginKnockoutElement(current.fillAlpha);
    const ctx = this.ctx;
    const fontSizeScale = current.fontSizeScale;
    const charSpacing = current.charSpacing;
    const wordSpacing = current.wordSpacing;
    const fontDirection = current.fontDirection;
    const textHScale = current.textHScale * fontDirection;
    const glyphsLength = glyphs.length;
    const vertical = font.vertical;
    const spacingDir = vertical ? 1 : -1;
    const widthAdvanceScale = fontSize * current.fontMatrix[0];
    const simpleFillText = current.textRenderingMode === TextRenderingMode.FILL && !font.disableFontFace && !current.patternFill;
    ctx.save();
    if (current.textMatrix) {
      ctx.transform(...current.textMatrix);
    }
    ctx.translate(current.x, current.y + current.textRise);
    if (fontDirection > 0) {
      ctx.scale(textHScale, -1);
    } else {
      ctx.scale(textHScale, 1);
    }
    let patternFillTransform, patternStrokeTransform;
    const fillStrokeMode = current.textRenderingMode & TextRenderingMode.FILL_STROKE_MASK;
    const needsFill = fillStrokeMode === TextRenderingMode.FILL || fillStrokeMode === TextRenderingMode.FILL_STROKE;
    const needsStroke = fillStrokeMode === TextRenderingMode.STROKE || fillStrokeMode === TextRenderingMode.FILL_STROKE;
    let lineWidth = current.lineWidth;
    const scale = current.textMatrixScale;
    if (scale === 0 || lineWidth === 0) {
      if (needsStroke) {
        lineWidth = this.getSinglePixelWidth();
      }
    } else {
      lineWidth /= scale;
    }
    if (fontSizeScale !== 1.0) {
      ctx.scale(fontSizeScale, fontSizeScale);
      lineWidth /= fontSizeScale;
    }
    ctx.lineWidth = lineWidth;
    if (needsFill && current.patternFill) {
      [ctx.fillStyle, patternFillTransform] = this.#getTextPattern(current.fillColor, PathType.FILL, opIdx);
    }
    if (needsStroke && current.patternStroke) {
      [ctx.strokeStyle, patternStrokeTransform] = this.#getTextPattern(current.strokeColor, PathType.STROKE, opIdx);
    }
    if (font.isInvalidPDFjsFont) {
      const chars = [];
      let width = 0;
      for (const glyph of glyphs) {
        chars.push(glyph.unicode);
        width += glyph.width;
      }
      const joinedChars = chars.join("");
      ctx.fillText(joinedChars, 0, 0);
      if (this.dependencyTracker !== null) {
        const measure = ctx.measureText(joinedChars);
        this.dependencyTracker.recordBBox(opIdx, this.ctx, -measure.actualBoundingBoxLeft, measure.actualBoundingBoxRight, -measure.actualBoundingBoxAscent, measure.actualBoundingBoxDescent).recordShowTextOperation(opIdx);
      }
      current.x += width * widthAdvanceScale * textHScale;
      ctx.restore();
      this.compose();
      this.#endKnockoutElement(started);
      return;
    }
    let x = 0,
      i,
      glyphPatterns = null;
    for (i = 0; i < glyphsLength; ++i) {
      const glyph = glyphs[i];
      if (typeof glyph === "number") {
        x += spacingDir * glyph * fontSize / 1000;
        continue;
      }
      let restoreNeeded = false;
      const spacing = (glyph.isSpace ? wordSpacing : 0) + charSpacing;
      const character = glyph.fontChar;
      const accent = glyph.accent;
      let scaledX, scaledY, measure;
      let width = glyph.width;
      if (vertical) {
        const vmetric = glyph.vmetric;
        const vx = -vmetric[1] * widthAdvanceScale;
        const vy = vmetric[2] * widthAdvanceScale;
        width = -vmetric[0];
        scaledX = vx / fontSizeScale;
        scaledY = (x + vy) / fontSizeScale;
        if (glyph.isRotated) {
          measure = ctx.measureText(character);
          const glyphScale = widthAdvanceScale / fontSizeScale;
          const halfWidth = glyph.width / 2 * glyphScale;
          const centerX = scaledX + halfWidth;
          scaledX = scaledY - (DEFAULT_VERTICAL_ORIGIN_Y - DEFAULT_VERTICAL_ADVANCE / 2) * glyphScale - halfWidth;
          scaledY = (measure.actualBoundingBoxAscent - measure.actualBoundingBoxDescent) / 2 - centerX;
          restoreNeeded = true;
          ctx.save();
          ctx.rotate(Math.PI / 2);
        }
      } else {
        scaledX = x / fontSizeScale;
        scaledY = 0;
      }
      const glyphWidth = glyph.isRotated ? glyph.width : width;
      let characterScaleX = 1;
      if ((font.remeasure || glyph.isRotated) && glyphWidth > 0) {
        measure ??= ctx.measureText(character);
        const measuredWidth = measure.width * 1000 / fontSize * fontSizeScale;
        if (glyphWidth < measuredWidth && this.isFontSubpixelAAEnabled) {
          characterScaleX = glyphWidth / measuredWidth;
          if (!restoreNeeded) {
            restoreNeeded = true;
            ctx.save();
          }
          ctx.scale(characterScaleX, 1);
          scaledX /= characterScaleX;
        } else if (glyphWidth !== measuredWidth) {
          scaledX += (glyphWidth - measuredWidth) / 2000 * fontSize / fontSizeScale;
        }
      }
      if (restoreNeeded && font.missingFile && (patternFillTransform || patternStrokeTransform)) {
        glyphPatterns ||= new Map();
        [ctx.fillStyle, ctx.strokeStyle] = glyphPatterns.getOrInsertComputed(glyph.isRotated ? -characterScaleX : characterScaleX, () => [patternFillTransform ? this.#getTextPattern(current.fillColor, PathType.FILL, opIdx)[0] : ctx.fillStyle, patternStrokeTransform ? this.#getTextPattern(current.strokeColor, PathType.STROKE, opIdx)[0] : ctx.strokeStyle]);
      }
      if (this.contentVisible && (glyph.isInFont || font.missingFile)) {
        if (simpleFillText && !accent) {
          ctx.fillText(character, scaledX, scaledY);
          this.dependencyTracker?.recordCharacterBBox(opIdx, ctx, measure ? {
            bbox: null
          } : font, fontSize / fontSizeScale, scaledX, scaledY, () => measure ?? ctx.measureText(character));
        } else {
          this.paintChar(opIdx, character, scaledX, scaledY, patternFillTransform, patternStrokeTransform);
          if (accent) {
            const scaledAccentX = scaledX + fontSize * accent.offset.x / fontSizeScale;
            const scaledAccentY = scaledY - fontSize * accent.offset.y / fontSizeScale;
            this.paintChar(opIdx, accent.fontChar, scaledAccentX, scaledAccentY, patternFillTransform, patternStrokeTransform);
          }
        }
      }
      const charWidth = vertical ? width * widthAdvanceScale - spacing * fontDirection : width * widthAdvanceScale + spacing * fontDirection;
      x += charWidth;
      if (restoreNeeded) {
        ctx.restore();
      }
    }
    if (vertical) {
      current.y -= x;
    } else {
      current.x += x * textHScale;
    }
    ctx.restore();
    this.compose();
    this.dependencyTracker?.recordShowTextOperation(opIdx);
    this.#endKnockoutElement(started);
  }
  showType3Text(opIdx, glyphs) {
    const ctx = this.ctx;
    const current = this.current;
    const font = current.font;
    const fontSize = current.fontSize;
    const fontDirection = current.fontDirection;
    const spacingDir = font.vertical ? 1 : -1;
    const charSpacing = current.charSpacing;
    const wordSpacing = current.wordSpacing;
    const textHScale = current.textHScale * fontDirection;
    const fontMatrix = current.fontMatrix || FONT_IDENTITY_MATRIX;
    const glyphsLength = glyphs.length;
    const isTextVisible = current.textRenderingMode !== TextRenderingMode.INVISIBLE;
    let i, glyph, width, spacingLength;
    if (fontSize === 0) {
      return;
    }
    this._cachedScaleForStroking[0] = -1;
    ctx.save();
    if (current.textMatrix) {
      ctx.transform(...current.textMatrix);
    }
    ctx.translate(current.x, current.y + current.textRise);
    ctx.scale(textHScale, fontDirection);
    const dependencyTracker = this.dependencyTracker;
    this.dependencyTracker = dependencyTracker ? new CanvasNestedDependencyTracker(dependencyTracker, opIdx) : null;
    try {
      for (i = 0; i < glyphsLength; ++i) {
        glyph = glyphs[i];
        if (typeof glyph === "number") {
          spacingLength = spacingDir * glyph * fontSize / 1000;
          this.ctx.translate(spacingLength, 0);
          current.x += spacingLength * textHScale;
          continue;
        }
        const spacing = (glyph.isSpace ? wordSpacing : 0) + charSpacing;
        const operatorList = font.charProcOperatorList.get(glyph.operatorListId);
        if (!operatorList) {
          warn(`Type3 character "${glyph.operatorListId}" is not available.`);
        } else if (this.contentVisible && isTextVisible) {
          this.save();
          ctx.scale(fontSize, fontSize);
          ctx.transform(...fontMatrix);
          this.executeOperatorList(operatorList);
          this.restore();
        }
        width = glyph.width * fontMatrix[0] * fontSize + spacing * fontDirection;
        ctx.translate(width, 0);
        current.x += width * textHScale;
      }
    } finally {
      if (dependencyTracker) {
        this.dependencyTracker = dependencyTracker;
      }
    }
    ctx.restore();
  }
  setCharWidth(opIdx, xWidth, yWidth) {}
  setCharWidthAndBounds(opIdx, xWidth, yWidth, llx, lly, urx, ury) {
    const clip = new Path2D();
    clip.rect(llx, lly, urx - llx, ury - lly);
    this.ctx.clip(clip);
    this.dependencyTracker?.recordBBox(opIdx, this.ctx, llx, urx, lly, ury).recordClipBox(opIdx, this.ctx, llx, urx, lly, ury);
    this.endPath(opIdx);
  }
  getColorN_Pattern(opIdx, IR) {
    let pattern;
    if (IR[0] === "TilingPattern") {
      const baseTransform = this.baseTransform || getCurrentTransform(this.ctx);
      const canvasGraphicsFactory = {
        createCanvasGraphics: (ctx, renderingOpIdx) => new CanvasGraphics(ctx, this.commonObjs, this.objs, this.canvasFactory, this.filterFactory, {
          optionalContentConfig: this.optionalContentConfig,
          markedContentStack: this.markedContentStack,
          pixelRatio: this.pixelRatio
        }, undefined, undefined, this.dependencyTracker ? new CanvasNestedDependencyTracker(this.dependencyTracker, renderingOpIdx, true) : null)
      };
      pattern = new TilingPattern(IR, this.ctx, canvasGraphicsFactory, baseTransform);
    } else {
      pattern = this._getPattern(opIdx, IR[1], IR[2]);
    }
    return pattern;
  }
  setStrokeColorN(opIdx, ...args) {
    this.dependencyTracker?.recordSimpleData("strokeColor", opIdx);
    this.current.strokeColor = this.getColorN_Pattern(opIdx, args);
    this.current.patternStroke = true;
  }
  setFillColorN(opIdx, ...args) {
    this.dependencyTracker?.recordSimpleData("fillColor", opIdx);
    const pattern = this.current.fillColor = this.getColorN_Pattern(opIdx, args);
    this.current.patternFill = true;
    this.current.tilingPatternDims = pattern instanceof TilingPattern ? [0, 0, 0, 0] : null;
  }
  #transferColor(color) {
    return this.current.transferMapsFallback?.applyToColor(color) ?? color;
  }
  setStrokeRGBColor(opIdx, color) {
    this.dependencyTracker?.recordSimpleData("strokeColor", opIdx);
    this.current.strokeColor = color;
    this.ctx.strokeStyle = this.#transferColor(color);
    this.current.patternStroke = false;
  }
  setStrokeTransparent(opIdx) {
    this.dependencyTracker?.recordSimpleData("strokeColor", opIdx);
    this.ctx.strokeStyle = this.current.strokeColor = "transparent";
    this.current.patternStroke = false;
  }
  setFillRGBColor(opIdx, color) {
    this.dependencyTracker?.recordSimpleData("fillColor", opIdx);
    this.current.fillColor = color;
    this.ctx.fillStyle = this.#transferColor(color);
    this.current.patternFill = false;
    this.current.tilingPatternDims = null;
  }
  setFillTransparent(opIdx) {
    this.dependencyTracker?.recordSimpleData("fillColor", opIdx);
    this.ctx.fillStyle = this.current.fillColor = "transparent";
    this.current.patternFill = false;
    this.current.tilingPatternDims = null;
  }
  _getPattern(opIdx, objId, matrix = null) {
    const pattern = this.cachedPatterns.getOrInsertComputed(objId, () => getShadingPattern(this.getObject(opIdx, objId)));
    if (matrix) {
      pattern.matrix = matrix;
    }
    return pattern;
  }
  shadingFill(opIdx, objId) {
    if (!this.contentVisible) {
      return;
    }
    const started = this.#beginKnockoutElement(this.current.fillAlpha);
    const ctx = this.ctx;
    this.save(opIdx);
    const pattern = this._getPattern(opIdx, objId);
    ctx.fillStyle = pattern.getPattern(ctx, this, getCurrentTransformInverse(ctx), PathType.SHADING, opIdx);
    const inv = getCurrentTransformInverse(ctx);
    if (inv) {
      const {
        width,
        height
      } = ctx.canvas;
      const minMax = F32_BBOX_INIT.slice();
      Util.axialAlignedBoundingBox([0, 0, width, height], inv, minMax);
      const [x0, y0, x1, y1] = minMax;
      this.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    } else {
      this.ctx.fillRect(-1e10, -1e10, 2e10, 2e10);
    }
    this.dependencyTracker?.resetBBox(opIdx).recordFullPageBBox(opIdx).recordDependencies(opIdx, Dependencies.transform).recordDependencies(opIdx, Dependencies.fill).recordOperation(opIdx);
    this.compose(this.current.getClippedPathBoundingBox());
    this.restore(opIdx);
    this.#endKnockoutElement(started);
  }
  beginInlineImage() {
    unreachable("Should not call beginInlineImage");
  }
  beginImageData() {
    unreachable("Should not call beginImageData");
  }
  paintFormXObjectBegin(opIdx, matrix, bbox) {
    if (!this.contentVisible) {
      return;
    }
    this.save(opIdx);
    this.baseTransformStack.push(this.baseTransform);
    if (matrix) {
      this.transform(opIdx, ...matrix);
    }
    this.baseTransform = getCurrentTransform(this.ctx);
    if (bbox) {
      Util.axialAlignedBoundingBox(bbox, this.baseTransform, this.current.minMax);
      const [x0, y0, x1, y1] = bbox;
      const clip = new Path2D();
      clip.rect(x0, y0, x1 - x0, y1 - y0);
      this.ctx.clip(clip);
      this.dependencyTracker?.recordClipBox(opIdx, this.ctx, x0, x1, y0, y1);
      this.endPath(opIdx);
    }
  }
  paintFormXObjectEnd(opIdx) {
    if (!this.contentVisible) {
      return;
    }
    this.restore(opIdx);
    this.baseTransform = this.baseTransformStack.pop();
  }
  beginGroup(opIdx, group) {
    if (!this.contentVisible) {
      return;
    }
    this.save(opIdx);
    const {
      inSMaskMode
    } = this;
    if (inSMaskMode) {
      this.endSMaskMode();
      this.current.activeSMask = null;
    }
    const currentCtx = this.ctx;
    if ((!group.needsIsolation || !group.isolated && !group.hasSoftMask) && !group.knockout && !group.isGray && this.#knockoutGroupLevel === 0 && currentCtx.globalAlpha === 1 && currentCtx.globalCompositeOperation === "source-over" && !inSMaskMode) {
      if (group.bbox) {
        let clip = new Path2D();
        const [x0, y0, x1, y1] = group.bbox;
        clip.rect(x0, y0, x1 - x0, y1 - y0);
        if (group.matrix) {
          const path = new Path2D();
          path.addPath(clip, new DOMMatrix(group.matrix));
          clip = path;
        }
        currentCtx.clip(clip);
      }
      this.groupStack.push(null);
      this.#groupStackMeta.push(null);
      this.groupLevel++;
      return;
    }
    if (!group.isolated && !group.knockout && this.#knockoutGroupLevel === 0) {
      info("TODO: Fully support non-isolated non-knockout groups.");
    }
    const currentTransform = getCurrentTransform(currentCtx);
    if (group.matrix) {
      currentCtx.transform(...group.matrix);
    }
    const canvasBounds = [0, 0, currentCtx.canvas.width, currentCtx.canvas.height];
    let bounds;
    if (group.bbox) {
      bounds = F32_BBOX_INIT.slice();
      Util.axialAlignedBoundingBox(group.bbox, getCurrentTransform(currentCtx), bounds);
      bounds = Util.intersect(bounds, canvasBounds) || [0, 0, 0, 0];
    } else {
      bounds = canvasBounds;
    }
    const offsetX = Math.floor(bounds[0]);
    const offsetY = Math.floor(bounds[1]);
    const drawnWidth = Math.max(Math.ceil(bounds[2]) - offsetX, 1);
    const drawnHeight = Math.max(Math.ceil(bounds[3]) - offsetY, 1);
    this.current.startNewPathAndClipBox([0, 0, drawnWidth, drawnHeight]);
    const scratchCanvas = this.canvasFactory.create(drawnWidth, drawnHeight);
    if (group.smask) {
      this.smaskGroupCanvases.push(scratchCanvas);
    }
    const groupCtx = scratchCanvas.context;
    const backdropCtx = group.knockout && !group.isolated ? currentCtx : null;
    const hasInnerBackdrop = !group.isolated && !group.knockout && !group.smask && group.needsIsolation && this.#knockoutGroupLevel > 0;
    const knockoutMaskEntry = group.knockout ? this.canvasFactory.create(drawnWidth, drawnHeight) : null;
    const savedKnockoutLevel = this.#knockoutGroupLevel;
    if (group.knockout) {
      this.#knockoutGroupLevel++;
    } else {
      this.#knockoutGroupLevel = 0;
    }
    groupCtx.translate(-offsetX, -offsetY);
    groupCtx.transform(...currentTransform);
    const needsBackdropCopy = !group.isolated && !group.smask && group.needsIsolation;
    const replaceBackdrop = needsBackdropCopy && !inSMaskMode && savedKnockoutLevel === 0 && !group.knockout && !group.isGray && group.hasSoftMask && currentCtx.globalAlpha === 1 && currentCtx.globalCompositeOperation === "source-over" && this.current.transferMaps === "none" && !this.current.transferMapsFallback;
    if (needsBackdropCopy && (inSMaskMode || replaceBackdrop)) {
      groupCtx.save();
      groupCtx.setTransform(1, 0, 0, 1, 0, 0);
      groupCtx.drawImage(currentCtx.canvas, -offsetX, -offsetY);
      groupCtx.restore();
    }
    if (group.bbox) {
      let clip = new Path2D();
      const [x0, y0, x1, y1] = group.bbox;
      clip.rect(x0, y0, x1 - x0, y1 - y0);
      if (group.matrix) {
        const path = new Path2D();
        path.addPath(clip, new DOMMatrix(group.matrix));
        clip = path;
      }
      groupCtx.clip(clip);
    }
    if (group.smask) {
      this.smaskStack.push({
        canvas: scratchCanvas.canvas,
        context: groupCtx,
        offsetX,
        offsetY,
        subtype: group.smask.subtype,
        backdrop: group.smask.backdrop,
        transferMap: group.smask.transferMap || null
      });
    }
    if (!group.smask || this.dependencyTracker) {
      currentCtx.setTransform(1, 0, 0, 1, 0, 0);
      currentCtx.translate(offsetX, offsetY);
      currentCtx.save();
    }
    copyCtxState(currentCtx, groupCtx);
    this.ctx = groupCtx;
    this.dependencyTracker?.inheritSimpleDataAsFutureForcedDependencies(["fillAlpha", "strokeAlpha", "globalCompositeOperation"]).pushBaseTransform(currentCtx);
    this.setGState(opIdx, [["BM", "source-over"], ["ca", 1], ["CA", 1], ["TR", null]]);
    this.groupStack.push(currentCtx);
    this.#groupStackMeta.push({
      backdropCtx,
      savedKnockoutLevel,
      offsetX,
      offsetY,
      hasInnerBackdrop,
      replaceBackdrop,
      knockoutMaskEntry,
      knockoutTempEntry: null,
      knockoutBackdropEntry: null
    });
    this.groupLevel++;
  }
  endGroup(opIdx, group) {
    if (!this.contentVisible) {
      return;
    }
    this.groupLevel--;
    const groupCtx = this.ctx;
    const ctx = this.groupStack.pop();
    const groupMeta = this.#groupStackMeta.pop();
    if (groupMeta) {
      this.#knockoutGroupLevel = groupMeta.savedKnockoutLevel;
    }
    if (ctx === null) {
      this.restore(opIdx);
      return;
    }
    if (group.isGray) {
      this.#convertGroupToGray(groupCtx);
    }
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.dependencyTracker?.popBaseTransform();
    if (group.smask) {
      this.tempSMask = this.smaskStack.pop();
      this.restore(opIdx);
      if (this.dependencyTracker) {
        this.ctx.restore();
        if (this.inSMaskMode) {
          this.ctx.setTransform(this.suspendedCtx.getTransform());
        }
      }
      this.#destroyKnockoutPools(groupMeta);
    } else {
      this.ctx.restore();
      const currentMtx = getCurrentTransform(this.ctx);
      this.restore(opIdx);
      this.current.transferMapsFallback?.applyToCanvas(groupCtx);
      this.ctx.save();
      this.ctx.setTransform(...currentMtx);
      const dirtyBox = F32_BBOX_INIT.slice();
      Util.axialAlignedBoundingBox([0, 0, groupCtx.canvas.width, groupCtx.canvas.height], currentMtx, dirtyBox);
      const parentGroupMeta = this.#groupStackMeta.at(-1);
      if (this.#knockoutGroupLevel > 0) {
        if (groupMeta.hasInnerBackdrop) {
          const {
            width,
            height
          } = groupCtx.canvas;
          const colorEntry = this.canvasFactory.create(width, height);
          const colorCtx = colorEntry.context;
          colorCtx.drawImage(ctx.canvas, groupMeta.offsetX, groupMeta.offsetY, width, height, 0, 0, width, height);
          colorCtx.globalCompositeOperation = "source-over";
          colorCtx.drawImage(groupCtx.canvas, 0, 0);
          const shapeMaskEntry = this.#createKnockoutMaskCanvas(groupCtx.canvas);
          colorCtx.globalCompositeOperation = "destination-in";
          colorCtx.drawImage(shapeMaskEntry.canvas, 0, 0);
          const sourceCompositeOperation = this.ctx.globalCompositeOperation;
          const sourceAlpha = this.ctx.globalAlpha;
          const sourceFilter = this.ctx.filter;
          this.ctx.save();
          this.ctx.setTransform(...currentMtx);
          this.ctx.globalAlpha = 1;
          if (FeatureTest.isCanvasFilterSupported) {
            this.ctx.filter = "none";
          }
          this.ctx.globalCompositeOperation = "destination-out";
          this.ctx.drawImage(shapeMaskEntry.canvas, 0, 0);
          this.ctx.globalCompositeOperation = sourceCompositeOperation;
          this.ctx.globalAlpha = sourceAlpha;
          if (FeatureTest.isCanvasFilterSupported) {
            this.ctx.filter = sourceFilter ?? "none";
          }
          this.ctx.drawImage(colorEntry.canvas, 0, 0);
          this.ctx.restore();
          this.canvasFactory.destroy(shapeMaskEntry);
          this.canvasFactory.destroy(colorEntry);
        } else {
          const backdropCtx = parentGroupMeta?.backdropCtx ?? null;
          this.#compositeKnockoutSurface(this.ctx, groupCtx.canvas, {
            backdropCanvas: backdropCtx?.canvas ?? null,
            destTransform: currentMtx,
            backdropOffset: backdropCtx ? [parentGroupMeta.offsetX + groupMeta.offsetX, parentGroupMeta.offsetY + groupMeta.offsetY] : [0, 0],
            sourceAlpha: this.ctx.globalAlpha,
            sourceFilter: this.ctx.filter
          });
        }
      } else {
        if (groupMeta.replaceBackdrop) {
          const clip = new Path2D();
          clip.rect(0, 0, groupCtx.canvas.width, groupCtx.canvas.height);
          this.ctx.clip(clip);
          this.ctx.globalCompositeOperation = "copy";
        }
        this.ctx.drawImage(groupCtx.canvas, 0, 0);
      }
      this.ctx.restore();
      this.canvasFactory.destroy({
        canvas: groupCtx.canvas,
        context: groupCtx
      });
      this.#destroyKnockoutPools(groupMeta);
      this.compose(dirtyBox);
    }
  }
  #convertGroupToGray(groupCtx) {
    const {
      canvas
    } = groupCtx;
    const {
      width,
      height
    } = canvas;
    if (FeatureTest.isCanvasFilterSupported) {
      groupCtx.save();
      groupCtx.setTransform(1, 0, 0, 1, 0, 0);
      groupCtx.filter = "grayscale(1)";
      groupCtx.globalAlpha = 1;
      groupCtx.globalCompositeOperation = "copy";
      groupCtx.drawImage(canvas, 0, 0);
      groupCtx.restore();
      return;
    }
    const imageData = groupCtx.getImageData(0, 0, width, height);
    const {
      data
    } = imageData;
    for (let i = 0, ii = data.length; i < ii; i += 4) {
      const gray = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722 + 0.5 | 0;
      data[i] = data[i + 1] = data[i + 2] = gray;
    }
    groupCtx.putImageData(imageData, 0, 0);
  }
  #destroyKnockoutPools(groupMeta) {
    if (!groupMeta) {
      return;
    }
    if (groupMeta.knockoutMaskEntry) {
      this.canvasFactory.destroy(groupMeta.knockoutMaskEntry);
      groupMeta.knockoutMaskEntry = null;
    }
    if (groupMeta.knockoutTempEntry) {
      this.canvasFactory.destroy(groupMeta.knockoutTempEntry);
      groupMeta.knockoutTempEntry = null;
    }
    if (groupMeta.knockoutBackdropEntry) {
      this.canvasFactory.destroy(groupMeta.knockoutBackdropEntry);
      groupMeta.knockoutBackdropEntry = null;
    }
  }
  beginAnnotation(opIdx, id, rect, transform, matrix, hasOwnCanvas, canvasName) {
    this.#restoreInitialState();
    resetCtxToDefault(this.ctx);
    this.ctx.save();
    this.save(opIdx);
    if (this.baseTransform) {
      this.ctx.setTransform(...this.baseTransform);
    }
    if (rect) {
      const width = rect[2] - rect[0];
      const height = rect[3] - rect[1];
      if (hasOwnCanvas && this.annotationCanvasMap) {
        transform = transform.slice();
        transform[4] -= rect[0];
        transform[5] -= rect[1];
        Util.singularValueDecompose2dScale(getCurrentTransform(this.ctx), XY);
        const {
          viewportScale
        } = this;
        const canvasWidth = Math.ceil(width * this.outputScaleX * viewportScale);
        const canvasHeight = Math.ceil(height * this.outputScaleY * viewportScale);
        this.annotationCanvas = this.canvasFactory.create(canvasWidth, canvasHeight);
        const {
          canvas,
          context
        } = this.annotationCanvas;
        if (canvasName) {
          const canvases = this.annotationCanvasMap.getOrInsertComputed(id, makeArr);
          setAnnotationCanvasName(canvas, canvasName);
          const index = canvases.findIndex(c => getAnnotationCanvasName(c) === canvasName);
          if (index === -1) {
            canvases.push(canvas);
          } else {
            canvases[index] = canvas;
          }
        } else {
          this.annotationCanvasMap.set(id, canvas);
        }
        this.annotationCanvas.savedCtx = this.ctx;
        this.ctx = context;
        this.ctx.save();
        this.ctx.setTransform(XY[0], 0, 0, -XY[1], 0, height * XY[1]);
        resetCtxToDefault(this.ctx);
      } else {
        resetCtxToDefault(this.ctx);
        this.endPath(opIdx);
        const clip = new Path2D();
        clip.rect(rect[0], rect[1], width, height);
        this.ctx.clip(clip);
      }
    }
    this.current = new CanvasExtraState(this.ctx.canvas.width, this.ctx.canvas.height);
    this.baseTransformStack.push(this.baseTransform);
    this.transform(opIdx, ...transform);
    this.transform(opIdx, ...matrix);
    this.baseTransform = getCurrentTransform(this.ctx);
  }
  endAnnotation(opIdx) {
    if (this.annotationCanvas) {
      this.ctx.restore();
      this.#drawFilter();
      this.ctx = this.annotationCanvas.savedCtx;
      delete this.annotationCanvas.savedCtx;
      delete this.annotationCanvas;
    }
    this.baseTransform = this.baseTransformStack.pop();
  }
  paintImageMaskXObject(opIdx, img) {
    if (!this.contentVisible) {
      return;
    }
    const count = img.count;
    img = this.getObject(opIdx, img.data, img);
    img.count = count;
    const started = this.#beginKnockoutElement(this.current.fillAlpha);
    const ctx = this.ctx;
    const mask = this._createMaskCanvas(opIdx, img);
    const maskCanvas = mask.canvas;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(maskCanvas, mask.offsetX, mask.offsetY);
    this.dependencyTracker?.resetBBox(opIdx).recordBBox(opIdx, this.ctx, mask.offsetX, mask.offsetX + maskCanvas.width, mask.offsetY, mask.offsetY + maskCanvas.height).recordOperation(opIdx);
    ctx.restore();
    if (mask.canvasEntry) {
      this.canvasFactory.destroy(mask.canvasEntry);
    }
    this.compose();
    this.#endKnockoutElement(started);
  }
  paintImageMaskXObjectRepeat(opIdx, img, scaleX, skewX = 0, skewY = 0, scaleY, positions) {
    if (!this.contentVisible) {
      return;
    }
    img = this.getObject(opIdx, img.data, img);
    const started = this.#beginKnockoutElement(this.current.fillAlpha);
    const ctx = this.ctx;
    ctx.save();
    const currentTransform = getCurrentTransform(ctx);
    ctx.transform(scaleX, skewX, skewY, scaleY, 0, 0);
    const mask = this._createMaskCanvas(opIdx, img);
    ctx.setTransform(1, 0, 0, 1, mask.offsetX - currentTransform[4], mask.offsetY - currentTransform[5]);
    this.dependencyTracker?.resetBBox(opIdx);
    for (let i = 0, ii = positions.length; i < ii; i += 2) {
      const trans = Util.transform(currentTransform, [scaleX, skewX, skewY, scaleY, positions[i], positions[i + 1]]);
      ctx.drawImage(mask.canvas, trans[4], trans[5]);
      this.dependencyTracker?.recordBBox(opIdx, this.ctx, trans[4], trans[4] + mask.canvas.width, trans[5], trans[5] + mask.canvas.height);
    }
    ctx.restore();
    if (mask.canvasEntry) {
      this.canvasFactory.destroy(mask.canvasEntry);
    }
    this.compose();
    this.dependencyTracker?.recordOperation(opIdx);
    this.#endKnockoutElement(started);
  }
  paintImageMaskXObjectGroup(opIdx, images) {
    if (!this.contentVisible) {
      return;
    }
    const started = this.#beginKnockoutElement(this.current.fillAlpha);
    const ctx = this.ctx;
    const isPatternFill = this.current.patternFill;
    const fillColor = isPatternFill ? this.current.fillColor : ctx.fillStyle;
    this.dependencyTracker?.resetBBox(opIdx).recordDependencies(opIdx, Dependencies.transformAndFill);
    for (const image of images) {
      const {
        data,
        width,
        height,
        transform
      } = image;
      const maskCanvas = this.canvasFactory.create(width, height);
      const maskCtx = maskCanvas.context;
      maskCtx.save();
      const img = this.getObject(opIdx, data, image);
      putBinaryImageMask(maskCtx, img);
      maskCtx.globalCompositeOperation = "source-in";
      maskCtx.fillStyle = isPatternFill ? fillColor.getPattern(maskCtx, this, getCurrentTransformInverse(ctx), PathType.FILL, opIdx) : fillColor;
      maskCtx.fillRect(0, 0, width, height);
      maskCtx.restore();
      ctx.save();
      ctx.transform(...transform);
      ctx.scale(1, -1);
      drawImageAtIntegerCoords(ctx, maskCanvas.canvas, 0, 0, width, height, 0, -1, 1, 1);
      this.canvasFactory.destroy(maskCanvas);
      this.dependencyTracker?.recordBBox(opIdx, ctx, 0, width, 0, height);
      ctx.restore();
    }
    this.compose();
    this.dependencyTracker?.recordOperation(opIdx);
    this.#endKnockoutElement(started);
  }
  paintImageXObject(opIdx, objId) {
    if (!this.contentVisible) {
      return;
    }
    const imgData = this.getObject(opIdx, objId);
    if (!imgData) {
      warn("Dependent image isn't ready yet");
      return;
    }
    this.paintInlineImageXObject(opIdx, imgData);
  }
  paintImageXObjectRepeat(opIdx, objId, scaleX, scaleY, positions) {
    if (!this.contentVisible) {
      return;
    }
    const imgData = this.getObject(opIdx, objId);
    if (!imgData) {
      warn("Dependent image isn't ready yet");
      return;
    }
    const width = imgData.width;
    const height = imgData.height;
    const map = [];
    for (let i = 0, ii = positions.length; i < ii; i += 2) {
      map.push({
        transform: [scaleX, 0, 0, scaleY, positions[i], positions[i + 1]],
        x: 0,
        y: 0,
        w: width,
        h: height
      });
    }
    this.paintInlineImageXObjectGroup(opIdx, imgData, map);
  }
  applyTransferMapsToCanvas(ctx) {
    if (this.current.transferMaps !== "none") {
      ctx.filter = this.current.transferMaps;
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.filter = "none";
    } else {
      this.current.transferMapsFallback?.applyToCanvas(ctx);
    }
    return ctx.canvas;
  }
  applyTransferMapsToBitmap(imgData) {
    const {
      transferMaps,
      transferMapsFallback
    } = this.current;
    if (transferMaps === "none" && !transferMapsFallback) {
      return {
        img: imgData.bitmap,
        canvasEntry: null
      };
    }
    const {
      bitmap,
      width,
      height
    } = imgData;
    const tmpCanvas = this.canvasFactory.create(width, height);
    const tmpCtx = tmpCanvas.context;
    tmpCtx.filter = transferMaps;
    tmpCtx.drawImage(bitmap, 0, 0);
    tmpCtx.filter = "none";
    transferMapsFallback?.applyToCanvas(tmpCtx);
    return {
      img: tmpCanvas.canvas,
      canvasEntry: tmpCanvas
    };
  }
  paintInlineImageXObject(opIdx, imgData) {
    if (!this.contentVisible) {
      return;
    }
    const width = imgData.width;
    const height = imgData.height;
    const started = this.#beginKnockoutElement(this.current.fillAlpha);
    const ctx = this.ctx;
    this.save(opIdx);
    const {
      filter
    } = ctx;
    if (filter !== "none" && filter !== "") {
      ctx.filter = "none";
    }
    ctx.scale(1 / width, -1 / height);
    let imgToPaint;
    let inlineImgCanvas = null;
    if (imgData.bitmap) {
      const result = this.applyTransferMapsToBitmap(imgData);
      imgToPaint = result.img;
      inlineImgCanvas = result.canvasEntry;
    } else {
      const tmpCanvas = this.canvasFactory.create(width, height);
      putBinaryImageData(tmpCanvas.context, imgData);
      imgToPaint = this.applyTransferMapsToCanvas(tmpCanvas.context);
      inlineImgCanvas = tmpCanvas;
    }
    const scaled = this._scaleImage(imgToPaint, getCurrentTransformInverse(ctx));
    ctx.imageSmoothingEnabled = getImageSmoothingEnabled(getCurrentTransform(ctx), imgData.interpolate, this.pixelRatio);
    if (this.dependencyTracker) {
      this.dependencyTracker.resetBBox(opIdx).recordBBox(opIdx, ctx, 0, width, -height, 0).recordDependencies(opIdx, Dependencies.imageXObject).recordOperation(opIdx);
      this.imagesTracker?.record(ctx, width, height, this.dependencyTracker.clipBox);
    }
    drawImageAtIntegerCoords(ctx, scaled.img, 0, 0, scaled.paintWidth, scaled.paintHeight, 0, -height, width, height);
    if (scaled.tmpCanvas) {
      this.canvasFactory.destroy(scaled.tmpCanvas);
    }
    if (inlineImgCanvas) {
      this.canvasFactory.destroy(inlineImgCanvas);
    }
    this.compose();
    this.restore(opIdx);
    this.#endKnockoutElement(started);
  }
  paintInlineImageXObjectGroup(opIdx, imgData, map) {
    if (!this.contentVisible) {
      return;
    }
    const started = this.#beginKnockoutElement(this.current.fillAlpha);
    const ctx = this.ctx;
    let imgToPaint;
    let inlineImgCanvas = null;
    if (imgData.bitmap && !this.current.transferMapsFallback) {
      imgToPaint = imgData.bitmap;
    } else if (imgData.bitmap) {
      ({
        img: imgToPaint,
        canvasEntry: inlineImgCanvas
      } = this.applyTransferMapsToBitmap(imgData));
    } else {
      const w = imgData.width;
      const h = imgData.height;
      const tmpCanvas = this.canvasFactory.create(w, h);
      putBinaryImageData(tmpCanvas.context, imgData);
      imgToPaint = this.applyTransferMapsToCanvas(tmpCanvas.context);
      inlineImgCanvas = tmpCanvas;
    }
    this.dependencyTracker?.resetBBox(opIdx);
    for (const entry of map) {
      ctx.save();
      ctx.transform(...entry.transform);
      ctx.scale(1, -1);
      drawImageAtIntegerCoords(ctx, imgToPaint, entry.x, entry.y, entry.w, entry.h, 0, -1, 1, 1);
      this.dependencyTracker?.recordBBox(opIdx, ctx, 0, 1, -1, 0);
      ctx.restore();
    }
    if (inlineImgCanvas) {
      this.canvasFactory.destroy(inlineImgCanvas);
    }
    this.dependencyTracker?.recordOperation(opIdx);
    this.compose();
    this.#endKnockoutElement(started);
  }
  paintSolidColorImageMask(opIdx) {
    if (!this.contentVisible) {
      return;
    }
    const started = this.#beginKnockoutElement(this.current.fillAlpha);
    this.dependencyTracker?.resetBBox(opIdx).recordBBox(opIdx, this.ctx, 0, 1, 0, 1).recordDependencies(opIdx, Dependencies.fill).recordOperation(opIdx);
    this.ctx.fillRect(0, 0, 1, 1);
    this.compose();
    this.#endKnockoutElement(started);
  }
  markPoint(opIdx, tag) {}
  markPointProps(opIdx, tag, properties) {}
  beginMarkedContent(opIdx, tag) {
    this.dependencyTracker?.beginMarkedContent(opIdx);
    this.markedContentStack.push({
      visible: true
    });
  }
  beginMarkedContentProps(opIdx, tag, properties) {
    this.dependencyTracker?.beginMarkedContent(opIdx);
    if (tag === "OC") {
      this.markedContentStack.push({
        visible: this.optionalContentConfig.isVisible(properties)
      });
    } else {
      this.markedContentStack.push({
        visible: true
      });
    }
    this.contentVisible = this.isContentVisible();
  }
  endMarkedContent(opIdx) {
    this.dependencyTracker?.endMarkedContent(opIdx);
    this.markedContentStack.pop();
    this.contentVisible = this.isContentVisible();
  }
  beginCompat(opIdx) {}
  endCompat(opIdx) {}
  consumePath(opIdx, path, clipBox) {
    const isEmpty = this.current.isEmptyClip();
    if (this.pendingClip) {
      this.current.updateClipFromPath();
    }
    if (!this.pendingClip) {
      this.compose(clipBox);
    }
    const ctx = this.ctx;
    if (this.pendingClip) {
      if (!isEmpty) {
        if (this.pendingClip === EO_CLIP) {
          ctx.clip(path, "evenodd");
        } else {
          ctx.clip(path);
        }
      }
      this.pendingClip = null;
      this.dependencyTracker?.bboxToClipBoxDropOperation(opIdx).recordFutureForcedDependency("clipPath", opIdx);
    } else {
      this.dependencyTracker?.recordOperation(opIdx);
    }
    this.current.startNewPathAndClipBox(this.current.clipBox);
  }
  getSinglePixelWidth() {
    const m = getCurrentTransform(this.ctx);
    if (m[1] === 0 && m[2] === 0) {
      return 1 / Math.min(Math.abs(m[0]), Math.abs(m[3]));
    }
    const absDet = Math.abs(m[0] * m[3] - m[2] * m[1]);
    const normX = Math.hypot(m[0], m[2]);
    const normY = Math.hypot(m[1], m[3]);
    return Math.max(normX, normY) / absDet;
  }
  getScaleForStroking() {
    if (this._cachedScaleForStroking[0] === -1) {
      const {
        lineWidth
      } = this.current;
      const {
        a,
        b,
        c,
        d
      } = this.ctx.getTransform();
      let scaleX, scaleY;
      if (b === 0 && c === 0) {
        const normX = Math.abs(a);
        const normY = Math.abs(d);
        if (normX === normY) {
          if (lineWidth === 0) {
            scaleX = scaleY = 1 / normX;
          } else {
            const scaledLineWidth = normX * lineWidth;
            scaleX = scaleY = scaledLineWidth < 1 ? 1 / scaledLineWidth : 1;
          }
        } else if (lineWidth === 0) {
          scaleX = 1 / normX;
          scaleY = 1 / normY;
        } else {
          const scaledXLineWidth = normX * lineWidth;
          const scaledYLineWidth = normY * lineWidth;
          scaleX = scaledXLineWidth < 1 ? 1 / scaledXLineWidth : 1;
          scaleY = scaledYLineWidth < 1 ? 1 / scaledYLineWidth : 1;
        }
      } else {
        const absDet = Math.abs(a * d - b * c);
        const normX = Math.hypot(a, b);
        const normY = Math.hypot(c, d);
        if (lineWidth === 0) {
          scaleX = normY / absDet;
          scaleY = normX / absDet;
        } else {
          const baseArea = lineWidth * absDet;
          scaleX = normY > baseArea ? normY / baseArea : 1;
          scaleY = normX > baseArea ? normX / baseArea : 1;
        }
      }
      this._cachedScaleForStroking[0] = scaleX;
      this._cachedScaleForStroking[1] = scaleY;
    }
    return this._cachedScaleForStroking;
  }
  rescaleAndStroke(path, saveRestore) {
    const {
      ctx,
      current: {
        lineWidth
      }
    } = this;
    const [scaleX, scaleY] = this.getScaleForStroking();
    if (scaleX === scaleY) {
      ctx.lineWidth = (lineWidth || 1) * scaleX;
      ctx.stroke(path);
      return;
    }
    const SCALE_MATRIX = CanvasGraphics.#SCALE_MATRIX ??= new DOMMatrix();
    const dashes = ctx.getLineDash();
    if (saveRestore) {
      ctx.save();
    }
    ctx.scale(scaleX, scaleY);
    SCALE_MATRIX.a = 1 / scaleX;
    SCALE_MATRIX.d = 1 / scaleY;
    const newPath = new Path2D();
    newPath.addPath(path, SCALE_MATRIX);
    if (dashes.length > 0) {
      const scale = Math.max(scaleX, scaleY);
      ctx.setLineDash(dashes.map(x => x / scale));
      ctx.lineDashOffset /= scale;
    }
    ctx.lineWidth = lineWidth || 1;
    ctx.stroke(newPath);
    if (saveRestore) {
      ctx.restore();
    }
  }
  isContentVisible() {
    for (let i = this.markedContentStack.length - 1; i >= 0; i--) {
      if (!this.markedContentStack[i].visible) {
        return false;
      }
    }
    return true;
  }
}
for (const op in OPS) {
  if (CanvasGraphics.prototype[op] !== undefined) {
    CanvasGraphics.prototype[OPS[op]] = CanvasGraphics.prototype[op];
  }
}
export { CanvasGraphics, getAnnotationCanvasName, setAnnotationCanvasName };