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
import "core-js/modules/es.iterator.constructor.js";
import "core-js/modules/es.iterator.filter.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import "core-js/modules/web.dom-exception.stack.js";
import { AnnotationEditorType, AnnotationPrefix } from "../../shared/util.js";
import { ColorScheme, SupportedImageMimeTypes } from "../dom_utils.js";
import { OutputScale, PixelsPerInch } from "../display_utils.js";
import { AnnotationEditor } from "./editor.js";
import { StampAnnotationElement } from "../annotation_layer.js";
class StampEditor extends AnnotationEditor {
  #bitmap = null;
  #bitmapId = null;
  #bitmapPromise = null;
  #bitmapUrl = null;
  #bitmapFile = null;
  #bitmapFileName = "";
  #canvas = null;
  #missingCanvas = false;
  #resizeTimeoutId = null;
  #isSvg = false;
  #hasBeenAddedInUndoStack = false;
  static _type = "stamp";
  static _editorType = AnnotationEditorType.STAMP;
  constructor(params) {
    super({
      ...params,
      name: "stampEditor"
    });
    this.#bitmapUrl = params.bitmapUrl;
    this.#bitmapFile = params.bitmapFile;
    this.defaultL10nId = "pdfjs-editor-stamp-editor";
  }
  static initialize(l10n, uiManager) {
    AnnotationEditor.initialize(l10n, uiManager);
  }
  static isHandlingMimeForPasting(mime) {
    return SupportedImageMimeTypes.has(mime);
  }
  static paste(item, parent) {
    parent.pasteEditor({
      mode: AnnotationEditorType.STAMP
    }, {
      bitmapFile: item.getAsFile()
    });
  }
  altTextFinish() {
    if (this._uiManager.useNewAltTextFlow) {
      this.div.hidden = false;
    }
    super.altTextFinish();
  }
  get telemetryFinalData() {
    return {
      type: "stamp",
      hasAltText: !!this.altTextData?.altText
    };
  }
  static computeTelemetryFinalData(data) {
    const hasAltTextStats = data.get("hasAltText");
    return {
      hasAltText: hasAltTextStats.get(true) ?? 0,
      hasNoAltText: hasAltTextStats.get(false) ?? 0
    };
  }
  #getBitmapFetched(data, fromId = false) {
    if (!data) {
      this.remove();
      return;
    }
    this.#bitmap = data.bitmap;
    if (!fromId) {
      this.#bitmapId = data.id;
      this.#isSvg = data.isSvg;
    }
    if (data.file) {
      this.#bitmapFileName = data.file.name;
    }
    this.#createCanvas();
  }
  #getBitmapDone() {
    this.#bitmapPromise = null;
    this._uiManager.enableWaiting(false);
    if (!this.#canvas) {
      return;
    }
    if (this._uiManager.useNewAltTextWhenAddingImage && this._uiManager.useNewAltTextFlow && this.#bitmap) {
      this.addEditToolbar().then(() => {
        this._editToolbar.hide();
        this._uiManager.editAltText(this, true);
      });
      return;
    }
    if (!this._uiManager.useNewAltTextWhenAddingImage && this._uiManager.useNewAltTextFlow && this.#bitmap) {
      this._reportTelemetry({
        action: "pdfjs.image.image_added",
        data: {
          alt_text_modal: false,
          alt_text_type: "empty"
        }
      });
      try {
        this.mlGuessAltText();
      } catch {}
    }
    this.div.focus();
  }
  async mlGuessAltText(imageData = null, updateAltTextData = true) {
    if (this.hasAltTextData()) {
      return null;
    }
    const {
      mlManager
    } = this._uiManager;
    if (!mlManager) {
      throw new Error("No ML.");
    }
    if (!(await mlManager.isEnabledFor("altText"))) {
      throw new Error("ML isn't enabled for alt text.");
    }
    const {
      data,
      width,
      height
    } = imageData || this.copyCanvas(null, null, true).imageData;
    const response = await mlManager.guess({
      name: "altText",
      request: {
        data,
        width,
        height,
        channels: data.length / (width * height)
      }
    });
    if (!response) {
      throw new Error("No response from the AI service.");
    }
    if (response.error) {
      throw new Error("Error from the AI service.");
    }
    if (response.cancel) {
      return null;
    }
    if (!response.output) {
      throw new Error("No valid response from the AI service.");
    }
    const altText = response.output;
    await this.setGuessedAltText(altText);
    if (updateAltTextData && !this.hasAltTextData()) {
      this.altTextData = {
        alt: altText,
        decorative: false
      };
    }
    return altText;
  }
  #getBitmap() {
    if (this.#bitmapId) {
      this._uiManager.enableWaiting(true);
      this._uiManager.imageManager.getFromId(this.#bitmapId).then(data => this.#getBitmapFetched(data, true)).finally(() => this.#getBitmapDone());
      return;
    }
    if (this.#bitmapUrl) {
      const url = this.#bitmapUrl;
      this.#bitmapUrl = null;
      this._uiManager.enableWaiting(true);
      this.#bitmapPromise = this._uiManager.imageManager.getFromUrl(url).then(data => this.#getBitmapFetched(data)).finally(() => this.#getBitmapDone());
      return;
    }
    if (this.#bitmapFile) {
      const file = this.#bitmapFile;
      this.#bitmapFile = null;
      this._uiManager.enableWaiting(true);
      this.#bitmapPromise = this._uiManager.imageManager.getFromFile(file).then(data => this.#getBitmapFetched(data)).finally(() => this.#getBitmapDone());
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = SupportedImageMimeTypes.keys().join(",");
    const signal = this._uiManager._signal;
    this.#bitmapPromise = new Promise(resolve => {
      input.addEventListener("change", async () => {
        if (!input.files || input.files.length === 0) {
          this.remove();
        } else {
          this._uiManager.enableWaiting(true);
          const data = await this._uiManager.imageManager.getFromFile(input.files[0]);
          this._reportTelemetry({
            action: "pdfjs.image.image_selected",
            data: {
              alt_text_modal: this._uiManager.useNewAltTextFlow
            }
          });
          this.#getBitmapFetched(data);
        }
        resolve();
      }, {
        signal
      });
      input.addEventListener("cancel", () => {
        this.remove();
        resolve();
      }, {
        signal
      });
    }).finally(() => this.#getBitmapDone());
    input.click();
  }
  remove() {
    if (this.#bitmapId) {
      this.#bitmap = null;
      this._uiManager.imageManager.deleteId(this.#bitmapId);
      this.#canvas?.remove();
      this.#canvas = null;
      if (this.#resizeTimeoutId) {
        clearTimeout(this.#resizeTimeoutId);
        this.#resizeTimeoutId = null;
      }
    }
    super.remove();
  }
  rebuild() {
    if (!this.parent) {
      if (this.#bitmapId) {
        this.#getBitmap();
      }
      return;
    }
    super.rebuild();
    if (this.div === null) {
      return;
    }
    if (this.#bitmapId && this.#canvas === null) {
      this.#getBitmap();
    }
    if (!this.isAttachedToDOM) {
      this.parent.add(this);
    }
  }
  onceAdded(focus) {
    this._isDraggable = true;
    if (focus) {
      this.div.focus();
    }
  }
  isEmpty() {
    return !(this.#bitmapPromise || this.#bitmap || this.#bitmapUrl || this.#bitmapFile || this.#bitmapId || this.#missingCanvas);
  }
  get toolbarButtons() {
    return [["altText", this.createAltText()]];
  }
  get isResizable() {
    return true;
  }
  render() {
    if (this.div) {
      return this.div;
    }
    let baseX, baseY;
    if (this._isCopy) {
      baseX = this.x;
      baseY = this.y;
    }
    super.render();
    this.div.hidden = true;
    this.createAltText();
    if (!this.#missingCanvas) {
      if (this.#bitmap) {
        this.#createCanvas();
      } else {
        this.#getBitmap();
      }
    }
    if (this._isCopy) {
      this._moveAfterPaste(baseX, baseY);
    }
    this._uiManager.addShouldRescale(this);
    return this.div;
  }
  setCanvas(annotationElementId, canvas) {
    const {
      id: bitmapId,
      bitmap
    } = this._uiManager.imageManager.getFromCanvas(annotationElementId, canvas);
    canvas.remove();
    if (bitmapId && this._uiManager.imageManager.isValidId(bitmapId)) {
      this.#bitmapId = bitmapId;
      if (bitmap) {
        this.#bitmap = bitmap;
      }
      this.#missingCanvas = false;
      this.#createCanvas();
    }
  }
  _onResized() {
    this.onScaleChanging();
  }
  onScaleChanging() {
    if (!this.parent) {
      return;
    }
    if (this.#resizeTimeoutId !== null) {
      clearTimeout(this.#resizeTimeoutId);
    }
    const TIME_TO_WAIT = 200;
    this.#resizeTimeoutId = setTimeout(() => {
      this.#resizeTimeoutId = null;
      this.#drawBitmap();
    }, TIME_TO_WAIT);
  }
  #createCanvas() {
    const {
      div
    } = this;
    let {
      width,
      height
    } = this.#bitmap;
    const [pageWidth, pageHeight] = this.pageDimensions;
    const MAX_RATIO = 0.75;
    if (this.width) {
      width = this.width * pageWidth;
      height = this.height * pageHeight;
    } else if (width > MAX_RATIO * pageWidth || height > MAX_RATIO * pageHeight) {
      const factor = Math.min(MAX_RATIO * pageWidth / width, MAX_RATIO * pageHeight / height);
      width *= factor;
      height *= factor;
    }
    this._uiManager.enableWaiting(false);
    const canvas = this.#canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    this.addContainer(canvas);
    this.width = width / pageWidth;
    this.height = height / pageHeight;
    this.setDims();
    if (this._initialOptions?.isCentered) {
      this.center();
    } else {
      this.fixAndSetPosition();
    }
    this._initialOptions = null;
    if (!this._uiManager.useNewAltTextWhenAddingImage || !this._uiManager.useNewAltTextFlow || this.annotationElementId) {
      div.hidden = false;
    }
    this.#drawBitmap();
    if (!this.#hasBeenAddedInUndoStack) {
      this.parent.addUndoableEditor(this);
      this.#hasBeenAddedInUndoStack = true;
    }
    this._reportTelemetry({
      action: "inserted_image"
    });
    if (this.#bitmapFileName) {
      this.div.setAttribute("aria-description", this.#bitmapFileName);
    }
    if (!this.annotationElementId) {
      this._uiManager.a11yAlert(AnnotationEditor._l10nAlert.stamp);
    }
  }
  copyCanvas(maxDataDimension, maxPreviewDimension, createImageData = false) {
    maxDataDimension ||= 224;
    const {
      width: bitmapWidth,
      height: bitmapHeight
    } = this.#bitmap;
    const outputScale = new OutputScale();
    let bitmap = this.#bitmap;
    let width = bitmapWidth,
      height = bitmapHeight;
    let canvas = null;
    if (maxPreviewDimension) {
      if (bitmapWidth > maxPreviewDimension || bitmapHeight > maxPreviewDimension) {
        const ratio = Math.min(maxPreviewDimension / bitmapWidth, maxPreviewDimension / bitmapHeight);
        width = Math.floor(bitmapWidth * ratio);
        height = Math.floor(bitmapHeight * ratio);
      }
      canvas = document.createElement("canvas");
      const scaledWidth = canvas.width = Math.ceil(width * outputScale.sx);
      const scaledHeight = canvas.height = Math.ceil(height * outputScale.sy);
      if (!this.#isSvg) {
        bitmap = this.#scaleBitmap(scaledWidth, scaledHeight);
      }
      const ctx = canvas.getContext("2d");
      ctx.filter = this._uiManager.hcmFilter;
      let white = "white",
        black = "#cfcfd8";
      if (this._uiManager.hcmFilter !== "none") {
        black = "black";
      } else if (ColorScheme.isDarkMode) {
        white = "#8f8f9d";
        black = "#42414d";
      }
      const boxDim = 15;
      const boxDimWidth = boxDim * outputScale.sx;
      const boxDimHeight = boxDim * outputScale.sy;
      const pattern = new OffscreenCanvas(boxDimWidth * 2, boxDimHeight * 2);
      const patternCtx = pattern.getContext("2d");
      patternCtx.fillStyle = white;
      patternCtx.fillRect(0, 0, boxDimWidth * 2, boxDimHeight * 2);
      patternCtx.fillStyle = black;
      patternCtx.fillRect(0, 0, boxDimWidth, boxDimHeight);
      patternCtx.fillRect(boxDimWidth, boxDimHeight, boxDimWidth, boxDimHeight);
      ctx.fillStyle = ctx.createPattern(pattern, "repeat");
      ctx.fillRect(0, 0, scaledWidth, scaledHeight);
      ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, scaledWidth, scaledHeight);
    }
    let imageData = null;
    if (createImageData) {
      let dataWidth, dataHeight;
      if (outputScale.symmetric && bitmap.width < maxDataDimension && bitmap.height < maxDataDimension) {
        dataWidth = bitmap.width;
        dataHeight = bitmap.height;
      } else {
        bitmap = this.#bitmap;
        if (bitmapWidth > maxDataDimension || bitmapHeight > maxDataDimension) {
          const ratio = Math.min(maxDataDimension / bitmapWidth, maxDataDimension / bitmapHeight);
          dataWidth = Math.floor(bitmapWidth * ratio);
          dataHeight = Math.floor(bitmapHeight * ratio);
          if (!this.#isSvg) {
            bitmap = this.#scaleBitmap(dataWidth, dataHeight);
          }
        }
      }
      const offscreen = new OffscreenCanvas(dataWidth, dataHeight);
      const offscreenCtx = offscreen.getContext("2d", {
        willReadFrequently: true
      });
      offscreenCtx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, dataWidth, dataHeight);
      imageData = {
        width: dataWidth,
        height: dataHeight,
        data: offscreenCtx.getImageData(0, 0, dataWidth, dataHeight).data
      };
    }
    return {
      canvas,
      width,
      height,
      imageData
    };
  }
  #scaleBitmap(width, height) {
    const {
      width: bitmapWidth,
      height: bitmapHeight
    } = this.#bitmap;
    let newWidth = bitmapWidth;
    let newHeight = bitmapHeight;
    let bitmap = this.#bitmap;
    while (newWidth > 2 * width || newHeight > 2 * height) {
      const prevWidth = newWidth;
      const prevHeight = newHeight;
      if (newWidth > 2 * width) {
        newWidth = Math.ceil(newWidth / 2);
      }
      if (newHeight > 2 * height) {
        newHeight = Math.ceil(newHeight / 2);
      }
      const offscreen = new OffscreenCanvas(newWidth, newHeight);
      const ctx = offscreen.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, prevWidth, prevHeight, 0, 0, newWidth, newHeight);
      bitmap = offscreen.transferToImageBitmap();
    }
    return bitmap;
  }
  #drawBitmap() {
    const [parentWidth, parentHeight] = this.parentDimensions;
    const {
      width,
      height
    } = this;
    const outputScale = new OutputScale();
    const scaledWidth = Math.ceil(width * parentWidth * outputScale.sx);
    const scaledHeight = Math.ceil(height * parentHeight * outputScale.sy);
    const canvas = this.#canvas;
    if (!canvas || canvas.width === scaledWidth && canvas.height === scaledHeight) {
      return;
    }
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;
    const bitmap = this.#isSvg ? this.#bitmap : this.#scaleBitmap(scaledWidth, scaledHeight);
    const ctx = canvas.getContext("2d");
    ctx.filter = this._uiManager.hcmFilter;
    ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, scaledWidth, scaledHeight);
  }
  #serializeBitmap(toUrl) {
    if (toUrl) {
      if (this.#isSvg) {
        const url = this._uiManager.imageManager.getSvgUrl(this.#bitmapId);
        if (url) {
          return url;
        }
      }
      const canvas = document.createElement("canvas");
      ({
        width: canvas.width,
        height: canvas.height
      } = this.#bitmap);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(this.#bitmap, 0, 0);
      return canvas.toDataURL();
    }
    if (this.#isSvg) {
      const [pageWidth, pageHeight] = this.pageDimensions;
      const width = Math.round(this.width * pageWidth * PixelsPerInch.PDF_TO_CSS_UNITS);
      const height = Math.round(this.height * pageHeight * PixelsPerInch.PDF_TO_CSS_UNITS);
      const offscreen = new OffscreenCanvas(width, height);
      const ctx = offscreen.getContext("2d");
      ctx.drawImage(this.#bitmap, 0, 0, this.#bitmap.width, this.#bitmap.height, 0, 0, width, height);
      return offscreen.transferToImageBitmap();
    }
    return structuredClone(this.#bitmap);
  }
  static async deserialize(data, parent, uiManager) {
    let initialData = null;
    let missingCanvas = false;
    if (data instanceof StampAnnotationElement) {
      const {
        data: {
          rect,
          rotation,
          id,
          structParent,
          popupRef,
          richText,
          contentsObj,
          creationDate,
          modificationDate
        },
        container,
        parent: {
          page: {
            pageNumber
          }
        },
        canvas
      } = data;
      let bitmapId, bitmap;
      if (canvas) {
        delete data.canvas;
        ({
          id: bitmapId,
          bitmap
        } = uiManager.imageManager.getFromCanvas(container.id, canvas));
        canvas.remove();
      } else {
        missingCanvas = true;
        data._hasNoCanvas = true;
      }
      const altText = (await parent._structTree.getAriaAttributes(`${AnnotationPrefix}${id}`))?.get("aria-label") || "";
      initialData = data = {
        annotationType: AnnotationEditorType.STAMP,
        bitmapId,
        bitmap,
        pageIndex: pageNumber - 1,
        rect: rect.slice(0),
        rotation,
        annotationElementId: id,
        id,
        deleted: false,
        accessibilityData: {
          decorative: false,
          altText
        },
        isSvg: false,
        structParent,
        popupRef,
        richText,
        comment: contentsObj?.str || null,
        creationDate,
        modificationDate
      };
    }
    const editor = await super.deserialize(data, parent, uiManager);
    const {
      rect,
      bitmap,
      bitmapUrl,
      bitmapId,
      isSvg,
      accessibilityData
    } = data;
    if (missingCanvas) {
      uiManager.addMissingCanvas(data.id, editor);
      editor.#missingCanvas = true;
    } else if (bitmapId && uiManager.imageManager.isValidId(bitmapId)) {
      editor.#bitmapId = bitmapId;
      if (bitmap) {
        editor.#bitmap = bitmap;
      }
    } else {
      editor.#bitmapUrl = bitmapUrl;
    }
    editor.#isSvg = isSvg;
    const [parentWidth, parentHeight] = editor.pageDimensions;
    editor.width = (rect[2] - rect[0]) / parentWidth;
    editor.height = (rect[3] - rect[1]) / parentHeight;
    if (accessibilityData) {
      editor.altTextData = accessibilityData;
    }
    editor._initialData = initialData;
    if (data.comment) {
      editor.setCommentData(data);
    }
    editor.#hasBeenAddedInUndoStack = !!initialData;
    return editor;
  }
  serialize(isForCopying = false, context = null) {
    if (this.isEmpty()) {
      return null;
    }
    if (this.deleted) {
      return this.serializeDeleted();
    }
    const serialized = Object.assign(super.serialize(isForCopying), {
      bitmapId: this.#bitmapId,
      isSvg: this.#isSvg
    });
    this.addComment(serialized);
    if (isForCopying) {
      serialized.bitmapUrl = this.#serializeBitmap(true);
      serialized.accessibilityData = this.serializeAltText(true);
      serialized.isCopy = true;
      return serialized;
    }
    const {
      decorative,
      altText
    } = this.serializeAltText(false);
    if (!decorative && altText) {
      serialized.accessibilityData = {
        type: "Figure",
        alt: altText
      };
    }
    if (this.annotationElementId) {
      const changes = this.#hasElementChanged(serialized);
      if (changes.isSame) {
        return null;
      }
      if (changes.isSameAltText) {
        delete serialized.accessibilityData;
      } else {
        const structParent = this._initialData.structParent ?? -1;
        if (serialized.accessibilityData) {
          serialized.accessibilityData.structParent = structParent;
        } else if (structParent >= 0) {
          serialized.accessibilityData = {
            type: "Figure",
            alt: "",
            structParent
          };
        }
      }
      serialized.id = this.annotationElementId;
      delete serialized.bitmapId;
      return serialized;
    }
    if (context === null) {
      return serialized;
    }
    context.stamps ||= new Map();
    const area = this.#isSvg ? (serialized.rect[2] - serialized.rect[0]) * (serialized.rect[3] - serialized.rect[1]) : null;
    if (!context.stamps.has(this.#bitmapId)) {
      context.stamps.set(this.#bitmapId, {
        area,
        serialized
      });
      serialized.bitmap = this.#serializeBitmap(false);
    } else if (this.#isSvg) {
      const prevData = context.stamps.get(this.#bitmapId);
      if (area > prevData.area) {
        prevData.area = area;
        prevData.serialized.bitmap.close();
        prevData.serialized.bitmap = this.#serializeBitmap(false);
      }
    }
    return serialized;
  }
  #hasElementChanged(serialized) {
    const {
      pageIndex,
      accessibilityData: {
        altText
      }
    } = this._initialData;
    const isSamePageIndex = serialized.pageIndex === pageIndex;
    const isSameAltText = (serialized.accessibilityData?.alt || "") === altText;
    return {
      isSame: !this.hasEditedComment && !this._hasBeenMoved && !this._hasBeenResized && isSamePageIndex && isSameAltText,
      isSameAltText
    };
  }
  renderAnnotationElement(annotation) {
    if (this.deleted) {
      annotation.hide();
      return null;
    }
    annotation.updateEdited({
      rect: this.getPDFRect(),
      popup: this.comment
    });
    return null;
  }
}
export { StampEditor };