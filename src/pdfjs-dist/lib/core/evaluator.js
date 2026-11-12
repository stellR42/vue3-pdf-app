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
import "core-js/modules/es.iterator.every.js";
import "core-js/modules/es.iterator.filter.js";
import "core-js/modules/es.iterator.for-each.js";
import "core-js/modules/es.iterator.some.js";
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
import { AbortException, assert, BBOX_INIT, DEFAULT_VERTICAL_ADVANCE, DEFAULT_VERTICAL_ORIGIN_Y, DrawOPS, F32_BBOX_INIT, FONT_IDENTITY_MATRIX, FormatError, info, isArrayEqual, normalizeUnicode, OPS, shadow, TextRenderingMode, Util, warn } from "../shared/util.js";
import { CheckedOperatorList, OperatorList } from "./operator_list.js";
import { CMapFactory, IdentityCMap } from "./cmap.js";
import { Cmd, Dict, EOF, isName, Name, Ref, RefSet } from "./primitives.js";
import { compileType3Glyph, FontFlags, normalizeFontName } from "./fonts_utils.js";
import { ErrorFont, Font } from "./fonts.js";
import { fetchBinaryData, IDENTITY_MATRIX, isNumberArray, lookupMatrix, lookupNormalRect } from "./core_utils.js";
import { getEncoding, MacRomanEncoding, StandardEncoding, SymbolSetEncoding, WinAnsiEncoding, ZapfDingbatsEncoding } from "./encodings.js";
import { getFontNameToFileMap, getSerifFonts, getStandardFontName, getStdFontMap, getSymbolsFonts, isKnownFontName } from "./standard_fonts.js";
import { getTilingPatternIR, Pattern } from "./pattern.js";
import { getXfaFontDict, getXfaFontName } from "./xfa_fonts.js";
import { IdentityToUnicodeMap, ToUnicodeMap } from "./to_unicode_map.js";
import { isPDFFunction, PDFFunctionFactory } from "./function.js";
import { Lexer, Parser } from "./parser.js";
import { LocalColorSpaceCache, LocalGStateCache, LocalImageCache, LocalTilingPatternCache, RegionalImageCache } from "./image_utils.js";
import { parseMarkedContentProps, textSinkWrapper } from "./evaluator_utils.js";
import { BaseStream } from "./base_stream.js";
import { bidi } from "./bidi.js";
import { CharCodeMap } from "./char_code_map.js";
import { ColorSpace } from "./colorspace.js";
import { ColorSpaceUtils } from "./colorspace_utils.js";
import { compilePatternInfo } from "./obj_bin_transform_core.js";
import { getFontSubstitution } from "./font_substitutions.js";
import { getGlyphsUnicode } from "./glyphlist.js";
import { getMetrics } from "./metrics.js";
import { getUnicodeForGlyph } from "./unicode.js";
import { MurmurHash3_64 } from "../shared/murmurhash3.js";
import { PDFImage } from "./image.js";
import { Stream } from "./stream.js";
import { stringToPDFString } from "./string_utils.js";
const DefaultPartialEvaluatorOptions = Object.freeze({
  maxImageSize: -1,
  disableFontFace: false,
  ignoreErrors: false,
  isOffscreenCanvasSupported: false,
  isImageDecoderSupported: false,
  canvasMaxAreaInBytes: -1,
  fontExtraProperties: false,
  useSystemFonts: true,
  useWasm: true,
  useWorkerFetch: true,
  cMapUrl: null,
  cMapPacked: true,
  iccUrl: null,
  standardFontDataUrl: null,
  wasmUrl: null
});
const PatternType = {
  TILING: 1,
  SHADING: 2
};
const TEXT_CHUNK_BATCH_SIZE = 10;
const deferred = Promise.resolve();
const argIsDict = arg => arg instanceof Dict;
function normalizeBlendMode(value, parsingArray = false) {
  if (Array.isArray(value)) {
    for (const val of value) {
      const maybeBM = normalizeBlendMode(val, true);
      if (maybeBM) {
        return maybeBM;
      }
    }
    warn(`Unsupported blend mode Array: ${value}`);
    return "source-over";
  }
  if (value instanceof Name) {
    switch (value.name) {
      case "Normal":
      case "Compatible":
        return "source-over";
      case "Multiply":
        return "multiply";
      case "Screen":
        return "screen";
      case "Overlay":
        return "overlay";
      case "Darken":
        return "darken";
      case "Lighten":
        return "lighten";
      case "ColorDodge":
        return "color-dodge";
      case "ColorBurn":
        return "color-burn";
      case "HardLight":
        return "hard-light";
      case "SoftLight":
        return "soft-light";
      case "Difference":
        return "difference";
      case "Exclusion":
        return "exclusion";
      case "Hue":
        return "hue";
      case "Saturation":
        return "saturation";
      case "Color":
        return "color";
      case "Luminosity":
        return "luminosity";
    }
    warn(`Unsupported blend mode: ${value.name}`);
  }
  return parsingArray ? null : "source-over";
}
function addCachedImageOps(opList, {
  objId,
  fn,
  args,
  optionalContent,
  hasMask
}) {
  if (objId) {
    opList.addDependency(objId);
  }
  opList.addImageOps(fn, args, optionalContent, hasMask);
  if (fn === OPS.paintImageMaskXObject && args[0]?.count > 0) {
    args[0].count++;
  }
}
class TimeSlotManager {
  static TIME_SLOT_DURATION_MS = 20;
  static CHECK_TIME_EVERY = 100;
  constructor() {
    this.reset();
  }
  check() {
    if (++this.checked < TimeSlotManager.CHECK_TIME_EVERY) {
      return false;
    }
    this.checked = 0;
    return this.endTime <= Date.now();
  }
  reset() {
    this.endTime = Date.now() + TimeSlotManager.TIME_SLOT_DURATION_MS;
    this.checked = 0;
  }
}
class PartialEvaluator {
  constructor({
    xref,
    handler,
    pageIndex,
    pageProxyId = null,
    idFactory,
    fontCache,
    builtInCMapCache,
    standardFontDataCache,
    globalColorSpaceCache,
    globalImageCache,
    systemFontCache,
    options = null
  }) {
    this.xref = xref;
    this.handler = handler;
    this.pageIndex = pageIndex;
    this.pageProxyId = pageProxyId;
    this.idFactory = idFactory;
    this.fontCache = fontCache;
    this.builtInCMapCache = builtInCMapCache;
    this.standardFontDataCache = standardFontDataCache;
    this.globalColorSpaceCache = globalColorSpaceCache;
    this.globalImageCache = globalImageCache;
    this.systemFontCache = systemFontCache;
    this.options = options || DefaultPartialEvaluatorOptions;
    this.type3FontRefs = null;
    this._regionalImageCache = new RegionalImageCache();
    this._fetchBuiltInCMapBound = this.fetchBuiltInCMap.bind(this);
  }
  get _pdfFunctionFactory() {
    return shadow(this, "_pdfFunctionFactory", new PDFFunctionFactory({
      xref: this.xref
    }));
  }
  get parsingType3Font() {
    return !!this.type3FontRefs;
  }
  clone(newOptions = null) {
    const newEvaluator = Object.create(this);
    newEvaluator.options = Object.assign(Object.create(null), this.options, newOptions);
    return newEvaluator;
  }
  hasBlendModes(resources, nonBlendModesSet) {
    if (!(resources instanceof Dict)) {
      return false;
    }
    if (resources.objId && nonBlendModesSet.has(resources.objId)) {
      return false;
    }
    const processed = new RefSet(nonBlendModesSet);
    if (resources.objId) {
      processed.put(resources.objId);
    }
    const nodes = [resources],
      xref = this.xref;
    while (nodes.length) {
      const node = nodes.shift();
      const graphicStates = node.get("ExtGState");
      if (graphicStates instanceof Dict) {
        for (let graphicState of graphicStates.getRawValues()) {
          if (graphicState instanceof Ref) {
            if (processed.has(graphicState)) {
              continue;
            }
            try {
              graphicState = xref.fetch(graphicState);
            } catch (ex) {
              processed.put(graphicState);
              info(`hasBlendModes - ignoring ExtGState: "${ex}".`);
              continue;
            }
          }
          if (!(graphicState instanceof Dict)) {
            continue;
          }
          if (graphicState.objId) {
            processed.put(graphicState.objId);
          }
          const bm = graphicState.get("BM");
          if (bm instanceof Name) {
            if (bm.name !== "Normal") {
              return true;
            }
            continue;
          }
          if (bm !== undefined && Array.isArray(bm)) {
            for (const element of bm) {
              if (element instanceof Name && element.name !== "Normal") {
                return true;
              }
            }
          }
        }
      }
      const xObjects = node.get("XObject");
      if (!(xObjects instanceof Dict)) {
        continue;
      }
      for (let xObject of xObjects.getRawValues()) {
        if (xObject instanceof Ref) {
          if (processed.has(xObject)) {
            continue;
          }
          try {
            xObject = xref.fetch(xObject);
          } catch (ex) {
            processed.put(xObject);
            info(`hasBlendModes - ignoring XObject: "${ex}".`);
            continue;
          }
        }
        if (!(xObject instanceof BaseStream)) {
          continue;
        }
        if (xObject.dict.objId) {
          processed.put(xObject.dict.objId);
        }
        const xResources = xObject.dict.get("Resources");
        if (!(xResources instanceof Dict)) {
          continue;
        }
        if (xResources.objId && processed.has(xResources.objId)) {
          continue;
        }
        nodes.push(xResources);
        if (xResources.objId) {
          processed.put(xResources.objId);
        }
      }
    }
    for (const ref of processed) {
      nonBlendModesSet.put(ref);
    }
    return false;
  }
  async fetchBuiltInCMap(name) {
    const cachedData = this.builtInCMapCache.get(name);
    if (cachedData) {
      return cachedData;
    }
    let data;
    if (this.options.useWorkerFetch) {
      data = {
        cMapData: await fetchBinaryData(`${this.options.cMapUrl}${name}.bcmap`),
        isCompressed: true
      };
    } else {
      data = {
        cMapData: await this.handler.sendWithPromise("FetchBinaryData", {
          kind: "cMapUrl",
          filename: `${name}${this.options.cMapPacked ? ".bcmap" : ""}`
        }),
        isCompressed: this.options.cMapPacked
      };
    }
    this.builtInCMapCache.set(name, data);
    return data;
  }
  async fetchStandardFontData(name) {
    const cachedData = this.standardFontDataCache.get(name);
    if (cachedData) {
      return new Stream(cachedData);
    }
    if (this.options.useSystemFonts && name !== "Symbol" && name !== "ZapfDingbats") {
      return null;
    }
    const standardFontNameToFileName = getFontNameToFileMap(),
      filename = standardFontNameToFileName[name];
    let data;
    try {
      if (this.options.useWorkerFetch) {
        data = await fetchBinaryData(`${this.options.standardFontDataUrl}${filename}`);
      } else {
        data = await this.handler.sendWithPromise("FetchBinaryData", {
          kind: "standardFontDataUrl",
          filename
        });
      }
    } catch (ex) {
      warn(ex);
      return null;
    }
    this.standardFontDataCache.set(name, data);
    return new Stream(data);
  }
  async buildFormXObject(resources, xobj, smask, operatorList, task, initialState, localColorSpaceCache, seenRefs) {
    const {
      dict
    } = xobj;
    const matrix = lookupMatrix(dict.getArray("Matrix"), null);
    const bbox = lookupNormalRect(dict.getArray("BBox"), null);
    let f32bbox = bbox && new Float32Array(bbox);
    if (f32bbox?.some(x => !isFinite(x))) {
      f32bbox = null;
    }
    let optionalContent, groupOptions;
    if (dict.has("OC")) {
      optionalContent = await this.parseMarkedContentProps(dict.get("OC"), resources);
    }
    if (optionalContent !== undefined) {
      operatorList.addOp(OPS.beginMarkedContentProps, ["OC", optionalContent]);
    }
    const group = dict.get("Group");
    let newOpList;
    const f32matrix = matrix && new Float32Array(matrix);
    const args = [f32matrix, !group && f32bbox || null];
    const localResources = dict.get("Resources");
    if (group) {
      groupOptions = {
        matrix,
        bbox: f32bbox,
        smask,
        isolated: false,
        knockout: false,
        needsIsolation: false,
        hasSoftMask: false,
        isGray: false
      };
      const groupSubtype = group.get("S");
      let colorSpace = null;
      if (isName(groupSubtype, "Transparency")) {
        groupOptions.isolated = group.get("I") || false;
        groupOptions.knockout = group.get("K") || false;
        if (group.has("CS")) {
          const cs = this._getColorSpace(group.getRaw("CS"), resources, localColorSpaceCache);
          colorSpace = cs instanceof ColorSpace ? cs : await this._handleColorSpace(cs);
        }
      }
      groupOptions.isGray = colorSpace?.numComps === 1;
      if (smask?.backdrop) {
        colorSpace ||= ColorSpaceUtils.rgb;
        smask.backdrop = colorSpace.getRgbHex(smask.backdrop, 0);
      } else if (smask?.subtype === "Luminosity") {
        smask.backdrop = "#000000";
      }
      newOpList = new CheckedOperatorList();
    } else {
      newOpList = operatorList;
      operatorList.addOp(OPS.paintFormXObjectBegin, args);
    }
    await this.getOperatorList({
      stream: xobj,
      task,
      resources: localResources instanceof Dict ? localResources : resources,
      operatorList: newOpList,
      initialState,
      prevRefs: seenRefs
    });
    if (group) {
      groupOptions.needsIsolation = newOpList.needsIsolation || !!smask;
      groupOptions.hasSoftMask = newOpList.hasSoftMask || !!smask;
      operatorList.addOp(OPS.beginGroup, [groupOptions]);
      operatorList.addOp(OPS.paintFormXObjectBegin, args);
      operatorList.addOpList(newOpList);
      operatorList.addOp(OPS.paintFormXObjectEnd, []);
      operatorList.addOp(OPS.endGroup, [groupOptions]);
    } else {
      operatorList.addOp(OPS.paintFormXObjectEnd, []);
    }
    if (optionalContent !== undefined) {
      operatorList.addOp(OPS.endMarkedContent, []);
    }
  }
  _sendImgData(objId, imgData, cacheGlobally = false) {
    const transfers = imgData ? [imgData.bitmap || imgData.data.buffer] : null;
    if (this.parsingType3Font || cacheGlobally) {
      return this.handler.send("commonobj", [objId, "Image", imgData], transfers);
    }
    return this.handler.send("obj", [objId, this.pageProxyId, "Image", imgData], transfers);
  }
  async buildPaintImageXObject({
    resources,
    image,
    isInline = false,
    operatorList,
    cacheKey,
    localImageCache,
    localColorSpaceCache
  }) {
    const {
      maxImageSize,
      ignoreErrors,
      isOffscreenCanvasSupported
    } = this.options;
    const {
      dict
    } = image;
    const imageRef = dict.objId;
    const w = dict.get("W", "Width");
    const h = dict.get("H", "Height");
    if (!(w && typeof w === "number") || !(h && typeof h === "number")) {
      warn("Image dimensions are missing, or not numbers.");
      return;
    }
    if (maxImageSize !== -1 && w * h > maxImageSize) {
      const msg = "Image exceeded maximum allowed size and was removed.";
      if (!ignoreErrors) {
        throw new Error(msg);
      }
      warn(msg);
      return;
    }
    let optionalContent;
    if (dict.has("OC")) {
      optionalContent = await this.parseMarkedContentProps(dict.get("OC"), resources);
    }
    const imageMask = dict.get("IM", "ImageMask") || false;
    let imgData, fn, args;
    if (imageMask) {
      imgData = await PDFImage.createMask({
        image,
        isOffscreenCanvasSupported: isOffscreenCanvasSupported && !this.parsingType3Font
      });
      if (imgData.isSingleOpaquePixel) {
        fn = OPS.paintSolidColorImageMask;
        args = [];
        operatorList.addImageOps(fn, args, optionalContent);
        if (cacheKey) {
          const cacheData = {
            fn,
            args,
            optionalContent
          };
          localImageCache.set(cacheKey, imageRef, cacheData);
          if (imageRef) {
            this._regionalImageCache.set(null, imageRef, cacheData);
          }
        }
        return;
      }
      if (this.parsingType3Font) {
        args = compileType3Glyph(imgData);
        if (args) {
          operatorList.addImageOps(OPS.constructPath, args, optionalContent);
          return;
        }
        warn("Cannot compile Type3 glyph.");
        operatorList.addImageOps(OPS.paintImageMaskXObject, [imgData], optionalContent);
        return;
      }
      const objId = `mask_${this.idFactory.createObjId()}`;
      operatorList.addDependency(objId);
      imgData.dataLen = imgData.bitmap ? imgData.width * imgData.height * 4 : imgData.data.length;
      this._sendImgData(objId, imgData);
      fn = OPS.paintImageMaskXObject;
      args = [{
        data: objId,
        width: imgData.width,
        height: imgData.height,
        interpolate: imgData.interpolate,
        count: 1
      }];
      operatorList.addImageOps(fn, args, optionalContent);
      if (cacheKey) {
        const cacheData = {
          objId,
          fn,
          args,
          optionalContent
        };
        localImageCache.set(cacheKey, imageRef, cacheData);
        if (imageRef) {
          this._regionalImageCache.set(null, imageRef, cacheData);
        }
      }
      return;
    }
    const SMALL_IMAGE_DIMENSIONS = 200;
    const hasMask = dict.has("SMask") || dict.has("Mask");
    if (isInline && w + h < SMALL_IMAGE_DIMENSIONS && !hasMask) {
      try {
        const imageObj = new PDFImage({
          xref: this.xref,
          res: resources,
          image,
          isInline,
          pdfFunctionFactory: this._pdfFunctionFactory,
          globalColorSpaceCache: this.globalColorSpaceCache,
          localColorSpaceCache
        });
        imgData = await imageObj.createImageData(true, false);
        operatorList.addImageOps(OPS.paintInlineImageXObject, [imgData], optionalContent);
      } catch (reason) {
        const msg = `Unable to decode inline image: "${reason}".`;
        if (!ignoreErrors) {
          throw new Error(msg);
        }
        warn(msg);
      }
      return;
    }
    let objId = `img_${this.idFactory.createObjId()}`,
      cacheGlobally = false,
      keepDecodedImage = false,
      globalCacheData = null;
    if (this.parsingType3Font) {
      objId = `${this.idFactory.getDocId()}_type3_${objId}`;
    } else if (cacheKey && imageRef) {
      cacheGlobally = this.globalImageCache.shouldCache(imageRef, this.pageIndex);
      if (cacheGlobally) {
        assert(!isInline, "Cannot cache an inline image globally.");
        objId = `${this.idFactory.getDocId()}_${objId}`;
      } else if (this.pageProxyId !== null) {
        this.globalImageCache.startDecodedImage(imageRef, this.pageProxyId);
        keepDecodedImage = true;
      }
    }
    operatorList.addDependency(objId);
    fn = OPS.paintImageXObject;
    args = [objId, w, h];
    operatorList.addImageOps(fn, args, optionalContent, hasMask);
    if (cacheGlobally) {
      globalCacheData = {
        objId,
        fn,
        args,
        optionalContent,
        hasMask,
        byteSize: 0
      };
      if (this.globalImageCache.hasDecodeFailed(imageRef)) {
        this.globalImageCache.setData(imageRef, globalCacheData);
        this._sendImgData(objId, null, cacheGlobally);
        return;
      }
      const decodedImgData = this.globalImageCache.takeDecodedImage(imageRef);
      if (decodedImgData) {
        this.globalImageCache.setData(imageRef, globalCacheData);
        this.globalImageCache.addByteSize(imageRef, decodedImgData.dataLen);
        this._sendImgData(objId, decodedImgData, cacheGlobally);
        return;
      }
      if (w * h > 250000 || hasMask) {
        const localLength = await this.handler.sendWithPromise("commonobj", [objId, "CopyLocalImage", {
          imageRef
        }]);
        if (localLength) {
          this.globalImageCache.setData(imageRef, globalCacheData);
          this.globalImageCache.addByteSize(imageRef, localLength);
          return;
        }
      }
    }
    PDFImage.buildImage({
      xref: this.xref,
      res: resources,
      image,
      isInline,
      pdfFunctionFactory: this._pdfFunctionFactory,
      globalColorSpaceCache: this.globalColorSpaceCache,
      localColorSpaceCache
    }).then(async imageObj => {
      imgData = await imageObj.createImageData(false, isOffscreenCanvasSupported);
      imgData.dataLen = imgData.bitmap ? imgData.width * imgData.height * 4 : imgData.data.length;
      imgData.ref = imageRef;
      if (cacheGlobally) {
        this.globalImageCache.addByteSize(imageRef, imgData.dataLen);
      } else if (keepDecodedImage) {
        this.globalImageCache.setDecodedImage(imageRef, imgData);
      }
      return this._sendImgData(objId, imgData, cacheGlobally);
    }).catch(reason => {
      warn(`Unable to decode image "${objId}": "${reason}".`);
      if (imageRef) {
        this.globalImageCache.addDecodeFailed(imageRef);
      }
      return this._sendImgData(objId, null, cacheGlobally);
    });
    if (cacheKey) {
      const cacheData = {
        objId,
        fn,
        args,
        optionalContent,
        hasMask
      };
      localImageCache.set(cacheKey, imageRef, cacheData);
      if (imageRef) {
        this._regionalImageCache.set(null, imageRef, cacheData);
        if (cacheGlobally) {
          assert(globalCacheData, "The global cache-data must be available.");
          this.globalImageCache.setData(imageRef, globalCacheData);
        }
      }
    }
  }
  #createTransferMap(fn) {
    const transferFn = this._pdfFunctionFactory.create(fn),
      tmp = new Float32Array(1);
    return Uint8Array.from({
      length: 256
    }, (_, i) => {
      tmp[0] = i / 255;
      transferFn(tmp, 0, tmp, 0);
      return tmp[0] * 255 | 0;
    });
  }
  handleSMask(smask, resources, operatorList, task, stateManager, localColorSpaceCache, seenRefs) {
    const smaskContent = smask.get("G");
    const smaskOptions = {
      subtype: smask.get("S").name,
      backdrop: smask.get("BC")
    };
    const transferObj = smask.get("TR");
    if (isPDFFunction(transferObj)) {
      smaskOptions.transferMap = this.#createTransferMap(transferObj);
    }
    return this.buildFormXObject(resources, smaskContent, smaskOptions, operatorList, task, stateManager.state.clone({
      newPath: true
    }), localColorSpaceCache, seenRefs);
  }
  handleTransferFunction(tr) {
    let transferArray;
    if (Array.isArray(tr)) {
      transferArray = tr.length > 1 && tr.every(map => map === tr[0]) ? [tr[0]] : tr;
    } else if (isPDFFunction(tr)) {
      transferArray = [tr];
    } else {
      return null;
    }
    const transferMaps = [];
    let numFns = 0,
      numEffectfulFns = 0;
    for (const entry of transferArray) {
      const transferObj = this.xref.fetchIfRef(entry);
      numFns++;
      if (isName(transferObj, "Identity")) {
        transferMaps.push(null);
        continue;
      } else if (!isPDFFunction(transferObj)) {
        return null;
      }
      transferMaps.push(this.#createTransferMap(transferObj));
      numEffectfulFns++;
    }
    if (!(numFns === 1 || numFns === 4)) {
      return null;
    }
    if (numEffectfulFns === 0) {
      return null;
    }
    return transferMaps;
  }
  handleTilingType(fn, color, resources, pattern, patternDict, operatorList, task, localTilingPatternCache, seenRefs) {
    const tilingOpList = new CheckedOperatorList();
    const patternResources = Dict.merge({
      xref: this.xref,
      dictArray: [patternDict.get("Resources"), resources]
    });
    return this.getOperatorList({
      stream: pattern,
      task,
      resources: patternResources,
      operatorList: tilingOpList,
      prevRefs: seenRefs
    }).then(function () {
      const operatorListIR = tilingOpList.getIR();
      const {
        needsIsolation
      } = tilingOpList;
      const tilingPatternIR = getTilingPatternIR(operatorListIR, patternDict, color, needsIsolation);
      operatorList.addDependencies(tilingOpList.dependencies);
      operatorList.addOp(fn, tilingPatternIR);
      if (patternDict.objId) {
        localTilingPatternCache.set(null, patternDict.objId, {
          operatorListIR,
          needsIsolation,
          dict: patternDict
        });
      }
    }).catch(reason => {
      if (reason instanceof AbortException) {
        return;
      }
      if (this.options.ignoreErrors) {
        warn(`handleTilingType - ignoring pattern: "${reason}".`);
        return;
      }
      throw reason;
    });
  }
  async handleSetFont(resources, fontArgs, fontRef, operatorList, task, state, fallbackFontDict = null, cssFontInfo = null, seenRefs = null) {
    const fontName = fontArgs?.[0] instanceof Name ? fontArgs[0].name : null;
    const translated = await this.loadFont(fontName, fontRef, resources, task, fallbackFontDict, cssFontInfo, seenRefs);
    if (translated.font.isType3Font) {
      operatorList.addDependencies(translated.type3Dependencies);
    }
    state.font = translated.font;
    translated.send(this.handler);
    return translated.loadedName;
  }
  handleText(chars, state) {
    const font = state.font;
    const glyphs = font.charsToGlyphs(chars);
    if (font.data) {
      const isAddToPathSet = !!(state.textRenderingMode & TextRenderingMode.ADD_TO_PATH_FLAG);
      if (isAddToPathSet || state.fillColorSpace.name === "Pattern" || state.strokeColorSpace.name === "Pattern" || font.disableFontFace) {
        PartialEvaluator.buildFontPaths(font, glyphs, this.handler, this.options);
      }
    }
    return glyphs;
  }
  ensureStateFont(state) {
    if (state.font) {
      return;
    }
    const reason = new FormatError("Missing setFont (Tf) operator before text rendering operator.");
    if (this.options.ignoreErrors) {
      warn(`ensureStateFont: "${reason}".`);
      return;
    }
    throw reason;
  }
  async setGState({
    resources,
    gState,
    operatorList,
    cacheKey,
    task,
    stateManager,
    localGStateCache,
    localColorSpaceCache,
    seenRefs
  }) {
    const gStateRef = gState.objId;
    let isSimpleGState = true;
    const gStateObj = [];
    let promise = Promise.resolve();
    for (const [key, value] of gState) {
      switch (key) {
        case "Type":
          break;
        case "LW":
          if (typeof value !== "number") {
            warn(`Invalid LW (line width): ${value}`);
            break;
          }
          gStateObj.push([key, Math.abs(value)]);
          break;
        case "LC":
        case "LJ":
        case "ML":
        case "D":
        case "RI":
        case "FL":
        case "CA":
        case "ca":
          gStateObj.push([key, value]);
          break;
        case "Font":
          isSimpleGState = false;
          promise = promise.then(() => this.handleSetFont(resources, null, value[0], operatorList, task, stateManager.state, null, null, seenRefs).then(function (loadedName) {
            operatorList.addDependency(loadedName);
            gStateObj.push([key, [loadedName, value[1]]]);
          }));
          break;
        case "BM":
          gStateObj.push([key, normalizeBlendMode(value)]);
          break;
        case "SMask":
          if (isName(value, "None")) {
            gStateObj.push([key, false]);
            break;
          }
          if (value instanceof Dict) {
            isSimpleGState = false;
            promise = promise.then(() => this.handleSMask(value, resources, operatorList, task, stateManager, localColorSpaceCache, seenRefs));
            gStateObj.push([key, true]);
          } else {
            warn("Unsupported SMask type");
          }
          break;
        case "TR":
          if (gState.has("TR2")) {
            break;
          }
        case "TR2":
          {
            const transferMaps = this.handleTransferFunction(value);
            gStateObj.push(["TR", transferMaps]);
            break;
          }
        case "OP":
        case "op":
        case "OPM":
        case "BG":
        case "BG2":
        case "UCR":
        case "UCR2":
        case "HT":
        case "SM":
        case "SA":
        case "AIS":
        case "TK":
          info("graphic state operator " + key);
          break;
        default:
          info("Unknown graphic state operator " + key);
          break;
      }
    }
    await promise;
    if (gStateObj.length > 0) {
      operatorList.addOp(OPS.setGState, [gStateObj]);
    }
    if (isSimpleGState) {
      localGStateCache.set(cacheKey, gStateRef, gStateObj);
    }
  }
  loadFont(fontName, font, resources, task, fallbackFontDict = null, cssFontInfo = null, seenRefs = null) {
    const errorFont = async () => new TranslatedFont({
      loadedName: "g_font_error",
      font: new ErrorFont(`Font "${fontName}" is not available.`),
      dict: font
    });
    let fontRef;
    if (font) {
      if (font instanceof Ref) {
        fontRef = font;
      }
    } else {
      const fontRes = resources.get("Font");
      if (fontRes) {
        fontRef = fontRes.getRaw(fontName);
      }
    }
    if (fontRef) {
      if (this.type3FontRefs?.has(fontRef)) {
        return errorFont();
      }
      if (this.fontCache.has(fontRef)) {
        return this.fontCache.get(fontRef);
      }
      try {
        font = this.xref.fetchIfRef(fontRef);
      } catch (ex) {
        warn(`loadFont - lookup failed: "${ex}".`);
      }
    }
    if (!(font instanceof Dict)) {
      if (!this.options.ignoreErrors && !this.parsingType3Font) {
        warn(`Font "${fontName}" is not available.`);
        return errorFont();
      }
      warn(`Font "${fontName}" is not available -- attempting to fallback to a default font.`);
      font = fallbackFontDict || PartialEvaluator.fallbackFontDict;
    }
    if (font.cacheKey && this.fontCache.has(font.cacheKey)) {
      return this.fontCache.get(font.cacheKey);
    }
    const {
      promise,
      resolve
    } = Promise.withResolvers();
    let preEvaluatedFont;
    try {
      preEvaluatedFont = this.preEvaluateFont(font);
      preEvaluatedFont.cssFontInfo = cssFontInfo;
    } catch (reason) {
      warn(`loadFont - preEvaluateFont failed: "${reason}".`);
      return errorFont();
    }
    const {
      descriptor,
      hash
    } = preEvaluatedFont;
    const fontRefIsRef = fontRef instanceof Ref;
    let fontID;
    if (hash && descriptor instanceof Dict) {
      const fontAliases = descriptor.fontAliases ||= Object.create(null);
      if (fontAliases[hash]) {
        const aliasFontRef = fontAliases[hash].aliasRef;
        if (fontRefIsRef && aliasFontRef && this.fontCache.has(aliasFontRef)) {
          this.fontCache.putAlias(fontRef, aliasFontRef);
          return this.fontCache.get(fontRef);
        }
      } else {
        fontAliases[hash] = {
          fontID: this.idFactory.createFontId()
        };
      }
      if (fontRefIsRef) {
        fontAliases[hash].aliasRef = fontRef;
      }
      fontID = fontAliases[hash].fontID;
    } else {
      fontID = this.idFactory.createFontId();
    }
    assert(fontID?.startsWith("f"), 'The "fontID" must be (correctly) defined.');
    if (fontRefIsRef) {
      this.fontCache.put(fontRef, promise);
    } else {
      font.cacheKey = `cacheKey_${fontID}`;
      this.fontCache.put(font.cacheKey, promise);
    }
    font.loadedName = `${this.idFactory.getDocId()}_${fontID}`;
    this.translateFont(preEvaluatedFont).then(async translatedFont => {
      const translated = new TranslatedFont({
        loadedName: font.loadedName,
        font: translatedFont,
        dict: font
      });
      if (translatedFont.isType3Font) {
        try {
          await translated.loadType3Data(this, resources, task, seenRefs);
        } catch (reason) {
          throw new Error(`Type3 font load error: ${reason}`);
        }
      }
      resolve(translated);
    }).catch(reason => {
      warn(`loadFont - translateFont failed: "${reason}".`);
      resolve(new TranslatedFont({
        loadedName: font.loadedName,
        font: new ErrorFont(reason?.message),
        dict: font
      }));
    });
    return promise;
  }
  buildPath(fn, args, state) {
    const {
      pathMinMax: minMax,
      pathBuffer
    } = state;
    switch (fn | 0) {
      case OPS.rectangle:
        {
          const x = state.currentPointX = args[0];
          const y = state.currentPointY = args[1];
          const width = args[2];
          const height = args[3];
          const xw = x + width;
          const yh = y + height;
          if (width === 0 || height === 0) {
            pathBuffer.push(DrawOPS.moveTo, x, y, DrawOPS.lineTo, xw, yh, DrawOPS.closePath);
          } else {
            pathBuffer.push(DrawOPS.moveTo, x, y, DrawOPS.lineTo, xw, y, DrawOPS.lineTo, xw, yh, DrawOPS.lineTo, x, yh, DrawOPS.closePath);
          }
          Util.rectBoundingBox(x, y, xw, yh, minMax);
          break;
        }
      case OPS.moveTo:
        {
          const x = state.currentPointX = args[0];
          const y = state.currentPointY = args[1];
          pathBuffer.push(DrawOPS.moveTo, x, y);
          Util.pointBoundingBox(x, y, minMax);
          break;
        }
      case OPS.lineTo:
        {
          const x = state.currentPointX = args[0];
          const y = state.currentPointY = args[1];
          pathBuffer.push(DrawOPS.lineTo, x, y);
          Util.pointBoundingBox(x, y, minMax);
          break;
        }
      case OPS.curveTo:
        {
          const startX = state.currentPointX;
          const startY = state.currentPointY;
          const [x1, y1, x2, y2, x, y] = args;
          state.currentPointX = x;
          state.currentPointY = y;
          pathBuffer.push(DrawOPS.curveTo, x1, y1, x2, y2, x, y);
          Util.bezierBoundingBox(startX, startY, x1, y1, x2, y2, x, y, minMax);
          break;
        }
      case OPS.curveTo2:
        {
          const startX = state.currentPointX;
          const startY = state.currentPointY;
          const [x1, y1, x, y] = args;
          state.currentPointX = x;
          state.currentPointY = y;
          pathBuffer.push(DrawOPS.curveTo, startX, startY, x1, y1, x, y);
          Util.bezierBoundingBox(startX, startY, startX, startY, x1, y1, x, y, minMax);
          break;
        }
      case OPS.curveTo3:
        {
          const startX = state.currentPointX;
          const startY = state.currentPointY;
          const [x1, y1, x, y] = args;
          state.currentPointX = x;
          state.currentPointY = y;
          pathBuffer.push(DrawOPS.curveTo, x1, y1, x, y, x, y);
          Util.bezierBoundingBox(startX, startY, x1, y1, x, y, x, y, minMax);
          break;
        }
      case OPS.closePath:
        pathBuffer.push(DrawOPS.closePath);
        break;
    }
  }
  _getColorSpace(cs, resources, localColorSpaceCache) {
    return ColorSpaceUtils.parse({
      cs,
      xref: this.xref,
      resources,
      pdfFunctionFactory: this._pdfFunctionFactory,
      globalColorSpaceCache: this.globalColorSpaceCache,
      localColorSpaceCache,
      asyncIfNotCached: true
    });
  }
  async _handleColorSpace(csPromise) {
    try {
      return await csPromise;
    } catch (ex) {
      if (ex instanceof AbortException) {
        return null;
      }
      if (this.options.ignoreErrors) {
        warn(`_handleColorSpace - ignoring ColorSpace: "${ex}".`);
        return null;
      }
      throw ex;
    }
  }
  parseShading({
    shading,
    resources,
    localColorSpaceCache,
    localShadingPatternCache
  }) {
    let id = localShadingPatternCache.get(shading);
    if (id) {
      return id;
    }
    let patternIR;
    try {
      const shadingFill = Pattern.parseShading(shading, this.xref, resources, this._pdfFunctionFactory, this.globalColorSpaceCache, localColorSpaceCache);
      patternIR = shadingFill.getIR();
    } catch (reason) {
      if (reason instanceof AbortException) {
        return null;
      }
      if (this.options.ignoreErrors) {
        warn(`parseShading - ignoring shading: "${reason}".`);
        localShadingPatternCache.set(shading, null);
        return null;
      }
      throw reason;
    }
    id = `pattern_${this.idFactory.createObjId()}`;
    if (this.parsingType3Font) {
      id = `${this.idFactory.getDocId()}_type3_${id}`;
    }
    localShadingPatternCache.set(shading, id);
    if (this.parsingType3Font) {
      const buffer = compilePatternInfo(patternIR);
      this.handler.send("commonobj", [id, "Pattern", buffer], [buffer]);
    } else {
      this.handler.send("obj", [id, this.pageProxyId, "Pattern", patternIR]);
    }
    return id;
  }
  handleColorN(operatorList, fn, args, cs, patterns, resources, task, localColorSpaceCache, localTilingPatternCache, localShadingPatternCache, seenRefs) {
    const patternName = args.pop();
    if (patternName instanceof Name) {
      const rawPattern = patterns.getRaw(patternName.name);
      const localTilingPattern = rawPattern instanceof Ref && localTilingPatternCache.getByRef(rawPattern);
      if (localTilingPattern) {
        try {
          const color = cs.base ? cs.base.getRgbHex(args, 0) : null;
          const tilingPatternIR = getTilingPatternIR(localTilingPattern.operatorListIR, localTilingPattern.dict, color, localTilingPattern.needsIsolation);
          operatorList.addOp(fn, tilingPatternIR);
          return undefined;
        } catch {}
      }
      const pattern = this.xref.fetchIfRef(rawPattern);
      if (pattern) {
        const dict = pattern instanceof BaseStream ? pattern.dict : pattern;
        const typeNum = dict.get("PatternType");
        if (typeNum === PatternType.TILING) {
          const color = cs.base ? cs.base.getRgbHex(args, 0) : null;
          return this.handleTilingType(fn, color, resources, pattern, dict, operatorList, task, localTilingPatternCache, seenRefs);
        } else if (typeNum === PatternType.SHADING) {
          const shading = dict.get("Shading");
          const objId = this.parseShading({
            shading,
            resources,
            localColorSpaceCache,
            localShadingPatternCache
          });
          if (objId) {
            const matrix = lookupMatrix(dict.getArray("Matrix"), null);
            operatorList.addOp(fn, ["Shading", objId, matrix]);
          }
          return undefined;
        }
        throw new FormatError(`Unknown PatternType: ${typeNum}`);
      }
    }
    throw new FormatError(`Unknown PatternName: ${patternName}`);
  }
  async parseMarkedContentProps(contentProperties, resources) {
    return parseMarkedContentProps(this.xref, contentProperties, resources);
  }
  async getOperatorList({
    stream,
    task,
    resources,
    operatorList,
    initialState = null,
    fallbackFontDict = null,
    prevRefs = null
  }) {
    if (stream.isAsync) {
      const bytes = await stream.asyncGetBytes();
      if (bytes) {
        stream = new Stream(bytes, 0, bytes.length, stream.dict);
      }
    }
    const objId = stream.dict?.objId;
    const seenRefs = new RefSet(prevRefs);
    if (objId) {
      if (prevRefs?.has(objId)) {
        throw new Error(`getOperatorList - ignoring circular reference: ${objId}`);
      }
      seenRefs.put(objId);
    }
    resources ||= Dict.empty;
    initialState ||= new EvalState();
    if (!operatorList) {
      throw new Error('getOperatorList: missing "operatorList" parameter');
    }
    const self = this;
    const xref = this.xref;
    const localImageCache = new LocalImageCache();
    const localColorSpaceCache = new LocalColorSpaceCache();
    const localGStateCache = new LocalGStateCache();
    const localTilingPatternCache = new LocalTilingPatternCache();
    const localShadingPatternCache = new Map();
    const xobjs = resources.get("XObject") || Dict.empty;
    const patterns = resources.get("Pattern") || Dict.empty;
    const stateManager = new StateManager(initialState);
    const preprocessor = new EvaluatorPreprocessor(stream, xref, stateManager);
    const timeSlotManager = new TimeSlotManager();
    let markedContentLevel = 0;
    function closePendingRestoreOPS(argument) {
      for (let i = 0, ii = preprocessor.savedStatesDepth; i < ii; i++) {
        operatorList.addOp(OPS.restore, []);
      }
    }
    function closePendingMarkedContentOPS() {
      for (; markedContentLevel > 0; markedContentLevel--) {
        operatorList.addOp(OPS.endMarkedContent, []);
      }
    }
    return new Promise(function promiseBody(resolve, reject) {
      const next = function (promise) {
        Promise.all([promise, operatorList.ready]).then(function () {
          try {
            promiseBody(resolve, reject);
          } catch (ex) {
            reject(ex);
          }
        }, reject);
      };
      task.ensureNotTerminated();
      timeSlotManager.reset();
      const operation = {};
      let stop, cs, name, isValidName;
      while (!(stop = timeSlotManager.check())) {
        operation.args = null;
        if (!preprocessor.read(operation)) {
          break;
        }
        let args = operation.args;
        let fn = operation.fn;
        switch (fn | 0) {
          case OPS.paintXObject:
            isValidName = args[0] instanceof Name;
            name = args[0].name;
            if (isValidName) {
              const localImage = localImageCache.getByName(name);
              if (localImage) {
                addCachedImageOps(operatorList, localImage);
                args = null;
                continue;
              }
            }
            next(new Promise(function (resolveXObject, rejectXObject) {
              if (!isValidName) {
                throw new FormatError("XObject must be referred to by name.");
              }
              let xobj = xobjs.getRaw(name);
              if (xobj instanceof Ref) {
                const cachedImage = localImageCache.getByRef(xobj) || self._regionalImageCache.getByRef(xobj) || self.globalImageCache.getData(xobj, self.pageIndex);
                if (cachedImage) {
                  addCachedImageOps(operatorList, cachedImage);
                  resolveXObject();
                  return;
                }
                xobj = xref.fetch(xobj);
              }
              if (!(xobj instanceof BaseStream)) {
                throw new FormatError("XObject should be a stream");
              }
              const type = xobj.dict.get("Subtype");
              if (!(type instanceof Name)) {
                throw new FormatError("XObject should have a Name subtype");
              }
              if (type.name === "Form") {
                stateManager.save();
                self.buildFormXObject(resources, xobj, null, operatorList, task, stateManager.state.clone({
                  newPath: true
                }), localColorSpaceCache, seenRefs).then(function () {
                  stateManager.restore();
                  resolveXObject();
                }, rejectXObject);
                return;
              } else if (type.name === "Image") {
                self.buildPaintImageXObject({
                  resources,
                  image: xobj,
                  operatorList,
                  cacheKey: name,
                  localImageCache,
                  localColorSpaceCache
                }).then(resolveXObject, rejectXObject);
                return;
              } else if (type.name === "PS") {
                info("Ignored XObject subtype PS");
              } else {
                throw new FormatError(`Unhandled XObject subtype ${type.name}`);
              }
              resolveXObject();
            }).catch(reason => {
              if (reason instanceof AbortException) {
                return;
              }
              if (self.options.ignoreErrors) {
                warn(`getOperatorList - ignoring XObject: "${reason}".`);
                return;
              }
              throw reason;
            }));
            return;
          case OPS.setFont:
            const fontSize = args[1];
            next(self.handleSetFont(resources, args, null, operatorList, task, stateManager.state, fallbackFontDict, null, seenRefs).then(function (loadedName) {
              operatorList.addDependency(loadedName);
              operatorList.addOp(OPS.setFont, [loadedName, fontSize]);
            }));
            return;
          case OPS.endInlineImage:
            const cacheKey = args[0].cacheKey;
            if (cacheKey) {
              const localImage = localImageCache.getByName(cacheKey);
              if (localImage) {
                addCachedImageOps(operatorList, localImage);
                args = null;
                continue;
              }
            }
            next(self.buildPaintImageXObject({
              resources,
              image: args[0],
              isInline: true,
              operatorList,
              cacheKey,
              localImageCache,
              localColorSpaceCache
            }));
            return;
          case OPS.showText:
            if (!stateManager.state.font) {
              self.ensureStateFont(stateManager.state);
              continue;
            }
            args[0] = self.handleText(args[0], stateManager.state);
            break;
          case OPS.showSpacedText:
            if (!stateManager.state.font) {
              self.ensureStateFont(stateManager.state);
              continue;
            }
            const combinedGlyphs = [],
              state = stateManager.state;
            for (const arrItem of args[0]) {
              if (typeof arrItem === "string") {
                combinedGlyphs.push(...self.handleText(arrItem, state));
              } else if (typeof arrItem === "number") {
                combinedGlyphs.push(arrItem);
              }
            }
            args[0] = combinedGlyphs;
            fn = OPS.showText;
            break;
          case OPS.nextLineShowText:
            if (!stateManager.state.font) {
              self.ensureStateFont(stateManager.state);
              continue;
            }
            operatorList.addOp(OPS.nextLine);
            args[0] = self.handleText(args[0], stateManager.state);
            fn = OPS.showText;
            break;
          case OPS.nextLineSetSpacingShowText:
            if (!stateManager.state.font) {
              self.ensureStateFont(stateManager.state);
              continue;
            }
            operatorList.addOp(OPS.nextLine);
            operatorList.addOp(OPS.setWordSpacing, [args.shift()]);
            operatorList.addOp(OPS.setCharSpacing, [args.shift()]);
            args[0] = self.handleText(args[0], stateManager.state);
            fn = OPS.showText;
            break;
          case OPS.setTextRenderingMode:
            stateManager.state.textRenderingMode = args[0];
            break;
          case OPS.setFillColorSpace:
            {
              const fillCS = self._getColorSpace(args[0], resources, localColorSpaceCache);
              if (fillCS instanceof ColorSpace) {
                stateManager.state.fillColorSpace = fillCS;
                continue;
              }
              next(self._handleColorSpace(fillCS).then(colorSpace => {
                stateManager.state.fillColorSpace = colorSpace || ColorSpaceUtils.gray;
              }));
              return;
            }
          case OPS.setStrokeColorSpace:
            {
              const strokeCS = self._getColorSpace(args[0], resources, localColorSpaceCache);
              if (strokeCS instanceof ColorSpace) {
                stateManager.state.strokeColorSpace = strokeCS;
                continue;
              }
              next(self._handleColorSpace(strokeCS).then(colorSpace => {
                stateManager.state.strokeColorSpace = colorSpace || ColorSpaceUtils.gray;
              }));
              return;
            }
          case OPS.setFillColor:
            if (!isNumberArray(args, null)) {
              continue;
            }
            cs = stateManager.state.fillColorSpace;
            args = [cs.getRgbHex(args, 0)];
            fn = OPS.setFillRGBColor;
            break;
          case OPS.setStrokeColor:
            if (!isNumberArray(args, null)) {
              continue;
            }
            cs = stateManager.state.strokeColorSpace;
            args = [cs.getRgbHex(args, 0)];
            fn = OPS.setStrokeRGBColor;
            break;
          case OPS.setFillGray:
            if (!isNumberArray(args, null)) {
              continue;
            }
            stateManager.state.fillColorSpace = ColorSpaceUtils.gray;
            args = [ColorSpaceUtils.gray.getRgbHex(args, 0)];
            fn = OPS.setFillRGBColor;
            break;
          case OPS.setStrokeGray:
            if (!isNumberArray(args, null)) {
              continue;
            }
            stateManager.state.strokeColorSpace = ColorSpaceUtils.gray;
            args = [ColorSpaceUtils.gray.getRgbHex(args, 0)];
            fn = OPS.setStrokeRGBColor;
            break;
          case OPS.setFillCMYKColor:
            if (!isNumberArray(args, null)) {
              continue;
            }
            stateManager.state.fillColorSpace = ColorSpaceUtils.cmyk;
            args = [ColorSpaceUtils.cmyk.getRgbHex(args, 0)];
            fn = OPS.setFillRGBColor;
            break;
          case OPS.setStrokeCMYKColor:
            if (!isNumberArray(args, null)) {
              continue;
            }
            stateManager.state.strokeColorSpace = ColorSpaceUtils.cmyk;
            args = [ColorSpaceUtils.cmyk.getRgbHex(args, 0)];
            fn = OPS.setStrokeRGBColor;
            break;
          case OPS.setFillRGBColor:
            if (!isNumberArray(args, null)) {
              continue;
            }
            stateManager.state.fillColorSpace = ColorSpaceUtils.rgb;
            args = [ColorSpaceUtils.rgb.getRgbHex(args, 0)];
            break;
          case OPS.setStrokeRGBColor:
            if (!isNumberArray(args, null)) {
              continue;
            }
            stateManager.state.strokeColorSpace = ColorSpaceUtils.rgb;
            args = [ColorSpaceUtils.rgb.getRgbHex(args, 0)];
            break;
          case OPS.setFillColorN:
            cs = stateManager.state.patternFillColorSpace;
            if (!cs) {
              if (isNumberArray(args, null)) {
                args = [ColorSpaceUtils.gray.getRgbHex(args, 0)];
                fn = OPS.setFillRGBColor;
                break;
              }
              args = [];
              fn = OPS.setFillTransparent;
              break;
            }
            if (cs.name === "Pattern") {
              if (!Array.isArray(args)) {
                continue;
              }
              next(self.handleColorN(operatorList, OPS.setFillColorN, args, cs, patterns, resources, task, localColorSpaceCache, localTilingPatternCache, localShadingPatternCache, seenRefs));
              return;
            }
            if (!isNumberArray(args, null)) {
              continue;
            }
            args = [cs.getRgbHex(args, 0)];
            fn = OPS.setFillRGBColor;
            break;
          case OPS.setStrokeColorN:
            cs = stateManager.state.patternStrokeColorSpace;
            if (!cs) {
              if (isNumberArray(args, null)) {
                args = [ColorSpaceUtils.gray.getRgbHex(args, 0)];
                fn = OPS.setStrokeRGBColor;
                break;
              }
              args = [];
              fn = OPS.setStrokeTransparent;
              break;
            }
            if (cs.name === "Pattern") {
              if (!Array.isArray(args)) {
                continue;
              }
              next(self.handleColorN(operatorList, OPS.setStrokeColorN, args, cs, patterns, resources, task, localColorSpaceCache, localTilingPatternCache, localShadingPatternCache, seenRefs));
              return;
            }
            if (!isNumberArray(args, null)) {
              continue;
            }
            args = [cs.getRgbHex(args, 0)];
            fn = OPS.setStrokeRGBColor;
            break;
          case OPS.shadingFill:
            let shading;
            try {
              const shadingRes = resources.get("Shading");
              if (!shadingRes) {
                throw new FormatError("No shading resource found");
              }
              shading = shadingRes.get(args[0].name);
              if (!shading) {
                throw new FormatError("No shading object found");
              }
            } catch (reason) {
              if (reason instanceof AbortException) {
                continue;
              }
              if (self.options.ignoreErrors) {
                warn(`getOperatorList - ignoring Shading: "${reason}".`);
                continue;
              }
              throw reason;
            }
            const patternId = self.parseShading({
              shading,
              resources,
              localColorSpaceCache,
              localShadingPatternCache
            });
            if (!patternId) {
              continue;
            }
            args = [patternId];
            fn = OPS.shadingFill;
            break;
          case OPS.setGState:
            isValidName = args[0] instanceof Name;
            name = args[0].name;
            if (isValidName) {
              const localGStateObj = localGStateCache.getByName(name);
              if (localGStateObj) {
                if (localGStateObj.length > 0) {
                  operatorList.addOp(OPS.setGState, [localGStateObj]);
                }
                args = null;
                continue;
              }
            }
            next(new Promise(function (resolveGState, rejectGState) {
              if (!isValidName) {
                throw new FormatError("GState must be referred to by name.");
              }
              const extGState = resources.get("ExtGState");
              if (!(extGState instanceof Dict)) {
                throw new FormatError("ExtGState should be a dictionary.");
              }
              const gState = extGState.get(name);
              if (!(gState instanceof Dict)) {
                throw new FormatError("GState should be a dictionary.");
              }
              self.setGState({
                resources,
                gState,
                operatorList,
                cacheKey: name,
                task,
                stateManager,
                localGStateCache,
                localColorSpaceCache,
                seenRefs
              }).then(resolveGState, rejectGState);
            }).catch(reason => {
              if (reason instanceof AbortException) {
                return;
              }
              if (self.options.ignoreErrors) {
                warn(`getOperatorList - ignoring ExtGState: "${reason}".`);
                return;
              }
              throw reason;
            }));
            return;
          case OPS.setLineWidth:
            {
              const [thickness] = args;
              if (typeof thickness !== "number") {
                warn(`Invalid setLineWidth: ${thickness}`);
                continue;
              }
              args[0] = Math.abs(thickness);
              break;
            }
          case OPS.setDash:
            {
              const dashPhase = args[1];
              if (typeof dashPhase !== "number") {
                warn(`Invalid setDash: ${dashPhase}`);
                continue;
              }
              const dashArray = args[0];
              if (!Array.isArray(dashArray)) {
                warn(`Invalid setDash: ${dashArray}`);
                continue;
              }
              if (dashArray.some(x => typeof x !== "number")) {
                args[0] = dashArray.filter(x => typeof x === "number");
              }
              break;
            }
          case OPS.moveTo:
          case OPS.lineTo:
          case OPS.curveTo:
          case OPS.curveTo2:
          case OPS.curveTo3:
          case OPS.closePath:
          case OPS.rectangle:
            self.buildPath(fn, args, stateManager.state);
            continue;
          case OPS.stroke:
          case OPS.closeStroke:
          case OPS.fill:
          case OPS.eoFill:
          case OPS.fillStroke:
          case OPS.eoFillStroke:
          case OPS.closeFillStroke:
          case OPS.closeEOFillStroke:
          case OPS.endPath:
            {
              const {
                state: {
                  pathBuffer,
                  pathMinMax
                }
              } = stateManager;
              if (fn === OPS.closeStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke) {
                pathBuffer.push(DrawOPS.closePath);
              }
              if (pathBuffer.length === 0) {
                operatorList.addOp(OPS.constructPath, [fn, [null], null]);
              } else {
                operatorList.addOp(OPS.constructPath, [fn, [new Float32Array(pathBuffer)], pathMinMax.slice()]);
                pathBuffer.length = 0;
                pathMinMax.set(BBOX_INIT, 0);
              }
              continue;
            }
          case OPS.setTextMatrix:
            operatorList.addOp(fn, [new Float32Array(args)]);
            continue;
          case OPS.markPoint:
          case OPS.markPointProps:
          case OPS.beginCompat:
          case OPS.endCompat:
            continue;
          case OPS.beginMarkedContentProps:
            markedContentLevel++;
            if (!(args[0] instanceof Name)) {
              warn(`Expected name for beginMarkedContentProps arg0=${args[0]}`);
              operatorList.addOp(OPS.beginMarkedContentProps, ["OC", null]);
              continue;
            }
            if (args[0].name === "OC") {
              next(self.parseMarkedContentProps(args[1], resources).then(data => {
                operatorList.addOp(OPS.beginMarkedContentProps, ["OC", data]);
              }).catch(reason => {
                if (reason instanceof AbortException) {
                  return;
                }
                if (self.options.ignoreErrors) {
                  warn(`getOperatorList - ignoring beginMarkedContentProps: "${reason}".`);
                  operatorList.addOp(OPS.beginMarkedContentProps, ["OC", null]);
                  return;
                }
                throw reason;
              }));
              return;
            }
            args = [args[0].name, args[1] instanceof Dict ? args[1].get("MCID") : null];
            break;
          case OPS.beginMarkedContent:
            if (args?.some(argIsDict)) {
              warn(`getOperatorList - ignoring operator: ${fn}`);
              continue;
            }
            markedContentLevel++;
            break;
          case OPS.endMarkedContent:
            if (args?.some(argIsDict)) {
              warn(`getOperatorList - ignoring operator: ${fn}`);
              continue;
            }
            if (markedContentLevel === 0) {
              continue;
            }
            markedContentLevel--;
            break;
          default:
            if (args?.some(argIsDict)) {
              warn(`getOperatorList - ignoring operator: ${fn}`);
              continue;
            }
        }
        operatorList.addOp(fn, args);
      }
      if (stop) {
        next(deferred);
        return;
      }
      closePendingMarkedContentOPS();
      closePendingRestoreOPS();
      resolve();
    }).catch(reason => {
      if (reason instanceof AbortException) {
        return;
      }
      if (this.options.ignoreErrors) {
        warn(`getOperatorList - ignoring errors during "${task.name}" ` + `task: "${reason}".`);
        closePendingMarkedContentOPS();
        closePendingRestoreOPS();
        return;
      }
      throw reason;
    });
  }
  async getTextContent({
    stream,
    task,
    resources,
    stateManager = null,
    includeMarkedContent = false,
    sink,
    seenStyles = new Set(),
    viewBox,
    lang = null,
    disableNormalization = false,
    keepWhiteSpace = false,
    prevRefs = null,
    intersector = null
  }) {
    if (stream.isAsync) {
      const bytes = await stream.asyncGetBytes();
      if (bytes) {
        stream = new Stream(bytes, 0, bytes.length, stream.dict);
      }
    }
    sink ??= textSinkWrapper(null);
    const objId = stream.dict?.objId;
    const seenRefs = new RefSet(prevRefs);
    if (objId) {
      if (prevRefs?.has(objId)) {
        throw new Error(`getTextContent - ignoring circular reference: ${objId}`);
      }
      seenRefs.put(objId);
    }
    resources ||= Dict.empty;
    stateManager ||= new StateManager(new TextState());
    let markedContentLevel = 0;
    let textMarkedContentLevel = null;
    const textContent = {
      items: [],
      styles: Object.create(null),
      lang
    };
    const textContentItem = {
      initialized: false,
      str: [],
      totalWidth: 0,
      totalHeight: 0,
      width: 0,
      height: 0,
      vertical: false,
      prevTransform: null,
      prevTextRise: 0,
      textAdvanceScale: 0,
      spaceInFlowMin: 0,
      spaceInFlowMax: 0,
      trackingSpaceMin: Infinity,
      negativeSpaceMax: -Infinity,
      notASpace: -Infinity,
      transform: null,
      fontName: null,
      hasEOL: false
    };
    const twoLastChars = [" ", " "];
    let twoLastCharsPos = 0;
    function saveLastChar(char) {
      const nextPos = (twoLastCharsPos + 1) % 2;
      const ret = twoLastChars[twoLastCharsPos] !== " " && twoLastChars[nextPos] === " ";
      twoLastChars[twoLastCharsPos] = char;
      twoLastCharsPos = nextPos;
      return !keepWhiteSpace && ret;
    }
    function shouldAddWhitepsace() {
      return !keepWhiteSpace && twoLastChars[twoLastCharsPos] !== " " && twoLastChars[(twoLastCharsPos + 1) % 2] === " ";
    }
    function resetLastChars() {
      twoLastChars[0] = twoLastChars[1] = " ";
      twoLastCharsPos = 0;
    }
    const TRACKING_SPACE_FACTOR = 0.102;
    const NOT_A_SPACE_FACTOR = 0.03;
    const NEGATIVE_SPACE_FACTOR = -0.2;
    const SPACE_IN_FLOW_MIN_FACTOR = 0.102;
    const SPACE_IN_FLOW_MAX_FACTOR = 0.6;
    const VERTICAL_SHIFT_RATIO = 0.25;
    const self = this;
    const xref = this.xref;
    const showSpacedTextBuffer = [];
    let xobjs = null;
    const emptyXObjectCache = new LocalImageCache();
    const emptyGStateCache = new LocalGStateCache();
    const preprocessor = new EvaluatorPreprocessor(stream, xref, stateManager);
    let textState, currentTextState;
    function pushWhitespace({
      width = 0,
      height = 0,
      transform = textContentItem.prevTransform,
      fontName = textContentItem.fontName
    }) {
      intersector?.addExtraChar(" ");
      textContent.items.push({
        str: " ",
        dir: "ltr",
        width,
        height,
        transform,
        fontName,
        hasEOL: false
      });
    }
    function getCurrentTextTransform() {
      const font = textState.font;
      const tsm = [textState.fontSize * textState.textHScale, 0, 0, textState.fontSize, 0, textState.textRise];
      if (font.isType3Font && (textState.fontSize <= 1 || font.isCharBBox) && !isArrayEqual(textState.fontMatrix, FONT_IDENTITY_MATRIX)) {
        const glyphHeight = font.bbox[3] - font.bbox[1];
        if (glyphHeight > 0) {
          tsm[3] *= glyphHeight * textState.fontMatrix[3];
        }
      }
      return Util.transform(textState.ctm, Util.transform(textState.textMatrix, tsm));
    }
    function ensureTextContentItem() {
      if (textContentItem.initialized) {
        return textContentItem;
      }
      const {
        font,
        loadedName
      } = textState;
      if (!seenStyles.has(loadedName)) {
        seenStyles.add(loadedName);
        textContent.styles[loadedName] = {
          fontFamily: font.fallbackName,
          ascent: font.ascent,
          descent: font.descent,
          vertical: font.vertical
        };
        if (self.options.fontExtraProperties && font.systemFontInfo) {
          const style = textContent.styles[loadedName];
          style.fontSubstitution = font.systemFontInfo.css;
          style.fontSubstitutionLoadedName = font.systemFontInfo.loadedName;
        }
      }
      textContentItem.fontName = loadedName;
      const trm = textContentItem.transform = getCurrentTextTransform();
      if (!font.vertical) {
        textContentItem.width = textContentItem.totalWidth = 0;
        textContentItem.height = textContentItem.totalHeight = Math.hypot(trm[2], trm[3]);
        textContentItem.vertical = false;
      } else {
        textContentItem.width = textContentItem.totalWidth = Math.hypot(trm[0], trm[1]);
        textContentItem.height = textContentItem.totalHeight = 0;
        textContentItem.vertical = true;
      }
      const scaleLineX = Math.hypot(textState.textLineMatrix[0], textState.textLineMatrix[1]);
      const scaleCtmX = Math.hypot(textState.ctm[0], textState.ctm[1]);
      textContentItem.textAdvanceScale = scaleCtmX * scaleLineX;
      const {
        fontSize
      } = textState;
      textContentItem.trackingSpaceMin = fontSize * TRACKING_SPACE_FACTOR;
      textContentItem.notASpace = fontSize * NOT_A_SPACE_FACTOR;
      textContentItem.negativeSpaceMax = fontSize * NEGATIVE_SPACE_FACTOR;
      textContentItem.spaceInFlowMin = fontSize * SPACE_IN_FLOW_MIN_FACTOR;
      textContentItem.spaceInFlowMax = fontSize * SPACE_IN_FLOW_MAX_FACTOR;
      textContentItem.hasEOL = false;
      textContentItem.initialized = true;
      return textContentItem;
    }
    function updateAdvanceScale() {
      if (!textContentItem.initialized) {
        return;
      }
      const scaleLineX = Math.hypot(textState.textLineMatrix[0], textState.textLineMatrix[1]);
      const scaleCtmX = Math.hypot(textState.ctm[0], textState.ctm[1]);
      const scaleFactor = scaleCtmX * scaleLineX;
      if (scaleFactor === textContentItem.textAdvanceScale) {
        return;
      }
      if (!textContentItem.vertical) {
        textContentItem.totalWidth += textContentItem.width * textContentItem.textAdvanceScale;
        textContentItem.width = 0;
      } else {
        textContentItem.totalHeight += textContentItem.height * textContentItem.textAdvanceScale;
        textContentItem.height = 0;
      }
      textContentItem.textAdvanceScale = scaleFactor;
    }
    function runBidiTransform(textChunk) {
      let text = textChunk.str.join("");
      if (!disableNormalization) {
        text = normalizeUnicode(text);
      }
      const bidiResult = bidi(text, -1, textChunk.vertical);
      return {
        str: bidiResult.str,
        dir: bidiResult.dir,
        width: Math.abs(textChunk.totalWidth),
        height: Math.abs(textChunk.totalHeight),
        transform: textChunk.transform,
        fontName: textChunk.fontName,
        hasEOL: textChunk.hasEOL
      };
    }
    async function handleSetFont(fontName, fontRef) {
      const translated = await self.loadFont(fontName, fontRef, resources, task, null, null, seenRefs);
      textState.loadedName = translated.loadedName;
      textState.font = translated.font;
      textState.fontMatrix = translated.font.fontMatrix || FONT_IDENTITY_MATRIX;
    }
    function applyInverseRotation(x, y, matrix) {
      const scale = Math.hypot(matrix[0], matrix[1]);
      return [(matrix[0] * x + matrix[1] * y) / scale, (matrix[2] * x + matrix[3] * y) / scale];
    }
    function compareWithLastPosition(glyphWidth) {
      const currentTransform = getCurrentTextTransform();
      let posX = currentTransform[4];
      let posY = currentTransform[5];
      if (textState.font?.vertical) {
        if (posX < viewBox[0] || posX > viewBox[2] || posY + glyphWidth < viewBox[1] || posY > viewBox[3]) {
          return false;
        }
      } else if (posX + glyphWidth < viewBox[0] || posX > viewBox[2] || posY < viewBox[1] || posY > viewBox[3]) {
        return false;
      }
      if (!textState.font || !textContentItem.prevTransform) {
        return true;
      }
      let lastPosX = textContentItem.prevTransform[4];
      let lastPosY = textContentItem.prevTransform[5];
      if (lastPosX === posX && lastPosY === posY) {
        return true;
      }
      let rotate = -1;
      if (currentTransform[0] && currentTransform[1] === 0 && currentTransform[2] === 0) {
        rotate = currentTransform[0] > 0 ? 0 : 180;
      } else if (currentTransform[1] && currentTransform[0] === 0 && currentTransform[3] === 0) {
        rotate = currentTransform[1] > 0 ? 90 : 270;
      }
      switch (rotate) {
        case 0:
          break;
        case 90:
          [posX, posY] = [posY, posX];
          [lastPosX, lastPosY] = [lastPosY, lastPosX];
          break;
        case 180:
          [posX, posY, lastPosX, lastPosY] = [-posX, -posY, -lastPosX, -lastPosY];
          break;
        case 270:
          [posX, posY] = [-posY, -posX];
          [lastPosX, lastPosY] = [-lastPosY, -lastPosX];
          break;
        default:
          [posX, posY] = applyInverseRotation(posX, posY, currentTransform);
          [lastPosX, lastPosY] = applyInverseRotation(lastPosX, lastPosY, textContentItem.prevTransform);
      }
      if (textState.font.vertical) {
        const advanceY = (lastPosY - posY) / textContentItem.textAdvanceScale;
        const advanceX = posX - lastPosX;
        const textOrientation = Math.sign(textContentItem.height || textContentItem.totalHeight);
        if (advanceY < textOrientation * textContentItem.negativeSpaceMax) {
          if (Math.abs(advanceX) > 0.5 * textContentItem.width) {
            appendEOL();
            return true;
          }
          resetLastChars();
          flushTextContentItem();
          return true;
        }
        if (Math.abs(advanceX) > textContentItem.width) {
          appendEOL();
          return true;
        }
        if (advanceY <= textOrientation * textContentItem.notASpace) {
          resetLastChars();
        }
        if (advanceY <= textOrientation * textContentItem.trackingSpaceMin) {
          if (shouldAddWhitepsace()) {
            resetLastChars();
            flushTextContentItem();
            pushWhitespace({
              height: Math.abs(advanceY)
            });
          } else {
            textContentItem.height += advanceY;
          }
        } else if (!addFakeSpaces(advanceY, textContentItem.prevTransform, textOrientation)) {
          if (textContentItem.str.length === 0) {
            resetLastChars();
            pushWhitespace({
              height: Math.abs(advanceY)
            });
          } else {
            textContentItem.height += advanceY;
          }
        }
        if (Math.abs(advanceX) > textContentItem.width * VERTICAL_SHIFT_RATIO) {
          flushTextContentItem();
        }
        return true;
      }
      const advanceX = (posX - lastPosX) / textContentItem.textAdvanceScale;
      const advanceY = posY - lastPosY;
      const textOrientation = Math.sign(textContentItem.width || textContentItem.totalWidth);
      if (advanceX < textOrientation * textContentItem.negativeSpaceMax) {
        if (Math.abs(advanceY) > 0.5 * textContentItem.height) {
          appendEOL();
          return true;
        }
        resetLastChars();
        flushTextContentItem();
        return true;
      }
      const textRiseDelta = textState.textRise - textContentItem.prevTextRise;
      const advanceYCorrected = textRiseDelta === 0 ? advanceY : advanceY - currentTransform[3] / textState.fontSize * textRiseDelta;
      if (Math.abs(advanceYCorrected) > textContentItem.height) {
        appendEOL();
        return true;
      }
      if (advanceX <= textOrientation * textContentItem.notASpace) {
        resetLastChars();
      }
      if (advanceX <= textOrientation * textContentItem.trackingSpaceMin) {
        if (shouldAddWhitepsace()) {
          resetLastChars();
          flushTextContentItem();
          pushWhitespace({
            width: Math.abs(advanceX)
          });
        } else {
          textContentItem.width += advanceX;
        }
      } else if (!addFakeSpaces(advanceX, textContentItem.prevTransform, textOrientation)) {
        if (textContentItem.str.length === 0) {
          resetLastChars();
          pushWhitespace({
            width: Math.abs(advanceX)
          });
        } else {
          textContentItem.width += advanceX;
        }
      }
      if (Math.abs(advanceY) > textContentItem.height * VERTICAL_SHIFT_RATIO) {
        flushTextContentItem();
      }
      return true;
    }
    function buildTextContentItem({
      chars,
      extraSpacing
    }) {
      if (currentTextState !== textState && (currentTextState.fontSize !== textState.fontSize || currentTextState.fontName !== textState.fontName && (currentTextState.font?.name !== textState.font.name || currentTextState.font.vertical !== textState.font.vertical))) {
        flushTextContentItem();
        currentTextState = textState.clone();
      }
      const font = textState.font;
      const baseCharSpacing = font.vertical ? -textState.charSpacing : textState.charSpacing;
      if (!chars) {
        const charSpacing = baseCharSpacing + extraSpacing;
        if (charSpacing) {
          if (!font.vertical) {
            textState.translateTextMatrix(charSpacing * textState.textHScale, 0);
          } else {
            textState.translateTextMatrix(0, -charSpacing);
          }
        }
        if (keepWhiteSpace) {
          compareWithLastPosition(0);
        }
        return;
      }
      const glyphs = font.charsToGlyphs(chars);
      const scale = textState.fontMatrix[0] * textState.fontSize;
      for (let i = 0, ii = glyphs.length; i < ii; i++) {
        const glyph = glyphs[i];
        const {
          category
        } = glyph;
        if (category.isInvisibleFormatMark) {
          continue;
        }
        let charSpacing = baseCharSpacing + (i + 1 === ii ? extraSpacing : 0);
        const glyphWidth = font.vertical ? glyph.vmetric[0] : glyph.width;
        let scaledDim = glyphWidth * scale;
        if (glyph.isSpace) {
          charSpacing += textState.wordSpacing;
        }
        if (!keepWhiteSpace && category.isWhitespace) {
          if (!font.vertical) {
            charSpacing += scaledDim;
            textState.translateTextMatrix(charSpacing * textState.textHScale, 0);
          } else {
            charSpacing += -scaledDim;
            textState.translateTextMatrix(0, -charSpacing);
          }
          saveLastChar(" ");
          continue;
        }
        if (!category.isZeroWidthDiacritic && !compareWithLastPosition(scaledDim)) {
          if (!font.vertical) {
            textState.translateTextMatrix(scaledDim * textState.textHScale, 0);
          } else {
            textState.translateTextMatrix(0, scaledDim);
          }
          continue;
        }
        const textChunk = ensureTextContentItem();
        if (category.isZeroWidthDiacritic) {
          scaledDim = 0;
        }
        if (!font.vertical) {
          scaledDim *= textState.textHScale;
          intersector?.addGlyph(getCurrentTextTransform(), scaledDim, 0, glyph.unicode);
          textState.translateTextMatrix(scaledDim, 0);
          textChunk.width += scaledDim;
        } else {
          intersector?.addGlyph(getCurrentTextTransform(), 0, scaledDim, glyph.unicode);
          textState.translateTextMatrix(0, scaledDim);
          scaledDim = Math.abs(scaledDim);
          textChunk.height += scaledDim;
        }
        if (scaledDim) {
          textChunk.prevTransform = getCurrentTextTransform();
          textChunk.prevTextRise = textState.textRise;
        }
        const glyphUnicode = glyph.unicode;
        if (saveLastChar(glyphUnicode)) {
          textChunk.str.push(" ");
          intersector?.addExtraChar(" ");
        }
        if (!intersector) {
          textChunk.str.push(glyphUnicode);
        }
        if (charSpacing) {
          if (!font.vertical) {
            textState.translateTextMatrix(charSpacing * textState.textHScale, 0);
          } else {
            textState.translateTextMatrix(0, -charSpacing);
          }
        }
      }
    }
    function appendEOL() {
      intersector?.addExtraChar("\n");
      resetLastChars();
      if (textContentItem.initialized) {
        textContentItem.hasEOL = true;
        flushTextContentItem();
      } else {
        textContent.items.push({
          str: "",
          dir: "ltr",
          width: 0,
          height: 0,
          transform: getCurrentTextTransform(),
          fontName: textState.loadedName,
          hasEOL: true
        });
      }
    }
    function addFakeSpaces(width, transf, textOrientation) {
      if (textOrientation * textContentItem.spaceInFlowMin <= width && width <= textOrientation * textContentItem.spaceInFlowMax) {
        if (textContentItem.initialized) {
          resetLastChars();
          textContentItem.str.push(" ");
          intersector?.addExtraChar(" ");
        }
        return false;
      }
      const fontName = textContentItem.fontName;
      let height = 0;
      if (textContentItem.vertical) {
        height = width;
        width = 0;
      }
      flushTextContentItem();
      resetLastChars();
      pushWhitespace({
        width: Math.abs(width),
        height: Math.abs(height),
        transform: transf || getCurrentTextTransform(),
        fontName
      });
      return true;
    }
    function flushTextContentItem() {
      if (!textContentItem.initialized || !textContentItem.str) {
        return;
      }
      if (!textContentItem.vertical) {
        textContentItem.totalWidth += textContentItem.width * textContentItem.textAdvanceScale;
      } else {
        textContentItem.totalHeight += textContentItem.height * textContentItem.textAdvanceScale;
      }
      textContent.items.push(runBidiTransform(textContentItem));
      textContentItem.initialized = false;
      textContentItem.str.length = 0;
    }
    function closePendingMarkedContentItems(level = 0) {
      if (!includeMarkedContent || markedContentLevel <= level) {
        return;
      }
      flushTextContentItem();
      for (; markedContentLevel > level; markedContentLevel--) {
        textContent.items.push({
          type: "endMarkedContent"
        });
      }
    }
    function enqueueChunk(batch = false) {
      const length = textContent.items.length;
      if (length === 0) {
        return;
      }
      if (batch && length < TEXT_CHUNK_BATCH_SIZE) {
        return;
      }
      sink.enqueue(textContent, length);
      textContent.items = [];
      textContent.styles = Object.create(null);
    }
    const timeSlotManager = new TimeSlotManager();
    return new Promise(function promiseBody(resolve, reject) {
      const next = function (promise) {
        enqueueChunk(true);
        Promise.all([promise, sink.ready]).then(function () {
          try {
            promiseBody(resolve, reject);
          } catch (ex) {
            reject(ex);
          }
        }, reject);
      };
      task.ensureNotTerminated();
      timeSlotManager.reset();
      const operation = {};
      let stop,
        name,
        isValidName,
        args = [];
      while (!(stop = timeSlotManager.check())) {
        args.length = 0;
        operation.args = args;
        if (!preprocessor.read(operation)) {
          break;
        }
        textState = stateManager.state;
        currentTextState ||= textState.clone();
        const fn = operation.fn;
        args = operation.args;
        switch (fn | 0) {
          case OPS.setFont:
            const fontNameArg = args[0].name,
              fontSizeArg = args[1];
            if (textState.font && fontNameArg === textState.fontName && fontSizeArg === textState.fontSize) {
              break;
            }
            textState.fontName = fontNameArg;
            textState.fontSize = fontSizeArg;
            next(handleSetFont(fontNameArg, null));
            return;
          case OPS.setTextRise:
            textState.textRise = args[0];
            break;
          case OPS.setHScale:
            textState.textHScale = args[0] / 100;
            break;
          case OPS.setLeading:
            textState.leading = args[0];
            break;
          case OPS.moveText:
            textState.translateTextLineMatrix(args[0], args[1]);
            textState.textMatrix = textState.textLineMatrix.slice();
            break;
          case OPS.setLeadingMoveText:
            textState.leading = -args[1];
            textState.translateTextLineMatrix(args[0], args[1]);
            textState.textMatrix = textState.textLineMatrix.slice();
            break;
          case OPS.nextLine:
            textState.carriageReturn();
            break;
          case OPS.setTextMatrix:
            textState.setTextMatrix(args[0], args[1], args[2], args[3], args[4], args[5]);
            textState.setTextLineMatrix(args[0], args[1], args[2], args[3], args[4], args[5]);
            updateAdvanceScale();
            break;
          case OPS.setCharSpacing:
            textState.charSpacing = args[0];
            break;
          case OPS.setWordSpacing:
            textState.wordSpacing = args[0];
            break;
          case OPS.beginText:
            textState.textMatrix = IDENTITY_MATRIX.slice();
            textState.textLineMatrix = IDENTITY_MATRIX.slice();
            textMarkedContentLevel = markedContentLevel;
            break;
          case OPS.endText:
            if (textMarkedContentLevel !== null) {
              closePendingMarkedContentItems(textMarkedContentLevel);
              textMarkedContentLevel = null;
            }
            break;
          case OPS.showSpacedText:
            if (!stateManager.state.font) {
              self.ensureStateFont(stateManager.state);
              continue;
            }
            const spaceFactor = (textState.font.vertical ? 1 : -1) * textState.fontSize / 1000;
            for (const item of args[0]) {
              if (typeof item === "string") {
                showSpacedTextBuffer.push(item);
              } else if (typeof item === "number" && item !== 0) {
                const str = showSpacedTextBuffer.join("");
                showSpacedTextBuffer.length = 0;
                buildTextContentItem({
                  chars: str,
                  extraSpacing: item * spaceFactor
                });
              }
            }
            if (showSpacedTextBuffer.length > 0) {
              const str = showSpacedTextBuffer.join("");
              showSpacedTextBuffer.length = 0;
              buildTextContentItem({
                chars: str,
                extraSpacing: 0
              });
            }
            break;
          case OPS.showText:
            if (!stateManager.state.font) {
              self.ensureStateFont(stateManager.state);
              continue;
            }
            buildTextContentItem({
              chars: args[0],
              extraSpacing: 0
            });
            break;
          case OPS.nextLineShowText:
            if (!stateManager.state.font) {
              self.ensureStateFont(stateManager.state);
              continue;
            }
            textState.carriageReturn();
            buildTextContentItem({
              chars: args[0],
              extraSpacing: 0
            });
            break;
          case OPS.nextLineSetSpacingShowText:
            if (!stateManager.state.font) {
              self.ensureStateFont(stateManager.state);
              continue;
            }
            textState.wordSpacing = args[0];
            textState.charSpacing = args[1];
            textState.carriageReturn();
            buildTextContentItem({
              chars: args[2],
              extraSpacing: 0
            });
            break;
          case OPS.paintXObject:
            flushTextContentItem();
            xobjs ??= resources.get("XObject") || Dict.empty;
            isValidName = args[0] instanceof Name;
            name = args[0].name;
            if (isValidName && emptyXObjectCache.getByName(name)) {
              break;
            }
            next(new Promise(function (resolveXObject, rejectXObject) {
              if (!isValidName) {
                throw new FormatError("XObject must be referred to by name.");
              }
              let xobj = xobjs.getRaw(name);
              if (xobj instanceof Ref) {
                if (emptyXObjectCache.getByRef(xobj)) {
                  resolveXObject();
                  return;
                }
                const globalImage = self.globalImageCache.getData(xobj, self.pageIndex);
                if (globalImage) {
                  resolveXObject();
                  return;
                }
                xobj = xref.fetch(xobj);
              }
              if (!(xobj instanceof BaseStream)) {
                throw new FormatError("XObject should be a stream");
              }
              const {
                dict
              } = xobj;
              const type = dict.get("Subtype");
              if (!(type instanceof Name)) {
                throw new FormatError("XObject should have a Name subtype");
              }
              if (type.name !== "Form") {
                emptyXObjectCache.set(name, dict.objId, true);
                resolveXObject();
                return;
              }
              const currentState = stateManager.state.clone();
              const xObjStateManager = new StateManager(currentState);
              const matrix = lookupMatrix(dict.getArray("Matrix"), null);
              if (matrix) {
                xObjStateManager.transform(matrix);
              }
              const localResources = dict.get("Resources");
              enqueueChunk();
              const sinkWrapper = textSinkWrapper(sink);
              self.getTextContent({
                stream: xobj,
                task,
                resources: localResources instanceof Dict ? localResources : resources,
                stateManager: xObjStateManager,
                includeMarkedContent,
                sink: sinkWrapper,
                seenStyles,
                viewBox,
                lang,
                disableNormalization,
                keepWhiteSpace,
                prevRefs: seenRefs
              }).then(function () {
                if (!sinkWrapper.enqueueInvoked) {
                  emptyXObjectCache.set(name, dict.objId, true);
                }
                resolveXObject();
              }, rejectXObject);
            }).catch(reason => {
              if (reason instanceof AbortException) {
                return;
              }
              if (self.options.ignoreErrors) {
                warn(`getTextContent - ignoring XObject: "${reason}".`);
                return;
              }
              throw reason;
            }));
            return;
          case OPS.setGState:
            isValidName = args[0] instanceof Name;
            name = args[0].name;
            if (isValidName && emptyGStateCache.getByName(name)) {
              break;
            }
            next(new Promise(function (resolveGState, rejectGState) {
              if (!isValidName) {
                throw new FormatError("GState must be referred to by name.");
              }
              const extGState = resources.get("ExtGState");
              if (!(extGState instanceof Dict)) {
                throw new FormatError("ExtGState should be a dictionary.");
              }
              const gState = extGState.get(name);
              if (!(gState instanceof Dict)) {
                throw new FormatError("GState should be a dictionary.");
              }
              const gStateFont = gState.get("Font");
              if (!gStateFont) {
                emptyGStateCache.set(name, gState.objId, true);
                resolveGState();
                return;
              }
              flushTextContentItem();
              textState.fontName = null;
              textState.fontSize = gStateFont[1];
              handleSetFont(null, gStateFont[0]).then(resolveGState, rejectGState);
            }).catch(reason => {
              if (reason instanceof AbortException) {
                return;
              }
              if (self.options.ignoreErrors) {
                warn(`getTextContent - ignoring ExtGState: "${reason}".`);
                return;
              }
              throw reason;
            }));
            return;
          case OPS.beginMarkedContent:
            flushTextContentItem();
            if (includeMarkedContent) {
              markedContentLevel++;
              textContent.items.push({
                type: "beginMarkedContent",
                tag: args[0] instanceof Name ? args[0].name : null
              });
            }
            break;
          case OPS.beginMarkedContentProps:
            flushTextContentItem();
            if (includeMarkedContent) {
              markedContentLevel++;
              const mcid = args[1] instanceof Dict ? args[1].get("MCID") : null;
              textContent.items.push({
                type: "beginMarkedContentProps",
                id: Number.isInteger(mcid) ? `${self.idFactory.getPageObjId()}_mc${mcid}` : null,
                tag: args[0] instanceof Name ? args[0].name : null
              });
            }
            break;
          case OPS.endMarkedContent:
            flushTextContentItem();
            if (includeMarkedContent) {
              if (markedContentLevel === 0) {
                break;
              }
              markedContentLevel--;
              textContent.items.push({
                type: "endMarkedContent"
              });
            }
            break;
        }
        if (textContent.items.length >= sink.desiredSize) {
          stop = true;
          break;
        }
      }
      if (stop) {
        next(deferred);
        return;
      }
      flushTextContentItem();
      closePendingMarkedContentItems();
      enqueueChunk();
      resolve();
    }).catch(reason => {
      if (reason instanceof AbortException) {
        return;
      }
      if (this.options.ignoreErrors) {
        warn(`getTextContent - ignoring errors during "${task.name}" ` + `task: "${reason}".`);
        flushTextContentItem();
        closePendingMarkedContentItems();
        enqueueChunk();
        return;
      }
      throw reason;
    });
  }
  async extractDataStructures(dict, properties) {
    const xref = this.xref;
    let cidToGidBytes;
    const toUnicodePromise = this.readToUnicode(properties.toUnicode);
    if (properties.composite) {
      const cidSystemInfo = dict.get("CIDSystemInfo");
      if (cidSystemInfo instanceof Dict && !properties.cidSystemInfo) {
        properties.cidSystemInfo = {
          registry: stringToPDFString(cidSystemInfo.get("Registry")),
          ordering: stringToPDFString(cidSystemInfo.get("Ordering")),
          supplement: cidSystemInfo.get("Supplement")
        };
      }
      try {
        const cidToGidMap = dict.get("CIDToGIDMap");
        if (cidToGidMap instanceof BaseStream) {
          cidToGidBytes = cidToGidMap.getBytes();
        }
      } catch (ex) {
        if (!this.options.ignoreErrors) {
          throw ex;
        }
        warn(`extractDataStructures - ignoring CIDToGIDMap data: "${ex}".`);
      }
    }
    const differences = new Map();
    let baseEncodingName = null;
    let encoding;
    if (dict.has("Encoding")) {
      encoding = dict.get("Encoding");
      if (encoding instanceof Dict) {
        baseEncodingName = encoding.get("BaseEncoding");
        baseEncodingName = baseEncodingName instanceof Name ? baseEncodingName.name : null;
        if (encoding.has("Differences")) {
          const diffEncoding = encoding.get("Differences");
          let index = 0;
          for (const entry of diffEncoding) {
            const data = xref.fetchIfRef(entry);
            if (typeof data === "number") {
              index = data;
            } else if (data instanceof Name) {
              differences.set(index++, data.name);
            } else {
              throw new FormatError(`Invalid entry in 'Differences' array: ${data}`);
            }
          }
        }
      } else if (encoding instanceof Name) {
        baseEncodingName = encoding.name;
      } else {
        const msg = "Encoding is not a Name nor a Dict";
        if (!this.options.ignoreErrors) {
          throw new FormatError(msg);
        }
        warn(msg);
      }
      if (baseEncodingName !== "MacRomanEncoding" && baseEncodingName !== "MacExpertEncoding" && baseEncodingName !== "WinAnsiEncoding") {
        baseEncodingName = null;
      }
    }
    const nonEmbeddedFont = !properties.file || properties.isInternalFont,
      isSymbolsFontName = getSymbolsFonts()[properties.name];
    if (baseEncodingName && nonEmbeddedFont && isSymbolsFontName) {
      baseEncodingName = null;
    }
    if (baseEncodingName === "WinAnsiEncoding" && nonEmbeddedFont && properties.name?.charCodeAt(0) >= 0xb7) {
      const fontName = properties.name;
      const chineseFontNames = ["\xCB\xCE\xCC\xE5", "\xBA\xDA\xCC\xE5", "\xBF\xAC\xCC\xE5", "\xB7\xC2\xCB\xCE", "\xBF\xAC\xCC\xE5_GB2312", "\xB7\xC2\xCB\xCE_GB2312", "\xC1\xA5\xCA\xE9", "\xD0\xC2\xCB\xCE", "\xB7\xC2\xCB\xCE\xCC\xE5", "\xD0\xA1\xB1\xEA\xCB\xCE"];
      if (chineseFontNames.includes(fontName)) {
        baseEncodingName = null;
        properties.defaultEncoding = "Adobe-GB1-UCS2";
        properties.composite = true;
        properties.cidEncoding = Name.get("GBK-EUC-H");
        const cMap = await CMapFactory.create({
          encoding: properties.cidEncoding,
          fetchBuiltInCMap: this._fetchBuiltInCMapBound,
          useCMap: null
        });
        properties.cMap = cMap;
        properties.vertical = properties.cMap.vertical;
        properties.cidSystemInfo = {
          registry: "Adobe",
          ordering: "GB1",
          supplement: 0
        };
      }
    }
    if (baseEncodingName) {
      properties.defaultEncoding = getEncoding(baseEncodingName);
    } else {
      let isSymbolicFont = !!(properties.flags & FontFlags.Symbolic);
      const isNonsymbolicFont = !!(properties.flags & FontFlags.Nonsymbolic);
      if (properties.type === "TrueType" && isSymbolicFont && isNonsymbolicFont && differences.size) {
        properties.flags &= ~FontFlags.Symbolic;
        isSymbolicFont = false;
      }
      encoding = StandardEncoding;
      if (properties.type === "TrueType" && !isNonsymbolicFont) {
        encoding = WinAnsiEncoding;
      }
      if (isSymbolicFont || isSymbolsFontName) {
        encoding = MacRomanEncoding;
        if (nonEmbeddedFont) {
          if (/Symbol/i.test(properties.name)) {
            encoding = SymbolSetEncoding;
          } else if (/Dingbats/i.test(properties.name)) {
            encoding = ZapfDingbatsEncoding;
          } else if (/Wingdings/i.test(properties.name)) {
            encoding = WinAnsiEncoding;
          }
        }
      }
      properties.defaultEncoding = encoding;
    }
    properties.differences = differences;
    properties.baseEncodingName = baseEncodingName;
    properties.hasEncoding = !!baseEncodingName || !!differences.size;
    properties.dict = dict;
    properties.toUnicode = await toUnicodePromise;
    const builtToUnicode = await this.buildToUnicode(properties);
    properties.toUnicode = builtToUnicode;
    if (cidToGidBytes) {
      properties.cidToGidMap = this.readCidToGidMap(cidToGidBytes, builtToUnicode);
    }
    return properties;
  }
  _simpleFontToUnicode(properties, forceGlyphs = false) {
    assert(!properties.composite, "Must be a simple font.");
    const toUnicode = new CharCodeMap();
    const encoding = properties.defaultEncoding.slice();
    const baseEncodingName = properties.baseEncodingName;
    for (const [charCode, glyphName] of properties.differences) {
      if (glyphName === ".notdef") {
        continue;
      }
      encoding[charCode] = glyphName;
    }
    const glyphsUnicodeMap = getGlyphsUnicode();
    for (const charcode in encoding) {
      let glyphName = encoding[charcode];
      if (glyphName === "") {
        continue;
      }
      let unicode = glyphsUnicodeMap[glyphName];
      if (unicode !== undefined) {
        toUnicode.set(+charcode, String.fromCharCode(unicode));
        continue;
      }
      let code = 0;
      switch (glyphName[0]) {
        case "G":
          if (glyphName.length === 3) {
            code = parseInt(glyphName.substring(1), 16);
          }
          break;
        case "g":
          if (glyphName.length === 5) {
            code = parseInt(glyphName.substring(1), 16);
          }
          break;
        case "C":
        case "c":
          if (glyphName.length >= 3 && glyphName.length <= 4) {
            const codeStr = glyphName.substring(1);
            if (forceGlyphs) {
              code = parseInt(codeStr, 16);
              break;
            }
            code = +codeStr;
            if (Number.isNaN(code) && Number.isInteger(parseInt(codeStr, 16))) {
              return this._simpleFontToUnicode(properties, true);
            }
          }
          break;
        case "u":
          unicode = getUnicodeForGlyph(glyphName, glyphsUnicodeMap);
          if (unicode !== -1) {
            code = unicode;
          }
          break;
        default:
          switch (glyphName) {
            case "f_h":
            case "f_t":
            case "T_h":
              toUnicode.set(+charcode, glyphName.replaceAll("_", ""));
              continue;
          }
          break;
      }
      if (code > 0 && code <= 0x10ffff && Number.isInteger(code)) {
        if (baseEncodingName && code === +charcode) {
          const baseEncoding = getEncoding(baseEncodingName);
          if (baseEncoding && (glyphName = baseEncoding[charcode])) {
            toUnicode.set(+charcode, String.fromCharCode(glyphsUnicodeMap[glyphName]));
            continue;
          }
        }
        toUnicode.set(+charcode, String.fromCodePoint(code));
      }
    }
    return toUnicode;
  }
  async buildToUnicode(properties) {
    properties.hasIncludedToUnicodeMap = !!properties.toUnicode?.size;
    if (properties.hasIncludedToUnicodeMap) {
      if (!properties.composite && properties.hasEncoding) {
        properties.fallbackToUnicode = this._simpleFontToUnicode(properties);
      }
      return properties.toUnicode;
    }
    if (!properties.composite) {
      return new ToUnicodeMap(this._simpleFontToUnicode(properties));
    }
    if (properties.cMap.builtInCMap && !(properties.cMap instanceof IdentityCMap) || properties.cidSystemInfo?.registry === "Adobe" && (properties.cidSystemInfo.ordering === "GB1" || properties.cidSystemInfo.ordering === "CNS1" || properties.cidSystemInfo.ordering === "Japan1" || properties.cidSystemInfo.ordering === "Korea1")) {
      const {
        registry,
        ordering
      } = properties.cidSystemInfo;
      const ucs2CMapName = Name.get(`${registry}-${ordering}-UCS2`);
      const ucs2CMap = await CMapFactory.create({
        encoding: ucs2CMapName,
        fetchBuiltInCMap: this._fetchBuiltInCMapBound,
        useCMap: null
      });
      const toUnicode = new CharCodeMap(),
        buf = [];
      properties.cMap.forEach((charcode, cid) => {
        if (cid > 0xffff) {
          throw new FormatError("Max size of CID is 65,535");
        }
        const ucs2 = ucs2CMap.lookup(cid);
        if (ucs2) {
          buf.length = 0;
          for (let i = 0, ii = ucs2.length; i < ii; i += 2) {
            buf.push((ucs2.charCodeAt(i) << 8) + ucs2.charCodeAt(i + 1));
          }
          toUnicode.set(charcode, String.fromCharCode(...buf));
        }
      });
      return new ToUnicodeMap(toUnicode);
    }
    return new IdentityToUnicodeMap(properties.firstChar, properties.lastChar);
  }
  async readToUnicode(cmapObj) {
    if (!cmapObj) {
      return null;
    }
    if (cmapObj instanceof Name) {
      const cmap = await CMapFactory.create({
        encoding: cmapObj,
        fetchBuiltInCMap: this._fetchBuiltInCMapBound,
        useCMap: null
      });
      return cmap instanceof IdentityCMap ? new IdentityToUnicodeMap(0, 0xffff) : new ToUnicodeMap(cmap.getMap());
    }
    if (cmapObj instanceof BaseStream) {
      try {
        const cmap = await CMapFactory.create({
          encoding: cmapObj,
          fetchBuiltInCMap: this._fetchBuiltInCMapBound,
          useCMap: null
        });
        if (cmap instanceof IdentityCMap) {
          return new IdentityToUnicodeMap(0, 0xffff);
        }
        const map = new CharCodeMap();
        cmap.forEach((charCode, token) => {
          if (typeof token === "number") {
            map.set(charCode, String.fromCodePoint(token));
            return;
          }
          if (token.length % 2 !== 0) {
            token = "\u0000" + token;
          }
          const str = [];
          for (let k = 0; k < token.length; k += 2) {
            const w1 = token.charCodeAt(k) << 8 | token.charCodeAt(k + 1);
            if ((w1 & 0xf800) !== 0xd800) {
              str.push(w1);
              continue;
            }
            k += 2;
            const w2 = token.charCodeAt(k) << 8 | token.charCodeAt(k + 1);
            str.push(((w1 & 0x3ff) << 10) + (w2 & 0x3ff) + 0x10000);
          }
          map.set(charCode, String.fromCodePoint(...str));
        });
        return new ToUnicodeMap(map);
      } catch (reason) {
        if (reason instanceof AbortException) {
          return null;
        }
        if (this.options.ignoreErrors) {
          warn(`readToUnicode - ignoring ToUnicode data: "${reason}".`);
          return null;
        }
        throw reason;
      }
    }
    return null;
  }
  readCidToGidMap(glyphsData, toUnicode) {
    const map = new CharCodeMap();
    for (let j = 0, jj = glyphsData.length; j < jj; j++) {
      const glyphID = glyphsData[j++] << 8 | glyphsData[j];
      const code = j >> 1;
      if (glyphID === 0 && !toUnicode.has(code)) {
        continue;
      }
      map.set(code, glyphID);
    }
    return map;
  }
  extractWidths(dict, descriptor, properties) {
    const xref = this.xref;
    let glyphsWidths = [];
    let defaultWidth = 0;
    const glyphsVMetrics = [];
    let defaultVMetrics;
    if (properties.composite) {
      const dw = dict.get("DW");
      defaultWidth = typeof dw === "number" ? Math.ceil(dw) : 1000;
      const widths = dict.get("W");
      if (Array.isArray(widths)) {
        for (let i = 0, ii = widths.length; i < ii; i++) {
          let start = xref.fetchIfRef(widths[i++]);
          if (!Number.isInteger(start)) {
            break;
          }
          const code = xref.fetchIfRef(widths[i]);
          if (Array.isArray(code)) {
            for (const c of code) {
              const width = xref.fetchIfRef(c);
              if (typeof width === "number") {
                glyphsWidths[start] = width;
              }
              start++;
            }
          } else if (Number.isInteger(code)) {
            const width = xref.fetchIfRef(widths[++i]);
            if (typeof width !== "number") {
              continue;
            }
            for (let j = start; j <= code; j++) {
              glyphsWidths[j] = width;
            }
          } else {
            break;
          }
        }
      }
      if (properties.vertical) {
        const dw2 = dict.getArray("DW2");
        let vmetrics = isNumberArray(dw2, 2) ? dw2 : [DEFAULT_VERTICAL_ORIGIN_Y, -DEFAULT_VERTICAL_ADVANCE];
        defaultVMetrics = [vmetrics[1], defaultWidth * 0.5, vmetrics[0]];
        vmetrics = dict.get("W2");
        if (Array.isArray(vmetrics)) {
          for (let i = 0, ii = vmetrics.length; i < ii; i++) {
            let start = xref.fetchIfRef(vmetrics[i++]);
            if (!Number.isInteger(start)) {
              break;
            }
            const code = xref.fetchIfRef(vmetrics[i]);
            if (Array.isArray(code)) {
              for (let j = 0, jj = code.length; j < jj; j++) {
                const vmetric = [xref.fetchIfRef(code[j++]), xref.fetchIfRef(code[j++]), xref.fetchIfRef(code[j])];
                if (isNumberArray(vmetric, null)) {
                  glyphsVMetrics[start] = vmetric;
                }
                start++;
              }
            } else if (Number.isInteger(code)) {
              const vmetric = [xref.fetchIfRef(vmetrics[++i]), xref.fetchIfRef(vmetrics[++i]), xref.fetchIfRef(vmetrics[++i])];
              if (!isNumberArray(vmetric, null)) {
                continue;
              }
              for (let j = start; j <= code; j++) {
                glyphsVMetrics[j] = vmetric;
              }
            } else {
              break;
            }
          }
        }
      }
    } else {
      const widths = dict.get("Widths");
      if (Array.isArray(widths)) {
        let j = properties.firstChar;
        for (const w of widths) {
          const width = xref.fetchIfRef(w);
          if (typeof width === "number") {
            glyphsWidths[j] = width;
          }
          j++;
        }
        const missingWidth = descriptor.get("MissingWidth");
        defaultWidth = typeof missingWidth === "number" ? missingWidth : 0;
      } else {
        const baseFontName = dict.get("BaseFont");
        if (baseFontName instanceof Name) {
          const metrics = this.getBaseFontMetrics(baseFontName.name);
          glyphsWidths = this.buildCharCodeToWidth(metrics.widths, properties);
          defaultWidth = metrics.defaultWidth;
        }
      }
    }
    let isMonospace = true;
    let firstWidth = defaultWidth;
    for (const glyph in glyphsWidths) {
      const glyphWidth = glyphsWidths[glyph];
      if (!glyphWidth) {
        continue;
      }
      if (!firstWidth) {
        firstWidth = glyphWidth;
        continue;
      }
      if (firstWidth !== glyphWidth) {
        isMonospace = false;
        break;
      }
    }
    if (isMonospace) {
      properties.flags |= FontFlags.FixedPitch;
    } else {
      properties.flags &= ~FontFlags.FixedPitch;
    }
    properties.defaultWidth = defaultWidth;
    properties.widths = glyphsWidths;
    properties.defaultVMetrics = defaultVMetrics;
    properties.vmetrics = glyphsVMetrics;
  }
  isSerifFont(baseFontName) {
    const fontNameWoStyle = baseFontName.split("-", 1)[0];
    return fontNameWoStyle in getSerifFonts() || /serif/i.test(fontNameWoStyle);
  }
  getBaseFontMetrics(name) {
    let defaultWidth = 0;
    let widths = Object.create(null);
    let monospace = false;
    let fontName = normalizeFontName(name);
    const stdFontMap = getStdFontMap();
    fontName = stdFontMap[fontName] || fontName;
    const Metrics = getMetrics();
    const glyphWidths = Metrics[fontName] ?? Metrics[this.isSerifFont(name) ? "Times-Roman" : "Helvetica"];
    if (typeof glyphWidths === "number") {
      defaultWidth = glyphWidths;
      monospace = true;
    } else {
      widths = glyphWidths();
    }
    return {
      defaultWidth,
      monospace,
      widths
    };
  }
  buildCharCodeToWidth(widthsByGlyphName, properties) {
    const widths = Object.create(null);
    const diffs = properties.differences,
      encoding = properties.defaultEncoding;
    for (let charCode = 0; charCode < 256; charCode++) {
      const width = diffs.has(charCode) && widthsByGlyphName[diffs.get(charCode)] || charCode in encoding && widthsByGlyphName[encoding[charCode]];
      if (width) {
        widths[charCode] = width;
      }
    }
    return widths;
  }
  preEvaluateFont(dict) {
    const baseDict = dict;
    let type = dict.get("Subtype");
    if (!(type instanceof Name)) {
      throw new FormatError("invalid font Subtype");
    }
    let composite = false;
    let hash;
    if (type.name === "Type0") {
      const df = dict.get("DescendantFonts");
      if (!df) {
        throw new FormatError("Descendant fonts are not specified");
      }
      dict = Array.isArray(df) ? this.xref.fetchIfRef(df[0]) : df;
      if (!(dict instanceof Dict)) {
        throw new FormatError("Descendant font is not a dictionary.");
      }
      type = dict.get("Subtype");
      if (!(type instanceof Name)) {
        throw new FormatError("invalid font Subtype");
      }
      composite = true;
    }
    let firstChar = dict.get("FirstChar");
    if (!Number.isInteger(firstChar)) {
      firstChar = 0;
    }
    let lastChar = dict.get("LastChar");
    if (!Number.isInteger(lastChar)) {
      lastChar = composite ? 0xffff : 0xff;
    }
    const descriptor = dict.get("FontDescriptor");
    const toUnicode = dict.get("ToUnicode") || baseDict.get("ToUnicode");
    if (descriptor) {
      hash = new MurmurHash3_64();
      const encoding = baseDict.getRaw("Encoding");
      if (encoding instanceof Name) {
        hash.update(encoding.name);
      } else if (encoding instanceof Ref) {
        hash.update(encoding.toString());
      } else if (encoding instanceof Dict) {
        for (const entry of encoding.getRawValues()) {
          if (entry instanceof Name) {
            hash.update(entry.name);
          } else if (entry instanceof Ref) {
            hash.update(entry.toString());
          } else if (Array.isArray(entry)) {
            const diffLength = entry.length,
              diffBuf = new Array(diffLength);
            for (let j = 0; j < diffLength; j++) {
              const diffEntry = entry[j];
              if (diffEntry instanceof Name) {
                diffBuf[j] = diffEntry.name;
              } else if (typeof diffEntry === "number" || diffEntry instanceof Ref) {
                diffBuf[j] = diffEntry.toString();
              }
            }
            hash.update(diffBuf.join());
          }
        }
      }
      hash.update(`${firstChar}-${lastChar}`);
      if (toUnicode instanceof BaseStream) {
        const stream = toUnicode.stream || toUnicode;
        const uint8array = stream.buffer ? new Uint8Array(stream.buffer.buffer, 0, stream.bufferLength) : new Uint8Array(stream.bytes.buffer, stream.start, stream.end - stream.start);
        hash.update(uint8array);
      } else if (toUnicode instanceof Name) {
        hash.update(toUnicode.name);
      }
      const widths = dict.get("Widths") || baseDict.get("Widths");
      if (Array.isArray(widths)) {
        const widthsBuf = [];
        for (const entry of widths) {
          if (typeof entry === "number" || entry instanceof Ref) {
            widthsBuf.push(entry.toString());
          }
        }
        hash.update(widthsBuf.join());
      }
      if (composite) {
        hash.update("compositeFont");
        const compositeWidths = dict.get("W") || baseDict.get("W");
        if (Array.isArray(compositeWidths)) {
          const widthsBuf = [];
          for (const entry of compositeWidths) {
            if (typeof entry === "number" || entry instanceof Ref) {
              widthsBuf.push(entry.toString());
            } else if (Array.isArray(entry)) {
              const subWidthsBuf = [];
              for (const element of entry) {
                if (typeof element === "number" || element instanceof Ref) {
                  subWidthsBuf.push(element.toString());
                }
              }
              widthsBuf.push(`[${subWidthsBuf.join()}]`);
            }
          }
          hash.update(widthsBuf.join());
        }
        const cidToGidMap = dict.getRaw("CIDToGIDMap") || baseDict.getRaw("CIDToGIDMap");
        if (cidToGidMap instanceof Name) {
          hash.update(cidToGidMap.name);
        } else if (cidToGidMap instanceof Ref) {
          hash.update(cidToGidMap.toString());
        } else if (cidToGidMap instanceof BaseStream) {
          hash.update(cidToGidMap.peekBytes());
        }
      }
      if (type.name === "Type3") {
        const charProcs = baseDict.get("CharProcs");
        if (charProcs instanceof Dict) {
          for (const [key, entry] of charProcs.getRawEntries()) {
            hash.update(entry instanceof Ref ? `${key}\0${entry}` : key);
          }
        }
      }
    }
    return {
      descriptor,
      dict,
      baseDict,
      composite,
      type: type.name,
      firstChar,
      lastChar,
      toUnicode,
      hash: hash ? hash.hexdigest() : ""
    };
  }
  async translateFont({
    descriptor,
    dict,
    baseDict,
    composite,
    type,
    firstChar,
    lastChar,
    toUnicode,
    cssFontInfo
  }) {
    const isType3Font = type === "Type3";
    if (!descriptor) {
      if (isType3Font) {
        descriptor = Dict.empty;
      } else if (composite) {
        descriptor = Dict.empty;
      } else {
        let baseFontName = dict.get("BaseFont");
        if (!(baseFontName instanceof Name)) {
          throw new FormatError("Base font is not specified");
        }
        baseFontName = normalizeFontName(baseFontName.name);
        const metrics = this.getBaseFontMetrics(baseFontName);
        const fontNameWoStyle = baseFontName.split("-", 1)[0];
        const flags = (this.isSerifFont(fontNameWoStyle) ? FontFlags.Serif : 0) | (metrics.monospace ? FontFlags.FixedPitch : 0) | (getSymbolsFonts()[fontNameWoStyle] ? FontFlags.Symbolic : FontFlags.Nonsymbolic);
        const properties = {
          type,
          name: baseFontName,
          loadedName: baseDict.loadedName,
          systemFontInfo: null,
          widths: metrics.widths,
          defaultWidth: metrics.defaultWidth,
          isSimulatedFlags: true,
          flags,
          firstChar,
          lastChar,
          toUnicode,
          xHeight: 0,
          capHeight: 0,
          italicAngle: 0,
          isType3Font
        };
        const widths = dict.get("Widths");
        const standardFontName = getStandardFontName(baseFontName);
        let file = null;
        if (standardFontName) {
          file = await this.fetchStandardFontData(standardFontName);
          properties.isInternalFont = !!file;
        }
        if (!properties.isInternalFont && this.options.useSystemFonts) {
          properties.systemFontInfo = getFontSubstitution(this.systemFontCache, this.idFactory, this.options.standardFontDataUrl, baseFontName, standardFontName, type);
        }
        const newProperties = await this.extractDataStructures(dict, properties);
        if (Array.isArray(widths)) {
          const glyphWidths = [];
          let j = firstChar;
          for (const w of widths) {
            const width = this.xref.fetchIfRef(w);
            if (typeof width === "number") {
              glyphWidths[j] = width;
            }
            j++;
          }
          newProperties.widths = glyphWidths;
        } else {
          newProperties.widths = this.buildCharCodeToWidth(metrics.widths, newProperties);
        }
        return new Font(baseFontName, file, newProperties, this.options);
      }
    }
    let fontName = descriptor.get("FontName");
    let baseFont = dict.get("BaseFont");
    if (typeof fontName === "string") {
      fontName = Name.get(fontName);
    }
    if (typeof baseFont === "string") {
      baseFont = Name.get(baseFont);
    }
    const fontNameStr = fontName?.name;
    const baseFontStr = baseFont?.name;
    if (isType3Font) {
      if (!fontNameStr) {
        fontName = Name.get(type);
      }
    } else if (fontNameStr !== baseFontStr) {
      info(`The FontDescriptor's FontName is "${fontNameStr}" but ` + `should be the same as the Font's BaseFont "${baseFontStr}".`);
      if (fontNameStr && baseFontStr && (baseFontStr.startsWith(fontNameStr) || !isKnownFontName(fontNameStr) && isKnownFontName(baseFontStr))) {
        fontName = null;
      }
      fontName ||= baseFont;
    }
    if (!(fontName instanceof Name)) {
      throw new FormatError("invalid font name");
    }
    let fontFile, fontFileN, subtype, length1, length2, length3;
    try {
      for (const n of ["FontFile", "FontFile2", "FontFile3"]) {
        fontFile = descriptor.get(n);
        if (fontFile) {
          fontFileN = n;
          break;
        }
      }
      if (fontFile) {
        if (!(fontFile instanceof BaseStream)) {
          throw new FormatError("FontFile should be a stream");
        } else {
          if (fontFile.isAsync) {
            const bytes = await fontFile.asyncGetBytes();
            if (bytes) {
              fontFile = new Stream(bytes, 0, bytes.length, fontFile.dict);
            }
          }
          if (fontFile.isEmpty) {
            throw new FormatError("FontFile is empty");
          }
        }
      }
    } catch (ex) {
      if (!this.options.ignoreErrors) {
        throw ex;
      }
      warn(`translateFont - fetching "${fontName.name}" font file: "${ex}".`);
      fontFile = null;
    }
    let isInternalFont = false;
    let glyphScaleFactors = null;
    let systemFontInfo = null;
    if (fontFile) {
      if (fontFile.dict) {
        const subtypeEntry = fontFile.dict.get("Subtype");
        if (subtypeEntry instanceof Name) {
          subtype = subtypeEntry.name;
        }
        length1 = fontFile.dict.get("Length1");
        length2 = fontFile.dict.get("Length2");
        length3 = fontFile.dict.get("Length3");
      }
    } else if (cssFontInfo) {
      const standardFontName = getXfaFontName(fontName.name);
      if (standardFontName) {
        cssFontInfo.fontFamily = `${cssFontInfo.fontFamily}-PdfJS-XFA`;
        cssFontInfo.metrics = standardFontName.metrics || null;
        glyphScaleFactors = standardFontName.factors || null;
        fontFile = await this.fetchStandardFontData(standardFontName.name);
        isInternalFont = !!fontFile;
        baseDict = dict = getXfaFontDict(fontName.name);
        composite = true;
      }
    } else if (!isType3Font) {
      const standardFontName = getStandardFontName(fontName.name);
      if (standardFontName) {
        fontFile = await this.fetchStandardFontData(standardFontName);
        isInternalFont = !!fontFile;
      }
      if (!isInternalFont && this.options.useSystemFonts) {
        systemFontInfo = getFontSubstitution(this.systemFontCache, this.idFactory, this.options.standardFontDataUrl, fontName.name, standardFontName, type);
      }
    }
    const fontMatrix = lookupMatrix(dict.getArray("FontMatrix"), FONT_IDENTITY_MATRIX);
    const bbox = lookupNormalRect(descriptor.getArray("FontBBox") || dict.getArray("FontBBox"), isType3Font ? [0, 0, 0, 0] : undefined);
    let ascent = descriptor.get("Ascent");
    if (typeof ascent !== "number") {
      ascent = undefined;
    }
    let descent = descriptor.get("Descent");
    if (typeof descent !== "number") {
      descent = undefined;
    }
    let xHeight = descriptor.get("XHeight");
    if (typeof xHeight !== "number") {
      xHeight = 0;
    }
    let capHeight = descriptor.get("CapHeight");
    if (typeof capHeight !== "number") {
      capHeight = 0;
    }
    let flags = descriptor.get("Flags");
    if (!Number.isInteger(flags)) {
      flags = 0;
    }
    let italicAngle = descriptor.get("ItalicAngle");
    if (typeof italicAngle !== "number") {
      italicAngle = 0;
    }
    const properties = {
      type,
      name: fontName.name,
      subtype,
      file: fontFile,
      fontFileN,
      length1,
      length2,
      length3,
      isInternalFont,
      loadedName: baseDict.loadedName,
      composite,
      fixedPitch: false,
      fontMatrix,
      firstChar,
      lastChar,
      toUnicode,
      bbox,
      ascent,
      descent,
      xHeight,
      capHeight,
      flags,
      italicAngle,
      isType3Font,
      cssFontInfo,
      scaleFactors: glyphScaleFactors,
      systemFontInfo
    };
    if (composite) {
      const cidEncoding = baseDict.get("Encoding");
      if (cidEncoding instanceof Name) {
        properties.cidEncoding = cidEncoding.name;
      }
      const cMap = await CMapFactory.create({
        encoding: cidEncoding,
        fetchBuiltInCMap: this._fetchBuiltInCMapBound,
        useCMap: null
      });
      properties.cMap = cMap;
      properties.vertical = properties.cMap.vertical;
    }
    const newProperties = await this.extractDataStructures(dict, properties);
    this.extractWidths(dict, descriptor, newProperties);
    const font = new Font(fontName.name, fontFile, newProperties, this.options);
    if (font.missingFile && !font.systemFontInfo && !isType3Font && this.options.useSystemFonts) {
      const standardFontName = getStandardFontName(fontName.name);
      const substitution = getFontSubstitution(this.systemFontCache, this.idFactory, this.options.standardFontDataUrl, fontName.name, standardFontName, type);
      if (substitution) {
        if (substitution.guessFallback) {
          substitution.guessFallback = false;
          substitution.css += `,${font.fallbackName}`;
        }
        font.systemFontInfo = substitution;
      }
    }
    return font;
  }
  static buildFontPaths(font, glyphs, handler, evaluatorOptions) {
    function buildPath(fontChar) {
      const glyphName = `${font.loadedName}_path_${fontChar}`;
      try {
        const buffer = font.renderer.getPath(fontChar);
        if (!buffer) {
          return;
        }
        handler.send("commonobj", [glyphName, "FontPath", buffer], [buffer]);
      } catch (reason) {
        if (evaluatorOptions.ignoreErrors) {
          warn(`buildFontPaths - ignoring ${glyphName} glyph: "${reason}".`);
          return;
        }
        throw reason;
      }
    }
    for (const glyph of glyphs) {
      buildPath(glyph.fontChar);
      const accent = glyph.accent;
      if (accent?.fontChar) {
        buildPath(accent.fontChar);
      }
    }
  }
  static get fallbackFontDict() {
    const dict = new Dict();
    dict.set("BaseFont", Name.get("Helvetica"));
    dict.set("Type", Name.get("FallbackType"));
    dict.set("Subtype", Name.get("FallbackType"));
    dict.set("Encoding", Name.get("WinAnsiEncoding"));
    return shadow(this, "fallbackFontDict", dict);
  }
}
class TranslatedFont {
  #sent = false;
  #type3Loaded = null;
  constructor({
    loadedName,
    font,
    dict
  }) {
    this.loadedName = loadedName;
    this.font = font;
    this.dict = dict;
    this.type3Dependencies = font.isType3Font ? new Set() : null;
  }
  send(handler) {
    if (this.#sent) {
      return;
    }
    this.#sent = true;
    const fontData = this.font.exportData(),
      transfers = fontData.buffer ? [fontData.buffer] : null;
    handler.send("commonobj", [this.loadedName, "Font", fontData], transfers);
  }
  fallback(handler, evaluatorOptions) {
    if (!this.font.data) {
      return;
    }
    this.font.disableFontFace = true;
    PartialEvaluator.buildFontPaths(this.font, this.font.glyphCacheValues, handler, evaluatorOptions);
  }
  async loadType3Data(evaluator, resources, task, seenRefs = null) {
    if (this.#type3Loaded) {
      return this.#type3Loaded;
    }
    const {
      dict,
      font,
      type3Dependencies
    } = this;
    assert(font.isType3Font, "Must be a Type3 font.");
    const {
      promise,
      resolve
    } = Promise.withResolvers();
    this.#type3Loaded = promise;
    const type3Evaluator = evaluator.clone({
      ignoreErrors: false
    });
    const type3FontRefs = new RefSet(evaluator.type3FontRefs);
    if (dict.objId) {
      type3FontRefs.put(dict.objId);
    }
    type3Evaluator.type3FontRefs = type3FontRefs;
    const charProcs = dict.get("CharProcs");
    const fontResources = dict.get("Resources") || resources;
    const charProcOperatorList = new Map();
    const [x0, y0, x1, y1] = font.bbox;
    const fontBBoxSize = Math.hypot(x1 - x0, y1 - y0);
    for (const key of charProcs.getKeys()) {
      try {
        const operatorList = new OperatorList();
        await type3Evaluator.getOperatorList({
          stream: charProcs.get(key),
          task,
          resources: fontResources,
          operatorList,
          prevRefs: seenRefs
        });
        switch (operatorList.fnArray[0]) {
          case OPS.setCharWidthAndBounds:
            this.#removeType3ColorOperators(operatorList, fontBBoxSize);
            break;
          case OPS.setCharWidth:
            if (!fontBBoxSize) {
              this.#guessType3FontBBox(operatorList);
            }
            operatorList.fnArray.splice(1, 0, OPS.setGState);
            operatorList.argsArray.splice(1, 0, [[["ca", 1], ["CA", 1]]]);
            break;
        }
        charProcOperatorList.set(key, operatorList.getIR());
        for (const dependency of operatorList.dependencies) {
          type3Dependencies.add(dependency);
        }
      } catch {
        warn(`Type3 font resource "${key}" is not available.`);
        charProcOperatorList.set(key, new OperatorList().getIR());
      }
    }
    font.charProcOperatorList = charProcOperatorList;
    if (this._bbox) {
      font.isCharBBox = true;
      font.bbox = this._bbox;
    }
    resolve();
    return this.#type3Loaded;
  }
  #removeType3ColorOperators(operatorList, fontBBoxSize = NaN) {
    const charBBox = Util.normalizeRect(operatorList.argsArray[0].slice(2)),
      width = charBBox[2] - charBBox[0],
      height = charBBox[3] - charBBox[1];
    const charBBoxSize = Math.hypot(width, height);
    if (width === 0 || height === 0) {
      operatorList.fnArray.splice(0, 1);
      operatorList.argsArray.splice(0, 1);
    } else if (fontBBoxSize === 0 || Math.round(charBBoxSize / fontBBoxSize) >= 10) {
      this._bbox ??= BBOX_INIT.slice();
      Util.rectBoundingBox(...charBBox, this._bbox);
    }
    let i = 0,
      ii = operatorList.length;
    while (i < ii) {
      switch (operatorList.fnArray[i]) {
        case OPS.setCharWidthAndBounds:
          break;
        case OPS.setStrokeColorSpace:
        case OPS.setFillColorSpace:
        case OPS.setStrokeColor:
        case OPS.setStrokeColorN:
        case OPS.setFillColor:
        case OPS.setFillColorN:
        case OPS.setStrokeGray:
        case OPS.setFillGray:
        case OPS.setStrokeRGBColor:
        case OPS.setFillRGBColor:
        case OPS.setStrokeCMYKColor:
        case OPS.setFillCMYKColor:
        case OPS.shadingFill:
        case OPS.setRenderingIntent:
          operatorList.fnArray.splice(i, 1);
          operatorList.argsArray.splice(i, 1);
          ii--;
          continue;
        case OPS.setGState:
          const [gStateObj] = operatorList.argsArray[i];
          let j = 0,
            jj = gStateObj.length;
          while (j < jj) {
            const [gStateKey] = gStateObj[j];
            switch (gStateKey) {
              case "TR":
              case "TR2":
              case "HT":
              case "BG":
              case "BG2":
              case "UCR":
              case "UCR2":
                gStateObj.splice(j, 1);
                jj--;
                continue;
            }
            j++;
          }
          break;
      }
      i++;
    }
  }
  #guessType3FontBBox(operatorList) {
    let i = 1;
    const ii = operatorList.length;
    while (i < ii) {
      switch (operatorList.fnArray[i]) {
        case OPS.constructPath:
          const minMax = operatorList.argsArray[i][2];
          this._bbox ??= BBOX_INIT.slice();
          Util.rectBoundingBox(...minMax, this._bbox);
          break;
      }
      i++;
    }
  }
}
class StateManager {
  constructor(initialState = new EvalState()) {
    this.state = initialState;
    this.stateStack = [];
  }
  save() {
    const old = this.state;
    this.stateStack.push(this.state);
    this.state = old.clone();
  }
  restore() {
    const prev = this.stateStack.pop();
    if (prev) {
      this.state = prev;
    }
  }
  transform(args) {
    this.state.ctm = Util.transform(this.state.ctm, args);
  }
}
class TextState {
  ctm = new Float32Array(IDENTITY_MATRIX);
  fontName = null;
  fontSize = 0;
  loadedName = null;
  font = null;
  fontMatrix = FONT_IDENTITY_MATRIX;
  textMatrix = IDENTITY_MATRIX.slice();
  textLineMatrix = IDENTITY_MATRIX.slice();
  charSpacing = 0;
  wordSpacing = 0;
  leading = 0;
  textHScale = 1;
  textRise = 0;
  setTextMatrix(a, b, c, d, e, f) {
    const m = this.textMatrix;
    m[0] = a;
    m[1] = b;
    m[2] = c;
    m[3] = d;
    m[4] = e;
    m[5] = f;
  }
  setTextLineMatrix(a, b, c, d, e, f) {
    const m = this.textLineMatrix;
    m[0] = a;
    m[1] = b;
    m[2] = c;
    m[3] = d;
    m[4] = e;
    m[5] = f;
  }
  translateTextMatrix(x, y) {
    const m = this.textMatrix;
    m[4] = m[0] * x + m[2] * y + m[4];
    m[5] = m[1] * x + m[3] * y + m[5];
  }
  translateTextLineMatrix(x, y) {
    const m = this.textLineMatrix;
    m[4] = m[0] * x + m[2] * y + m[4];
    m[5] = m[1] * x + m[3] * y + m[5];
  }
  carriageReturn() {
    this.translateTextLineMatrix(0, -this.leading);
    this.textMatrix = this.textLineMatrix.slice();
  }
  clone() {
    const clone = Object.assign(Object.create(this), this);
    clone.textMatrix = this.textMatrix.slice();
    clone.textLineMatrix = this.textLineMatrix.slice();
    clone.fontMatrix = this.fontMatrix.slice();
    return clone;
  }
}
class EvalState {
  ctm = new Float32Array(IDENTITY_MATRIX);
  font = null;
  textRenderingMode = TextRenderingMode.FILL;
  _fillColorSpace = ColorSpaceUtils.gray;
  _strokeColorSpace = ColorSpaceUtils.gray;
  patternFillColorSpace = null;
  patternStrokeColorSpace = null;
  currentPointX = 0;
  currentPointY = 0;
  pathMinMax = F32_BBOX_INIT.slice();
  pathBuffer = [];
  get fillColorSpace() {
    return this._fillColorSpace;
  }
  set fillColorSpace(colorSpace) {
    this._fillColorSpace = this.patternFillColorSpace = colorSpace;
  }
  get strokeColorSpace() {
    return this._strokeColorSpace;
  }
  set strokeColorSpace(colorSpace) {
    this._strokeColorSpace = this.patternStrokeColorSpace = colorSpace;
  }
  clone({
    newPath = false
  } = {}) {
    const clone = Object.create(this);
    if (newPath) {
      clone.pathBuffer = [];
      clone.pathMinMax = F32_BBOX_INIT.slice();
    }
    return clone;
  }
}
class EvaluatorPreprocessor {
  static get opMap() {
    return shadow(this, "opMap", Object.assign(Object.create(null), {
      w: {
        id: OPS.setLineWidth,
        numArgs: 1,
        variableArgs: false
      },
      J: {
        id: OPS.setLineCap,
        numArgs: 1,
        variableArgs: false
      },
      j: {
        id: OPS.setLineJoin,
        numArgs: 1,
        variableArgs: false
      },
      M: {
        id: OPS.setMiterLimit,
        numArgs: 1,
        variableArgs: false
      },
      d: {
        id: OPS.setDash,
        numArgs: 2,
        variableArgs: false
      },
      ri: {
        id: OPS.setRenderingIntent,
        numArgs: 1,
        variableArgs: false
      },
      i: {
        id: OPS.setFlatness,
        numArgs: 1,
        variableArgs: false
      },
      gs: {
        id: OPS.setGState,
        numArgs: 1,
        variableArgs: false
      },
      q: {
        id: OPS.save,
        numArgs: 0,
        variableArgs: false
      },
      Q: {
        id: OPS.restore,
        numArgs: 0,
        variableArgs: false
      },
      cm: {
        id: OPS.transform,
        numArgs: 6,
        variableArgs: false
      },
      m: {
        id: OPS.moveTo,
        numArgs: 2,
        variableArgs: false
      },
      l: {
        id: OPS.lineTo,
        numArgs: 2,
        variableArgs: false
      },
      c: {
        id: OPS.curveTo,
        numArgs: 6,
        variableArgs: false
      },
      v: {
        id: OPS.curveTo2,
        numArgs: 4,
        variableArgs: false
      },
      y: {
        id: OPS.curveTo3,
        numArgs: 4,
        variableArgs: false
      },
      h: {
        id: OPS.closePath,
        numArgs: 0,
        variableArgs: false
      },
      re: {
        id: OPS.rectangle,
        numArgs: 4,
        variableArgs: false
      },
      S: {
        id: OPS.stroke,
        numArgs: 0,
        variableArgs: false
      },
      s: {
        id: OPS.closeStroke,
        numArgs: 0,
        variableArgs: false
      },
      f: {
        id: OPS.fill,
        numArgs: 0,
        variableArgs: false
      },
      F: {
        id: OPS.fill,
        numArgs: 0,
        variableArgs: false
      },
      "f*": {
        id: OPS.eoFill,
        numArgs: 0,
        variableArgs: false
      },
      B: {
        id: OPS.fillStroke,
        numArgs: 0,
        variableArgs: false
      },
      "B*": {
        id: OPS.eoFillStroke,
        numArgs: 0,
        variableArgs: false
      },
      b: {
        id: OPS.closeFillStroke,
        numArgs: 0,
        variableArgs: false
      },
      "b*": {
        id: OPS.closeEOFillStroke,
        numArgs: 0,
        variableArgs: false
      },
      n: {
        id: OPS.endPath,
        numArgs: 0,
        variableArgs: false
      },
      W: {
        id: OPS.clip,
        numArgs: 0,
        variableArgs: false
      },
      "W*": {
        id: OPS.eoClip,
        numArgs: 0,
        variableArgs: false
      },
      BT: {
        id: OPS.beginText,
        numArgs: 0,
        variableArgs: false
      },
      ET: {
        id: OPS.endText,
        numArgs: 0,
        variableArgs: false
      },
      Tc: {
        id: OPS.setCharSpacing,
        numArgs: 1,
        variableArgs: false
      },
      Tw: {
        id: OPS.setWordSpacing,
        numArgs: 1,
        variableArgs: false
      },
      Tz: {
        id: OPS.setHScale,
        numArgs: 1,
        variableArgs: false
      },
      TL: {
        id: OPS.setLeading,
        numArgs: 1,
        variableArgs: false
      },
      Tf: {
        id: OPS.setFont,
        numArgs: 2,
        variableArgs: false
      },
      Tr: {
        id: OPS.setTextRenderingMode,
        numArgs: 1,
        variableArgs: false
      },
      Ts: {
        id: OPS.setTextRise,
        numArgs: 1,
        variableArgs: false
      },
      Td: {
        id: OPS.moveText,
        numArgs: 2,
        variableArgs: false
      },
      TD: {
        id: OPS.setLeadingMoveText,
        numArgs: 2,
        variableArgs: false
      },
      Tm: {
        id: OPS.setTextMatrix,
        numArgs: 6,
        variableArgs: false
      },
      "T*": {
        id: OPS.nextLine,
        numArgs: 0,
        variableArgs: false
      },
      Tj: {
        id: OPS.showText,
        numArgs: 1,
        variableArgs: false
      },
      TJ: {
        id: OPS.showSpacedText,
        numArgs: 1,
        variableArgs: false
      },
      "'": {
        id: OPS.nextLineShowText,
        numArgs: 1,
        variableArgs: false
      },
      '"': {
        id: OPS.nextLineSetSpacingShowText,
        numArgs: 3,
        variableArgs: false
      },
      d0: {
        id: OPS.setCharWidth,
        numArgs: 2,
        variableArgs: false
      },
      d1: {
        id: OPS.setCharWidthAndBounds,
        numArgs: 6,
        variableArgs: false
      },
      CS: {
        id: OPS.setStrokeColorSpace,
        numArgs: 1,
        variableArgs: false
      },
      cs: {
        id: OPS.setFillColorSpace,
        numArgs: 1,
        variableArgs: false
      },
      SC: {
        id: OPS.setStrokeColor,
        numArgs: 4,
        variableArgs: true
      },
      SCN: {
        id: OPS.setStrokeColorN,
        numArgs: 33,
        variableArgs: true
      },
      sc: {
        id: OPS.setFillColor,
        numArgs: 4,
        variableArgs: true
      },
      scn: {
        id: OPS.setFillColorN,
        numArgs: 33,
        variableArgs: true
      },
      G: {
        id: OPS.setStrokeGray,
        numArgs: 1,
        variableArgs: false
      },
      g: {
        id: OPS.setFillGray,
        numArgs: 1,
        variableArgs: false
      },
      RG: {
        id: OPS.setStrokeRGBColor,
        numArgs: 3,
        variableArgs: false
      },
      rg: {
        id: OPS.setFillRGBColor,
        numArgs: 3,
        variableArgs: false
      },
      K: {
        id: OPS.setStrokeCMYKColor,
        numArgs: 4,
        variableArgs: false
      },
      k: {
        id: OPS.setFillCMYKColor,
        numArgs: 4,
        variableArgs: false
      },
      sh: {
        id: OPS.shadingFill,
        numArgs: 1,
        variableArgs: false
      },
      BI: {
        id: OPS.beginInlineImage,
        numArgs: 0,
        variableArgs: false
      },
      ID: {
        id: OPS.beginImageData,
        numArgs: 0,
        variableArgs: false
      },
      EI: {
        id: OPS.endInlineImage,
        numArgs: 1,
        variableArgs: false
      },
      Do: {
        id: OPS.paintXObject,
        numArgs: 1,
        variableArgs: false
      },
      MP: {
        id: OPS.markPoint,
        numArgs: 1,
        variableArgs: false
      },
      DP: {
        id: OPS.markPointProps,
        numArgs: 2,
        variableArgs: false
      },
      BMC: {
        id: OPS.beginMarkedContent,
        numArgs: 1,
        variableArgs: false
      },
      BDC: {
        id: OPS.beginMarkedContentProps,
        numArgs: 2,
        variableArgs: false
      },
      EMC: {
        id: OPS.endMarkedContent,
        numArgs: 0,
        variableArgs: false
      },
      BX: {
        id: OPS.beginCompat,
        numArgs: 0,
        variableArgs: false
      },
      EX: {
        id: OPS.endCompat,
        numArgs: 0,
        variableArgs: false
      },
      BM: null,
      BD: null,
      true: null,
      fa: null,
      fal: null,
      fals: null,
      false: null,
      nu: null,
      nul: null,
      null: null
    }));
  }
  static MAX_INVALID_PATH_OPS = 10;
  constructor(stream, xref, stateManager = new StateManager()) {
    this.parser = new Parser({
      lexer: new Lexer(stream, EvaluatorPreprocessor.opMap),
      xref
    });
    this.stateManager = stateManager;
    this.nonProcessedArgs = [];
    this._isPathOp = false;
    this._numInvalidPathOPS = 0;
  }
  get savedStatesDepth() {
    return this.stateManager.stateStack.length;
  }
  read(operation) {
    let args = operation.args;
    while (true) {
      const obj = this.parser.getObj();
      if (obj instanceof Cmd) {
        const cmd = obj.cmd;
        const opSpec = EvaluatorPreprocessor.opMap[cmd];
        if (!opSpec) {
          warn(`Unknown command "${cmd}".`);
          continue;
        }
        const fn = opSpec.id;
        const numArgs = opSpec.numArgs;
        let argsLength = args !== null ? args.length : 0;
        if (!this._isPathOp) {
          this._numInvalidPathOPS = 0;
        }
        this._isPathOp = fn >= OPS.moveTo && fn <= OPS.endPath;
        if (!opSpec.variableArgs) {
          if (argsLength !== numArgs) {
            const nonProcessedArgs = this.nonProcessedArgs;
            while (argsLength > numArgs) {
              nonProcessedArgs.push(args.shift());
              argsLength--;
            }
            while (argsLength < numArgs && nonProcessedArgs.length !== 0) {
              if (args === null) {
                args = [];
              }
              args.unshift(nonProcessedArgs.pop());
              argsLength++;
            }
          }
          if (argsLength < numArgs) {
            const partialMsg = `command ${cmd}: expected ${numArgs} args, ` + `but received ${argsLength} args.`;
            if (this._isPathOp && ++this._numInvalidPathOPS > EvaluatorPreprocessor.MAX_INVALID_PATH_OPS) {
              throw new FormatError(`Invalid ${partialMsg}`);
            }
            warn(`Skipping ${partialMsg}`);
            if (args !== null) {
              args.length = 0;
            }
            continue;
          }
        } else if (argsLength > numArgs) {
          info(`Command ${cmd}: expected [0, ${numArgs}] args, ` + `but received ${argsLength} args.`);
        }
        this.preprocessCommand(fn, args);
        operation.fn = fn;
        operation.args = args;
        return true;
      }
      if (obj === EOF) {
        return false;
      }
      if (obj !== null) {
        if (args === null) {
          args = [];
        }
        args.push(obj);
        if (args.length > 33) {
          throw new FormatError("Too many arguments");
        }
      }
    }
  }
  preprocessCommand(fn, args) {
    switch (fn | 0) {
      case OPS.save:
        this.stateManager.save();
        break;
      case OPS.restore:
        this.stateManager.restore();
        break;
      case OPS.transform:
        this.stateManager.transform(args);
        break;
    }
  }
}
export { EvaluatorPreprocessor, PartialEvaluator };