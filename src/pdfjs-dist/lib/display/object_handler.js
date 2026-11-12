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
import "core-js/modules/web.dom-exception.stack.js";
import { assert, warn } from "../shared/util.js";
import { FontInfo, FontPathInfo, PatternInfo } from "./obj_bin_transform_display.js";
import { FontFaceObject } from "./font_loader.js";
import { PDFObjects } from "./pdf_objects.js";
class ObjectHandler {
  constructor({
    messageHandler,
    commonObjs,
    fontLoader,
    pageCache,
    pdfBug = false,
    shouldCreatePageObjs = false
  }) {
    this.messageHandler = messageHandler;
    this.commonObjs = commonObjs;
    this.fontLoader = fontLoader;
    this.pageCache = pageCache;
    this.pdfBug = pdfBug;
    this.shouldCreatePageObjs = shouldCreatePageObjs;
  }
  resolveCommonObject(id, type, exportedData) {
    if (type === "CopyLocalImage") {
      const {
        imageRef
      } = exportedData;
      assert(imageRef, "The imageRef must be defined.");
      for (const pageOrObjs of this.pageCache.values()) {
        const objs = pageOrObjs.objs || pageOrObjs;
        for (const [, data] of objs) {
          if (data?.ref !== imageRef) {
            continue;
          }
          if (!data.dataLen) {
            return null;
          }
          const copy = structuredClone(data);
          this.commonObjs.resolve(id, copy);
          return data.dataLen;
        }
      }
      return null;
    }
    switch (type) {
      case "Font":
        if ("error" in exportedData) {
          const exportedError = exportedData.error;
          warn(`Error during font loading: ${exportedError}`);
          this.commonObjs.resolve(id, exportedError);
          break;
        }
        const fontData = new FontInfo(exportedData.buffer);
        const inspectFont = this.pdfBug && globalThis.FontInspector?.enabled ? (font, url) => globalThis.FontInspector.fontAdded(font, url) : null;
        const font = new FontFaceObject(fontData, inspectFont, exportedData.charProcOperatorList, exportedData.extra);
        this.fontLoader.bind(font).catch(() => this.messageHandler.sendWithPromise("FontFallback", {
          id
        }).catch(reason => {
          warn(`FontFallback failed for "${id}": ${reason}`);
        })).finally(() => {
          if (!font.fontExtraProperties) {
            font.clearData();
          }
          this.commonObjs.resolve(id, font);
        });
        break;
      case "FontPath":
        this.commonObjs.resolve(id, new FontPathInfo(exportedData));
        break;
      case "Image":
        this.commonObjs.resolve(id, exportedData);
        break;
      case "Pattern":
        const pattern = new PatternInfo(exportedData);
        this.commonObjs.resolve(id, pattern.getIR());
        break;
      default:
        throw new Error(`Got unknown common object type ${type}`);
    }
    return null;
  }
  resolveObject(id, pageProxyId, type, exportedData) {
    let pageOrObjs = this.pageCache.get(pageProxyId);
    if (!pageOrObjs) {
      if (!this.shouldCreatePageObjs) {
        return false;
      }
      pageOrObjs = new PDFObjects();
      this.pageCache.set(pageProxyId, pageOrObjs);
    }
    const objs = pageOrObjs.objs || pageOrObjs;
    if (objs.has(id)) {
      return false;
    }
    if (pageOrObjs._intentStates?.size === 0) {
      exportedData?.bitmap?.close();
      return false;
    }
    switch (type) {
      case "Image":
      case "Pattern":
        objs.resolve(id, exportedData);
        return true;
      default:
        throw new Error(`Got unknown object type ${type}`);
    }
  }
}
export { ObjectHandler };