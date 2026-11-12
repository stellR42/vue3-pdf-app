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
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import "core-js/modules/es.weak-map.get-or-insert.js";
import "core-js/modules/es.weak-map.get-or-insert-computed.js";
import { AbortException, FeatureTest, shadow, Util, warn } from "../shared/util.js";
import { OutputScale } from "./display_utils.js";
import { setLayerDimensions } from "./dom_utils.js";
const MAX_TEXT_DIVS_TO_RENDER = 100000;
const DEFAULT_FONT_SIZE = 30;
class TextLayer {
  #capability = Promise.withResolvers();
  #container = null;
  #disableProcessItems = false;
  #fontInspectorEnabled = !!globalThis.FontInspector?.enabled;
  #imagesHandler = null;
  #lang = null;
  #layoutTextParams = null;
  #pageHeight = 0;
  #pageWidth = 0;
  #pixelRatio = OutputScale.pixelRatio;
  #reader = null;
  #rootContainer = null;
  #rotation = 0;
  #scale = 0;
  #styleCache = Object.create(null);
  #textContentItemsStr = [];
  #textContentSource = null;
  #textDivs = [];
  #transform = null;
  static #ascentCache = new Map();
  static #canvasContexts = new Map();
  static #canvasCtxFonts = new WeakMap();
  static #minFontSize = null;
  static #pendingTextLayers = new Set();
  constructor({
    textContentSource,
    images,
    container,
    viewport
  }) {
    if (textContentSource instanceof ReadableStream) {
      this.#textContentSource = textContentSource;
    } else if (typeof textContentSource === "object") {
      this.#textContentSource = new ReadableStream({
        start(controller) {
          controller.enqueue(textContentSource);
          controller.close();
        }
      });
    } else {
      throw new Error('No "textContentSource" parameter specified.');
    }
    this.#container = this.#rootContainer = container;
    this.#imagesHandler = images;
    this.#scale = viewport.scale * this.#pixelRatio;
    this.#rotation = viewport.rotation;
    this.#layoutTextParams = {
      div: null,
      properties: null,
      ctx: null
    };
    const {
      pageWidth,
      pageHeight,
      pageX,
      pageY
    } = viewport.rawDims;
    this.#transform = [1, 0, 0, -1, -pageX, pageY + pageHeight];
    this.#pageWidth = pageWidth;
    this.#pageHeight = pageHeight;
    TextLayer.#ensureMinFontSizeComputed();
    container.style.setProperty("--min-font-size", TextLayer.#minFontSize);
    setLayerDimensions(container, viewport);
    this.#capability.promise.finally(() => {
      TextLayer.#pendingTextLayers.delete(this);
      this.#layoutTextParams = null;
      this.#styleCache = null;
    }).catch(() => {});
  }
  static get fontFamilyMap() {
    const {
      isWindows,
      isFirefox
    } = FeatureTest.platform;
    return shadow(this, "fontFamilyMap", new Map([["sans-serif", `${isWindows && isFirefox ? "Calibri, " : ""}sans-serif`], ["monospace", `${isWindows && isFirefox ? "Lucida Console, " : ""}monospace`]]));
  }
  render() {
    if (this.#imagesHandler) {
      this.#container.append(this.#imagesHandler.render());
    }
    const pump = () => {
      this.#reader.read().then(({
        value,
        done
      }) => {
        if (done) {
          this.#capability.resolve();
          return;
        }
        this.#lang ??= value.lang;
        Object.assign(this.#styleCache, value.styles);
        this.#processItems(value.items);
        pump();
      }, this.#capability.reject);
    };
    this.#reader = this.#textContentSource.getReader();
    TextLayer.#pendingTextLayers.add(this);
    pump();
    return this.#capability.promise;
  }
  update({
    viewport
  }) {
    const scale = viewport.scale * OutputScale.pixelRatio;
    const rotation = viewport.rotation;
    if (rotation !== this.#rotation) {
      this.#rotation = rotation;
      setLayerDimensions(this.#rootContainer, {
        rotation
      });
    }
    if (scale !== this.#scale) {
      this.#scale = scale;
      this.#pixelRatio = OutputScale.pixelRatio;
    }
  }
  cancel() {
    const abortEx = new AbortException("TextLayer task cancelled.");
    this.#reader?.cancel(abortEx).catch(() => {});
    this.#reader = null;
    this.#capability.reject(abortEx);
  }
  get textDivs() {
    return this.#textDivs;
  }
  get textContentItemsStr() {
    return this.#textContentItemsStr;
  }
  #processItems(items) {
    if (this.#disableProcessItems) {
      return;
    }
    this.#layoutTextParams.ctx ??= TextLayer.#getCtx(this.#lang);
    const textDivs = this.#textDivs,
      textContentItemsStr = this.#textContentItemsStr;
    for (const item of items) {
      if (textDivs.length > MAX_TEXT_DIVS_TO_RENDER) {
        warn("Ignoring additional textDivs for performance reasons.");
        this.#disableProcessItems = true;
        return;
      }
      if (item.str === undefined) {
        if (item.type === "beginMarkedContentProps" || item.type === "beginMarkedContent") {
          const parent = this.#container;
          this.#container = document.createElement("span");
          this.#container.classList.add("markedContent");
          if (item.id) {
            this.#container.setAttribute("id", item.id);
          }
          if (item.tag === "Artifact") {
            this.#container.ariaHidden = true;
          }
          parent.append(this.#container);
        } else if (item.type === "endMarkedContent") {
          this.#container = this.#container.parentNode;
        }
        continue;
      }
      textContentItemsStr.push(item.str);
      this.#appendText(item);
    }
  }
  #appendText(geom) {
    const textDiv = document.createElement("span");
    const textDivProperties = {
      angle: 0,
      canvasWidth: 0,
      hasText: geom.str !== "",
      hasEOL: geom.hasEOL,
      fontSize: 0
    };
    this.#textDivs.push(textDiv);
    const tx = Util.transform(this.#transform, geom.transform);
    let angle = Math.atan2(tx[1], tx[0]);
    const style = this.#styleCache[geom.fontName];
    if (style.vertical) {
      angle += Math.PI / 2;
    }
    let fontFamily = this.#fontInspectorEnabled && style.fontSubstitution || style.fontFamily;
    fontFamily = TextLayer.fontFamilyMap.get(fontFamily) || fontFamily;
    const fontHeight = Math.hypot(tx[2], tx[3]);
    const fontAscent = fontHeight * TextLayer.#getAscent(fontFamily, style, this.#lang);
    let left, top;
    if (angle === 0) {
      left = tx[4];
      top = tx[5] - fontAscent;
    } else {
      left = tx[4] + fontAscent * Math.sin(angle);
      top = tx[5] - fontAscent * Math.cos(angle);
    }
    const divStyle = textDiv.style;
    divStyle.left = `${(100 * left / this.#pageWidth).toFixed(2)}%`;
    divStyle.top = `${(100 * top / this.#pageHeight).toFixed(2)}%`;
    const roundedFontHeight = Math.round(fontHeight * 100) / 100;
    divStyle.setProperty("--font-height", `${roundedFontHeight}px`);
    divStyle.fontFamily = fontFamily;
    textDivProperties.fontSize = roundedFontHeight;
    textDiv.setAttribute("role", "presentation");
    textDiv.textContent = geom.str;
    textDiv.dir = geom.dir;
    if (this.#fontInspectorEnabled) {
      textDiv.dataset.fontName = style.fontSubstitutionLoadedName || geom.fontName;
    }
    if (angle !== 0) {
      textDivProperties.angle = angle * (180 / Math.PI);
    }
    let shouldScaleText = false;
    if (geom.str.length > 1) {
      shouldScaleText = true;
    } else if (geom.str !== " " && geom.transform[0] !== geom.transform[3]) {
      const absScaleX = Math.abs(geom.transform[0]),
        absScaleY = Math.abs(geom.transform[3]);
      if (absScaleX !== absScaleY && Math.max(absScaleX, absScaleY) / Math.min(absScaleX, absScaleY) > 1.5) {
        shouldScaleText = true;
      }
    }
    if (shouldScaleText) {
      textDivProperties.canvasWidth = style.vertical ? geom.height : geom.width;
    }
    this.#layoutTextParams.div = textDiv;
    this.#layoutTextParams.properties = textDivProperties;
    this.#layout(this.#layoutTextParams);
    if (textDivProperties.hasText) {
      this.#container.append(textDiv);
    }
    if (textDivProperties.hasEOL) {
      const br = document.createElement("br");
      br.setAttribute("role", "presentation");
      this.#container.append(br);
    }
  }
  #layout(params) {
    const {
      div,
      properties,
      ctx
    } = params;
    const {
      style
    } = div;
    const {
      canvasWidth,
      fontSize
    } = properties;
    if (canvasWidth !== 0 && fontSize !== 0 && properties.hasText) {
      const {
        fontFamily
      } = style;
      const pixelRatio = this.#pixelRatio;
      const measuredSize = TextLayer.#quantizeFontSize(fontSize * this.#scale / pixelRatio) * pixelRatio;
      TextLayer.#ensureCtxFont(ctx, measuredSize, fontFamily);
      const {
        width
      } = ctx.measureText(div.textContent);
      if (width > 0) {
        style.setProperty("--scale-x", canvasWidth * measuredSize / (width * fontSize));
      }
    }
    if (properties.angle !== 0) {
      style.setProperty("--rotate", `${properties.angle}deg`);
    }
  }
  static cleanup() {
    if (this.#pendingTextLayers.size > 0) {
      return;
    }
    this.#ascentCache.clear();
    for (const {
      canvas
    } of this.#canvasContexts.values()) {
      canvas.remove();
    }
    this.#canvasContexts.clear();
  }
  static #getCtx(lang = null) {
    let ctx = this.#canvasContexts.get(lang ||= "");
    if (!ctx) {
      const canvas = document.createElement("canvas");
      canvas.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;display:none;" + "letter-spacing:normal;word-spacing:normal";
      canvas.lang = lang;
      document.body.append(canvas);
      ctx = canvas.getContext("2d", {
        alpha: false,
        willReadFrequently: true
      });
      this.#canvasContexts.set(lang, ctx);
      this.#canvasCtxFonts.set(ctx, {
        size: 0,
        family: ""
      });
    }
    return ctx;
  }
  static #quantizeFontSize(size) {
    size = Math.fround(size);
    const d = Math.fround(size * ((1 << 17) + 1));
    return Math.fround(d - Math.fround(d - size));
  }
  static #ensureCtxFont(ctx, size, family) {
    const cached = this.#canvasCtxFonts.get(ctx);
    if (size === cached.size && family === cached.family) {
      return;
    }
    ctx.font = `${size}px ${family}`;
    cached.size = size;
    cached.family = family;
  }
  static #ensureMinFontSizeComputed() {
    if (this.#minFontSize !== null) {
      return;
    }
    const div = document.createElement("div");
    div.style.opacity = 0;
    div.style.lineHeight = 1;
    div.style.fontSize = "1px";
    div.style.position = "absolute";
    div.textContent = "X";
    document.body.append(div);
    this.#minFontSize = div.getBoundingClientRect().height;
    div.remove();
  }
  static #getAscent(fontFamily, style, lang) {
    const cachedAscent = this.#ascentCache.get(fontFamily);
    if (cachedAscent) {
      return cachedAscent;
    }
    const ctx = this.#getCtx(lang);
    this.#ensureCtxFont(ctx, DEFAULT_FONT_SIZE, fontFamily);
    const metrics = ctx.measureText("");
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = Math.abs(metrics.fontBoundingBoxDescent);
    let ratio = 0.8;
    if (ascent) {
      ratio = ascent / (ascent + descent);
    } else {
      if (FeatureTest.platform.isFirefox) {
        warn("Enable the `dom.textMetrics.fontBoundingBox.enabled` preference " + "in `about:config` to improve TextLayer rendering.");
      }
      if (style.ascent) {
        ratio = style.ascent;
      } else if (style.descent) {
        ratio = 1 + style.descent;
      }
    }
    this.#ascentCache.set(fontFamily, ratio);
    return ratio;
  }
}
export { DEFAULT_FONT_SIZE, TextLayer };