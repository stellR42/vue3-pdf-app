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
import "core-js/modules/es.iterator.some.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import { AnnotationEditorParamsType, AnnotationEditorType, shadow, Util } from "../../shared/util.js";
import { DrawingEditor, DrawingOptions } from "./draw.js";
import { FreeHighlightDrawer, FreeHighlightOutliner, HighlightOutline } from "./drawers/highlight.js";
import { HighlightAnnotationElement, InkAnnotationElement } from "../annotation_layer.js";
import { AnnotationEditor } from "./editor.js";
import { ColorPicker } from "./color_picker.js";
import { KeyboardManager } from "./tools.js";
import { stopEvent } from "../dom_utils.js";
class HighlightDrawingOptions extends DrawingOptions {
  constructor(properties = null) {
    super();
    super.updateProperties(properties);
  }
  updateSVGProperty(name, value) {
    if (name !== "thickness") {
      super.updateSVGProperty(name, value);
    }
  }
  clone() {
    const clone = new HighlightDrawingOptions();
    clone.updateAll(this);
    return clone;
  }
}
class HighlightEditor extends DrawingEditor {
  #anchorNode = null;
  #anchorOffset = 0;
  #focusNode = null;
  #focusOffset = 0;
  #methodOfCreation = "";
  #text = "";
  static _DEFAULT_OPACITY = 1;
  static _DEFAULT_THICKNESS = 12;
  static _defaultDrawingOptions = null;
  static _type = "highlight";
  static _editorType = AnnotationEditorType.HIGHLIGHT;
  static get _keyboardManager() {
    const proto = HighlightEditor.prototype;
    return shadow(this, "_keyboardManager", new KeyboardManager([[["ArrowLeft"], proto._moveCaret, {
      args: [0]
    }], [["ArrowRight"], proto._moveCaret, {
      args: [1]
    }], [["ArrowUp"], proto._moveCaret, {
      args: [2]
    }], [["ArrowDown"], proto._moveCaret, {
      args: [3]
    }]]));
  }
  constructor(params) {
    super({
      ...params,
      name: "highlightEditor"
    });
    this.#anchorNode = params.anchorNode || null;
    this.#anchorOffset = params.anchorOffset || 0;
    this.#focusNode = params.focusNode || null;
    this.#focusOffset = params.focusOffset || 0;
    this.#methodOfCreation = params.methodOfCreation || (this._drawOutlines?.isFree ? "main_toolbar" : "");
    this.#text = params.text || "";
    this._isDraggable = false;
    this.defaultL10nId = "pdfjs-editor-highlight-editor";
    this.rotate();
  }
  static initialize(l10n, uiManager) {
    AnnotationEditor.initialize(l10n, uiManager);
    this._defaultDrawingOptions ||= new HighlightDrawingOptions({
      fill: uiManager.highlightColors?.values().next().value || "#fff066",
      "fill-opacity": HighlightEditor._DEFAULT_OPACITY,
      thickness: HighlightEditor._DEFAULT_THICKNESS
    });
  }
  static getDefaultDrawingOptions(options) {
    const clone = this._defaultDrawingOptions.clone();
    clone.updateProperties(options);
    return clone;
  }
  static get typesMap() {
    return shadow(this, "typesMap", new Map([[AnnotationEditorParamsType.HIGHLIGHT_COLOR, "fill"], [AnnotationEditorParamsType.HIGHLIGHT_THICKNESS, "thickness"]]));
  }
  static get isDrawer() {
    return false;
  }
  static get _hasClipPath() {
    return true;
  }
  static get _hasDrawClass() {
    return false;
  }
  _addOutlines(params) {
    const {
      boxes,
      drawOutlines
    } = params;
    if (!boxes && !drawOutlines) {
      return;
    }
    this._drawingOptions ||= params.drawingOptions || HighlightEditor.getDefaultDrawingOptions();
    if (boxes) {
      params = {
        ...params,
        drawOutlines: HighlightOutline.build(boxes, this._uiManager.direction === "ltr")
      };
    }
    super._addOutlines(params);
  }
  get colorType() {
    return AnnotationEditorParamsType.HIGHLIGHT_COLOR;
  }
  get color() {
    return this._drawingOptions.fill;
  }
  get opacity() {
    return this._drawingOptions["fill-opacity"];
  }
  get _opacityName() {
    return "fill-opacity";
  }
  get _drawRotation() {
    return this._drawOutlines?.isFree ? this.rotation : 0;
  }
  get isResizable() {
    return false;
  }
  get _mustBeDisabledOnCommit() {
    return false;
  }
  get _mustFixPosition() {
    return !this._drawOutlines?.isFree;
  }
  get telemetryInitialData() {
    return {
      action: "added",
      type: this._drawOutlines.isFree ? "free_highlight" : "highlight",
      color: this._uiManager.getNonHCMColorName(this.color),
      thickness: this._drawingOptions.thickness,
      methodOfCreation: this.#methodOfCreation
    };
  }
  get telemetryFinalData() {
    return {
      type: "highlight",
      color: this._uiManager.getNonHCMColorName(this.color)
    };
  }
  static computeTelemetryFinalData(data) {
    return {
      numberOfColors: data.get("color").size
    };
  }
  translateInPage(x, y) {}
  get toolbarPosition() {
    return this.#relativeToBox(this._drawOutlines.focusOutline.lastPoint);
  }
  get commentButtonPosition() {
    return this.#relativeToBox(this._drawOutlines.firstPoint);
  }
  #relativeToBox([pointX, pointY]) {
    const [x, y, width, height] = this._drawOutlines.box;
    return [(pointX - x) / width, (pointY - y) / height];
  }
  updateParams(type, value) {
    switch (type) {
      case AnnotationEditorParamsType.HIGHLIGHT_COLOR:
        this._updateColorAndOpacity(value, HighlightEditor._DEFAULT_OPACITY, type);
        this._reportTelemetry({
          action: "color_changed",
          color: this._uiManager.getNonHCMColorName(value)
        }, true);
        break;
      case AnnotationEditorParamsType.HIGHLIGHT_THICKNESS:
        super.updateParams(type, value);
        this._reportTelemetry({
          action: "thickness_changed",
          thickness: value
        }, true);
        break;
    }
  }
  get propertiesToUpdate() {
    const properties = super.propertiesToUpdate;
    properties.push([AnnotationEditorParamsType.HIGHLIGHT_FREE, this._drawOutlines.isFree]);
    return properties;
  }
  get toolbarButtons() {
    if (this._uiManager.highlightColors) {
      this._colorPicker = new ColorPicker({
        editor: this
      });
      return [["colorPicker", this._colorPicker]];
    }
    return super.toolbarButtons;
  }
  fixAndSetPosition() {
    return super.fixAndSetPosition(this._drawRotation);
  }
  getRect(tx, ty) {
    return super.getRect(tx, ty, this._drawRotation);
  }
  onceAdded(focus) {
    if (!this.annotationElementId) {
      this.parent.addUndoableEditor(this);
    }
    if (focus) {
      this.div.focus();
    }
  }
  remove() {
    this._reportTelemetry({
      action: "deleted"
    });
    super.remove();
  }
  render() {
    if (this.div) {
      return this.div;
    }
    const div = super.render();
    if (this.#text) {
      div.setAttribute("aria-label", this.#text);
      div.setAttribute("role", "mark");
    }
    if (this._drawOutlines.isFree) {
      div.classList.add("free");
    } else {
      div.addEventListener("keydown", this.#keydown.bind(this), {
        signal: this._uiManager._signal
      });
    }
    this.enableEditing();
    return div;
  }
  #keydown(event) {
    HighlightEditor._keyboardManager.exec(this, event);
  }
  _moveCaret(direction) {
    this.parent.unselect(this);
    switch (direction) {
      case 0:
      case 2:
        this.#setCaret(true);
        break;
      case 1:
      case 3:
        this.#setCaret(false);
        break;
    }
  }
  #setCaret(start) {
    if (!this.#anchorNode) {
      return;
    }
    const selection = window.getSelection();
    if (start) {
      selection.setPosition(this.#anchorNode, this.#anchorOffset);
    } else {
      selection.setPosition(this.#focusNode, this.#focusOffset);
    }
  }
  unselect() {
    super.unselect();
    if (!this._drawOutlines.isFree) {
      this.#setCaret(false);
    }
  }
  static createDrawerInstance({
    x,
    y,
    box,
    parent,
    isLTR
  }) {
    return new FreeHighlightDrawer(x, y, box, parent.scale, this._defaultDrawingOptions.thickness / 2, isLTR, 0.001);
  }
  static _getDrawingTarget(parent, {
    target
  }) {
    return target.closest(".textLayer");
  }
  static _getPointerCoords({
    x,
    y
  }) {
    return [x, y];
  }
  static _addDrawingListeners(target, signal) {
    target.classList.add("free");
    signal.addEventListener("abort", () => target.classList.remove("free"), {
      once: true
    });
    window.addEventListener("blur", () => this._endDraw(null), {
      signal
    });
    window.addEventListener("pointerdown", stopEvent, {
      capture: true,
      passive: false,
      signal
    });
  }
  static _endDrawingSession(isAborted = false) {
    return this.endDrawing(isAborted);
  }
  createDrawingOptions({
    color,
    opacity,
    thickness
  }) {
    const {
      _defaultDrawingOptions: defaults,
      _DEFAULT_OPACITY
    } = HighlightEditor;
    this._drawingOptions = HighlightEditor.getDefaultDrawingOptions({
      fill: Util.makeHexColor(...color),
      "fill-opacity": opacity || _DEFAULT_OPACITY,
      thickness: thickness || defaults.thickness
    });
  }
  static deserializeDraw(pageX, pageY, pageWidth, pageHeight, _innerMargin, data, uiManager) {
    const {
      quadPoints
    } = data;
    if (quadPoints) {
      const boxes = [];
      for (let i = 0, ii = quadPoints.length; i < ii; i += 8) {
        boxes.push({
          x: (quadPoints[i] - pageX) / pageWidth,
          y: 1 - (quadPoints[i + 1] - pageY) / pageHeight,
          width: (quadPoints[i + 2] - quadPoints[i]) / pageWidth,
          height: (quadPoints[i + 1] - quadPoints[i + 5]) / pageHeight
        });
      }
      return HighlightOutline.build(boxes, uiManager.direction === "ltr");
    }
    const thickness = data.thickness || this._defaultDrawingOptions.thickness;
    const points = (data.inkLists || data.outlines.points)[0];
    const outliner = new FreeHighlightOutliner(points[0] - pageX, pageHeight - (points[1] - pageY), [0, 0, pageWidth, pageHeight], 1, thickness / 2, true, 0.001);
    for (let i = 0, ii = points.length; i < ii; i += 2) {
      outliner.add(points[i] - pageX, pageHeight - (points[i + 1] - pageY));
    }
    const outlines = outliner.getOutlines();
    outlines.buildFocusOutline(thickness);
    return outlines;
  }
  static async deserialize(data, parent, uiManager) {
    let initialData = null;
    if (data instanceof HighlightAnnotationElement) {
      const {
        data: {
          quadPoints,
          rect,
          rotation,
          id,
          color,
          opacity,
          popupRef,
          richText,
          contentsObj,
          creationDate,
          modificationDate
        },
        parent: {
          page: {
            pageNumber
          }
        }
      } = data;
      initialData = data = {
        annotationType: AnnotationEditorType.HIGHLIGHT,
        color: Array.from(color),
        opacity,
        quadPoints,
        pageIndex: pageNumber - 1,
        rect: rect.slice(0),
        rotation,
        annotationElementId: id,
        id,
        deleted: false,
        popupRef,
        richText,
        comment: contentsObj?.str || null,
        creationDate,
        modificationDate
      };
    } else if (data instanceof InkAnnotationElement) {
      const {
        data: {
          inkLists,
          rect,
          rotation,
          id,
          color,
          borderStyle: {
            rawWidth: thickness
          },
          popupRef,
          richText,
          contentsObj,
          creationDate,
          modificationDate
        },
        parent: {
          page: {
            pageNumber
          }
        }
      } = data;
      initialData = data = {
        annotationType: AnnotationEditorType.HIGHLIGHT,
        color: Array.from(color),
        thickness,
        inkLists,
        pageIndex: pageNumber - 1,
        rect: rect.slice(0),
        rotation,
        annotationElementId: id,
        id,
        deleted: false,
        popupRef,
        richText,
        comment: contentsObj?.str || null,
        creationDate,
        modificationDate
      };
    }
    const editor = await super.deserialize(data, parent, uiManager);
    editor._initialData = initialData;
    if (data.comment) {
      editor.setCommentData(data);
    }
    return editor;
  }
  serialize(isForCopying = false) {
    if (this.isEmpty() || isForCopying) {
      return null;
    }
    if (this.deleted) {
      return this.serializeDeleted();
    }
    const serialized = super.serialize(isForCopying);
    Object.assign(serialized, {
      color: AnnotationEditor._colorManager.convert(this._uiManager.getNonHCMColor(this.color)),
      opacity: this.opacity,
      thickness: this._drawingOptions.thickness,
      quadPoints: this._drawOutlines.serializeQuadPoints(this.pageTranslation, this.pageDimensions),
      outlines: this._drawOutlines.serialize(serialized.rect, this._drawRotation)
    });
    this.addComment(serialized);
    if (this.annotationElementId && !this.#hasElementChanged(serialized)) {
      return null;
    }
    serialized.id = this.annotationElementId;
    return serialized;
  }
  #hasElementChanged(serialized) {
    const {
      color
    } = this._initialData;
    return this.hasEditedComment || serialized.color.some((c, i) => c !== color[i]);
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
export { HighlightEditor };