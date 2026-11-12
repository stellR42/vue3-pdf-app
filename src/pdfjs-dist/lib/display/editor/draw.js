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
import { AnnotationEditorParamsType, unreachable } from "../../shared/util.js";
import { bindEvents, CurrentPointers } from "./tools.js";
import { noContextMenu, stopEvent } from "../dom_utils.js";
import { AnnotationEditor } from "./editor.js";
class DrawingOptions {
  #svgProperties = Object.create(null);
  updateProperty(name, value) {
    this[name] = value;
    this.updateSVGProperty(name, value);
  }
  updateProperties(properties) {
    if (!properties) {
      return;
    }
    for (const [name, value] of Object.entries(properties)) {
      if (!name.startsWith("_")) {
        this.updateProperty(name, value);
      }
    }
  }
  updateSVGProperty(name, value) {
    this.#svgProperties[name] = value;
  }
  toSVGProperties() {
    const root = this.#svgProperties;
    this.#svgProperties = Object.create(null);
    return {
      root
    };
  }
  reset() {
    this.#svgProperties = Object.create(null);
  }
  updateAll(options = this) {
    this.updateProperties(options);
  }
  clone() {
    unreachable("Not implemented");
  }
}
class DrawingEditor extends AnnotationEditor {
  #internalDiv = null;
  #mustBeCommitted;
  _clipPathId = null;
  _colorPicker = null;
  _drawId = null;
  _drawOutlines = null;
  _focusDrawId = null;
  static _currentDrawId = -1;
  static _currentParent = null;
  static #currentDraw = null;
  static #currentDrawingAC = null;
  static #currentDrawingOptions = null;
  static #currentClipPathId = null;
  static _INNER_MARGIN = 3;
  constructor(params) {
    super(params);
    this.#mustBeCommitted = params.mustBeCommitted || false;
    this._addOutlines(params);
  }
  onUpdatedColor() {
    this._colorPicker?.update(this.color);
    super.onUpdatedColor();
  }
  onUpdatedOpacity() {
    this._colorPicker?.updateOpacity?.(this.opacity);
  }
  _addOutlines(params) {
    if (params.drawOutlines) {
      this.#createDrawOutlines(params);
      this.#addToDrawLayer();
    }
  }
  #createDrawOutlines({
    drawOutlines,
    drawId,
    drawingOptions,
    clipPathId
  }) {
    this._drawOutlines = drawOutlines;
    this._drawingOptions ||= drawingOptions;
    if (!this.annotationElementId) {
      this._uiManager.a11yAlert(AnnotationEditor._l10nAlert[this.editorType]);
    }
    if (drawId >= 0) {
      this._drawId = drawId;
      this._clipPathId = clipPathId ?? null;
      this.parent.drawLayer.finalizeDraw(drawId, drawOutlines.defaultProperties);
      this.#createFocusOutline(this.parent);
    } else {
      this._drawId = this.#createDrawing(drawOutlines, this.parent);
    }
    this.#updateBbox(drawOutlines.box);
  }
  #createDrawing(drawOutlines, parent) {
    const {
      id,
      clipPathId
    } = parent.drawLayer.draw(DrawingEditor._mergeSVGProperties(this._drawingOptions.toSVGProperties(), drawOutlines.defaultSVGProperties), false, this.constructor._hasClipPath);
    if (this.constructor._hasClipPath) {
      this._clipPathId = clipPathId;
    }
    this.#createFocusOutline(parent);
    return id;
  }
  #createFocusOutline(parent) {
    const properties = this._drawOutlines.getFocusSVGProperties(this.#rotationAngle);
    if (properties) {
      this._focusDrawId = parent.drawLayer.drawOutline(properties, this._drawOutlines.focusMustRemoveSelfIntersections);
    }
  }
  #updateFocusOutline(angle = this.#rotationAngle) {
    if (this._focusDrawId === null) {
      return;
    }
    this.parent?.drawLayer.updateProperties(this._focusDrawId, this._drawOutlines.getFocusSVGProperties(angle));
  }
  #toggleFocusOutlineClass(rootClass) {
    if (this._focusDrawId !== null) {
      this.parent?.drawLayer.updateProperties(this._focusDrawId, {
        rootClass
      });
    }
  }
  #updateVisibility() {
    const {
      parent,
      _drawId,
      _focusDrawId,
      _isVisible
    } = this;
    if (!parent || _drawId === null) {
      return;
    }
    const rootClass = {
      hidden: !_isVisible
    };
    parent.drawLayer.updateProperties(_drawId, {
      rootClass
    });
    if (_focusDrawId !== null) {
      parent.drawLayer.updateProperties(_focusDrawId, {
        rootClass
      });
    }
  }
  static _mergeSVGProperties(p1, p2) {
    const p1Keys = new Set(Object.keys(p1));
    for (const [key, value] of Object.entries(p2)) {
      if (p1Keys.has(key)) {
        Object.assign(p1[key], value);
      } else {
        p1[key] = value;
      }
    }
    return p1;
  }
  static getDefaultDrawingOptions(_options) {
    unreachable("Not implemented");
  }
  static get typesMap() {
    unreachable("Not implemented");
  }
  static get isDrawer() {
    return true;
  }
  static get _hasClipPath() {
    return false;
  }
  static get _hasDrawClass() {
    return true;
  }
  static get supportMultipleDrawings() {
    return false;
  }
  get _drawRotation() {
    return this.rotation;
  }
  get _opacityName() {
    return this.constructor.typesMap.get(this.opacityType);
  }
  get #rotationAngle() {
    return (this.parentRotation - this._drawRotation + 360) % 360;
  }
  static updateDefaultParams(type, value) {
    const propertyName = this.typesMap.get(type);
    if (propertyName) {
      this._defaultDrawingOptions.updateProperty(propertyName, value);
    }
    if (this._currentParent) {
      DrawingEditor.#currentDraw.updateProperty(propertyName, value);
      this._currentParent.drawLayer.updateProperties(this._currentDrawId, this._defaultDrawingOptions.toSVGProperties());
    }
  }
  updateParams(type, value) {
    const propertyName = this.constructor.typesMap.get(type);
    if (propertyName) {
      this._updateProperty(type, propertyName, value);
    }
  }
  static get defaultPropertiesToUpdate() {
    const properties = [];
    const options = this._defaultDrawingOptions;
    for (const [type, name] of this.typesMap) {
      properties.push([type, options[name]]);
    }
    return properties;
  }
  get propertiesToUpdate() {
    const properties = [];
    const {
      _drawingOptions
    } = this;
    for (const [type, name] of this.constructor.typesMap) {
      properties.push([type, _drawingOptions[name]]);
    }
    return properties;
  }
  _updateProperty(type, name, value) {
    const options = this._drawingOptions;
    const savedValue = options[name];
    const setter = val => {
      options.updateProperty(name, val);
      const bbox = this._drawOutlines.updateProperty(name, val);
      if (bbox) {
        this.#updateBbox(bbox);
      }
      this.parent?.drawLayer.updateProperties(this._drawId, options.toSVGProperties());
      if (type === this.colorType) {
        this.onUpdatedColor();
      } else if (type === this.opacityType) {
        this.onUpdatedOpacity();
      }
    };
    this.addCommands({
      cmd: setter.bind(this, value),
      undo: setter.bind(this, savedValue),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type,
      overwriteIfSameType: true,
      keepUndo: true
    });
  }
  _updateColorAndOpacity(color, opacity, type = this.colorAndOpacityType) {
    const colorName = this.constructor.typesMap.get(this.colorType);
    const opacityName = this._opacityName;
    const options = this._drawingOptions;
    const savedColor = options[colorName];
    const savedOpacity = options[opacityName];
    const setter = (c, op) => {
      options.updateProperty(colorName, c);
      options.updateProperty(opacityName, op);
      this._drawOutlines.updateProperty(colorName, c);
      this._drawOutlines.updateProperty(opacityName, op);
      this.parent?.drawLayer.updateProperties(this._drawId, options.toSVGProperties());
      this.onUpdatedColor();
      this.onUpdatedOpacity();
    };
    this.addCommands({
      cmd: setter.bind(this, color, opacity),
      undo: setter.bind(this, savedColor, savedOpacity),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type,
      overwriteIfSameType: true,
      keepUndo: true
    });
  }
  _onResizing() {
    this.parent?.drawLayer.updateProperties(this._drawId, DrawingEditor._mergeSVGProperties(this._drawOutlines.getPathResizingSVGProperties(this.#convertToDrawSpace()), {
      bbox: this.#rotateBox()
    }));
  }
  _onResized() {
    this.parent?.drawLayer.updateProperties(this._drawId, DrawingEditor._mergeSVGProperties(this._drawOutlines.getPathResizedSVGProperties(this.#convertToDrawSpace()), {
      bbox: this.#rotateBox()
    }));
    this.#updateFocusOutline();
  }
  _onTranslating(_x, _y) {
    this.parent?.drawLayer.updateProperties(this._drawId, {
      bbox: this.#rotateBox()
    });
  }
  _onTranslated() {
    this.parent?.drawLayer.updateProperties(this._drawId, DrawingEditor._mergeSVGProperties(this._drawOutlines.getPathTranslatedSVGProperties(this.#convertToDrawSpace(), this.parentDimensions), {
      bbox: this.#rotateBox()
    }));
  }
  _onStartDragging() {
    this.parent?.drawLayer.updateProperties(this._drawId, {
      rootClass: {
        moving: true
      }
    });
  }
  _onStopDragging() {
    this.parent?.drawLayer.updateProperties(this._drawId, {
      rootClass: {
        moving: false
      }
    });
  }
  get _mustBeDisabledOnCommit() {
    return true;
  }
  commit() {
    super.commit();
    if (this._mustBeDisabledOnCommit) {
      this.disableEditMode();
      this.disableEditing();
    }
  }
  disableEditing() {
    super.disableEditing();
    this.div.classList.toggle("disabled", true);
  }
  enableEditing() {
    super.enableEditing();
    this.div.classList.toggle("disabled", false);
  }
  getBaseTranslation() {
    return [0, 0];
  }
  get isResizable() {
    return true;
  }
  onceAdded(focus) {
    if (!this.annotationElementId && this._drawId !== null) {
      this.parent.addUndoableEditor(this);
    }
    this._isDraggable = true;
    if (this.#mustBeCommitted) {
      this.#mustBeCommitted = false;
      this.commit();
      this.parent.setSelected(this);
      if (focus && this.isOnScreen) {
        this.div.focus();
      }
    }
  }
  remove() {
    this._uiManager.removeShouldRescale(this);
    this.#cleanDrawLayer();
    super.remove();
  }
  rebuild() {
    if (!this.parent) {
      return;
    }
    super.rebuild();
    if (this.div === null) {
      return;
    }
    this.#addToDrawLayer();
    this.#updateBbox(this._drawOutlines.box);
    if (!this.isAttachedToDOM) {
      this.parent.add(this);
    }
  }
  setParent(parent) {
    let mustBeSelected = false;
    if (this.parent && !parent) {
      this._uiManager.removeShouldRescale(this);
      this.#cleanDrawLayer();
    } else if (parent) {
      this._uiManager.addShouldRescale(this);
      this.#addToDrawLayer(parent);
      mustBeSelected = !this.parent && this.div?.classList.contains("selectedEditor");
    }
    super.setParent(parent);
    this.#updateVisibility();
    if (mustBeSelected) {
      this.select();
    }
  }
  #cleanDrawLayer() {
    if (this._drawId === null || !this.parent) {
      return;
    }
    const {
      drawLayer
    } = this.parent;
    drawLayer.remove(this._drawId);
    this._drawId = null;
    if (this._focusDrawId !== null) {
      drawLayer.remove(this._focusDrawId);
      this._focusDrawId = null;
    }
    this._drawingOptions.reset();
  }
  #addToDrawLayer(parent = this.parent) {
    if (this._drawId !== null && this.parent === parent) {
      return;
    }
    if (this._drawId !== null) {
      const {
        drawLayer
      } = this.parent;
      drawLayer.updateParent(this._drawId, parent.drawLayer);
      if (this._focusDrawId !== null) {
        drawLayer.updateParent(this._focusDrawId, parent.drawLayer);
      }
      return;
    }
    this._drawingOptions.updateAll();
    this._drawId = this.#createDrawing(this._drawOutlines, parent);
    if (this._clipPathId && this.#internalDiv) {
      this.#internalDiv.style.clipPath = this._clipPathId;
    }
  }
  #convertToParentSpace([x, y, width, height]) {
    const {
      parentDimensions: [pW, pH],
      _drawRotation: rotation
    } = this;
    switch (rotation) {
      case 90:
        return [y, 1 - x, width * (pH / pW), height * (pW / pH)];
      case 180:
        return [1 - x, 1 - y, width, height];
      case 270:
        return [1 - y, x, width * (pH / pW), height * (pW / pH)];
      default:
        return [x, y, width, height];
    }
  }
  #convertToDrawSpace() {
    const {
      x,
      y,
      width,
      height,
      parentDimensions: [pW, pH],
      _drawRotation: rotation
    } = this;
    switch (rotation) {
      case 90:
        return [1 - y, x, width * (pW / pH), height * (pH / pW)];
      case 180:
        return [1 - x, 1 - y, width, height];
      case 270:
        return [y, 1 - x, width * (pW / pH), height * (pH / pW)];
      default:
        return [x, y, width, height];
    }
  }
  #updateBbox(bbox) {
    [this.x, this.y, this.width, this.height] = this.#convertToParentSpace(bbox);
    if (this.div) {
      this.fixAndSetPosition();
      this.setDims();
    }
    this._onResized();
  }
  #rotateBox(parentRotation = this.parentRotation) {
    const {
      x,
      y,
      width,
      height,
      _drawRotation: rotation,
      parentDimensions: [pW, pH]
    } = this;
    switch ((rotation * 4 + parentRotation) / 90) {
      case 1:
        return [1 - y - height, x, height, width];
      case 2:
        return [1 - x - width, 1 - y - height, width, height];
      case 3:
        return [y, 1 - x - width, height, width];
      case 4:
        return [x, y - width * (pW / pH), height * (pH / pW), width * (pW / pH)];
      case 5:
        return [1 - y, x, width * (pW / pH), height * (pH / pW)];
      case 6:
        return [1 - x - height * (pH / pW), 1 - y, height * (pH / pW), width * (pW / pH)];
      case 7:
        return [y - width * (pW / pH), 1 - x - height * (pH / pW), width * (pW / pH), height * (pH / pW)];
      case 8:
        return [x - width, y - height, width, height];
      case 9:
        return [1 - y, x - width, height, width];
      case 10:
        return [1 - x, 1 - y, width, height];
      case 11:
        return [y - height, 1 - x, height, width];
      case 12:
        return [x - height * (pH / pW), y, height * (pH / pW), width * (pW / pH)];
      case 13:
        return [1 - y - width * (pW / pH), x - height * (pH / pW), width * (pW / pH), height * (pH / pW)];
      case 14:
        return [1 - x, 1 - y - width * (pW / pH), height * (pH / pW), width * (pW / pH)];
      case 15:
        return [y, 1 - x, width * (pW / pH), height * (pH / pW)];
      default:
        return [x, y, width, height];
    }
  }
  rotate(parentRotation = this.parentRotation) {
    if (!this.parent || this._drawId === null) {
      return;
    }
    const angle = (parentRotation - this._drawRotation + 360) % 360;
    this.parent.drawLayer.updateProperties(this._drawId, DrawingEditor._mergeSVGProperties({
      bbox: this.#rotateBox(parentRotation)
    }, this._drawOutlines.updateRotation(angle)));
    this.#updateFocusOutline(angle);
  }
  show(visible = this._isVisible) {
    super.show(visible);
    this.#updateVisibility();
  }
  select() {
    super.select();
    this.#toggleFocusOutlineClass({
      hovered: false,
      selected: true
    });
  }
  unselect() {
    super.unselect();
    this.#toggleFocusOutlineClass({
      selected: false
    });
  }
  pointerover() {
    if (!this.isSelected) {
      this.#toggleFocusOutlineClass({
        hovered: true
      });
    }
  }
  pointerleave() {
    if (!this.isSelected) {
      this.#toggleFocusOutlineClass({
        hovered: false
      });
    }
  }
  onScaleChanging() {
    if (!this.parent) {
      return;
    }
    const bbox = this._drawOutlines.updateParentDimensions(this.parentDimensions, this.parent.scale);
    if (bbox) {
      this.#updateBbox(bbox);
    }
  }
  static onScaleChangingWhenDrawing() {}
  render() {
    if (this.div) {
      return this.div;
    }
    let baseX, baseY;
    if (this._isCopy) {
      baseX = this.x;
      baseY = this.y;
    }
    const div = super.render();
    if (this.constructor._hasDrawClass) {
      div.classList.add("draw");
    }
    const drawDiv = this.#internalDiv = document.createElement("div");
    div.append(drawDiv);
    drawDiv.setAttribute("aria-hidden", "true");
    drawDiv.className = "internal";
    if (this._clipPathId) {
      drawDiv.style.clipPath = this._clipPathId;
    }
    bindEvents(this, drawDiv, ["pointerover", "pointerleave"]);
    this.setDims();
    this._uiManager.addShouldRescale(this);
    this.disableEditing();
    if (this._isCopy) {
      this._moveAfterPaste(baseX, baseY);
    }
    return div;
  }
  static createDrawerInstance(_params) {
    unreachable("Not implemented");
  }
  static _getDrawingTarget(_parent, {
    target
  }) {
    return target;
  }
  static _getPointerCoords({
    offsetX,
    offsetY,
    clientX,
    clientY
  }, referenceEvent = null) {
    if (!referenceEvent) {
      return [offsetX, offsetY];
    }
    let deltaX = clientX - referenceEvent.clientX;
    let deltaY = clientY - referenceEvent.clientY;
    switch (this._currentParent.viewport.rotation) {
      case 90:
        [deltaX, deltaY] = [deltaY, -deltaX];
        break;
      case 180:
        [deltaX, deltaY] = [-deltaX, -deltaY];
        break;
      case 270:
        [deltaX, deltaY] = [-deltaY, deltaX];
        break;
    }
    return [referenceEvent.offsetX + deltaX, referenceEvent.offsetY + deltaY];
  }
  static _addDrawingListeners(_target, _signal) {}
  static _endDrawingSession(isAborted = false) {
    return this._currentParent.endDrawingSession(isAborted);
  }
  static startDrawing(parent, uiManager, isLTR, event) {
    const {
      pointerId,
      pointerType
    } = event;
    if (CurrentPointers.isInitializedAndDifferentPointerType(pointerType)) {
      return;
    }
    const target = this._getDrawingTarget(parent, event);
    const [x, y] = this._getPointerCoords(event);
    const {
      viewport: {
        rotation
      }
    } = parent;
    const {
      x: boxX,
      y: boxY,
      width: parentWidth,
      height: parentHeight
    } = target.getBoundingClientRect();
    const ac = DrawingEditor.#currentDrawingAC = new AbortController();
    const signal = parent.combinedSignal(ac);
    CurrentPointers.setPointer(pointerType, pointerId);
    window.addEventListener("pointerup", e => {
      if (CurrentPointers.isSamePointerIdOrRemove(e.pointerId)) {
        this._endDraw(e);
      }
    }, {
      signal
    });
    window.addEventListener("pointercancel", e => {
      if (CurrentPointers.isSamePointerIdOrRemove(e.pointerId)) {
        this._endDrawingSession();
      }
    }, {
      signal
    });
    window.addEventListener("pointerdown", e => {
      if (!CurrentPointers.isSamePointerType(e.pointerType)) {
        return;
      }
      CurrentPointers.initializeAndAddPointerId(e.pointerId);
      if (DrawingEditor.#currentDraw.isCancellable()) {
        DrawingEditor.#currentDraw.removeLastElement();
        if (DrawingEditor.#currentDraw.isEmpty()) {
          this._endDrawingSession(true);
        } else {
          this._endDraw(null);
        }
      }
    }, {
      capture: true,
      passive: false,
      signal
    });
    window.addEventListener("contextmenu", noContextMenu, {
      signal
    });
    target.addEventListener("pointermove", this._drawMove.bind(this), {
      signal
    });
    target.addEventListener("touchmove", e => {
      if (CurrentPointers.isSameTimeStamp(e.timeStamp)) {
        stopEvent(e);
      }
    }, {
      signal
    });
    this._addDrawingListeners(target, signal);
    parent.toggleDrawing();
    uiManager._editorUndoBar?.hide();
    if (DrawingEditor.#currentDraw) {
      parent.drawLayer.updateProperties(this._currentDrawId, DrawingEditor.#currentDraw.startNew(x, y, parentWidth, parentHeight, rotation, event.timeStamp));
      return;
    }
    uiManager.updateUIForDefaultProperties(this);
    DrawingEditor.#currentDraw = this.createDrawerInstance({
      x,
      y,
      box: [boxX, boxY, parentWidth, parentHeight],
      rotation,
      parent,
      isLTR,
      timeStamp: event.timeStamp
    });
    DrawingEditor.#currentDrawingOptions = this.getDefaultDrawingOptions();
    this._currentParent = parent;
    const {
      id,
      clipPathId
    } = parent.drawLayer.draw(this._mergeSVGProperties(DrawingEditor.#currentDrawingOptions.toSVGProperties(), DrawingEditor.#currentDraw.defaultSVGProperties), true, this._hasClipPath);
    this._currentDrawId = id;
    DrawingEditor.#currentClipPathId = this._hasClipPath ? clipPathId : null;
  }
  static _drawMove(event) {
    CurrentPointers.isSameTimeStamp(event.timeStamp);
    if (!DrawingEditor.#currentDraw || !CurrentPointers.isSamePointerId(event.pointerId)) {
      return;
    }
    if (CurrentPointers.isUsingMultiplePointers()) {
      this._endDraw(event);
      return;
    }
    let properties;
    const coalesced = event.getCoalescedEvents?.();
    if (coalesced?.length) {
      const points = [];
      const timeStamps = [];
      for (const sample of coalesced) {
        points.push(...this._getPointerCoords(sample, event));
        timeStamps.push(sample.timeStamp);
      }
      properties = DrawingEditor.#currentDraw.addPoints(points, timeStamps);
    } else {
      properties = DrawingEditor.#currentDraw.add(...this._getPointerCoords(event), event.timeStamp);
    }
    this._currentParent.drawLayer.updateProperties(this._currentDrawId, properties);
    CurrentPointers.setTimeStamp(event.timeStamp);
    stopEvent(event);
  }
  static _cleanup(all) {
    if (all) {
      this._currentDrawId = -1;
      this._currentParent = null;
      DrawingEditor.#currentDraw = null;
      DrawingEditor.#currentDrawingOptions = null;
      DrawingEditor.#currentClipPathId = null;
      CurrentPointers.clearTimeStamp();
    }
    if (DrawingEditor.#currentDrawingAC) {
      DrawingEditor.#currentDrawingAC.abort();
      DrawingEditor.#currentDrawingAC = null;
      CurrentPointers.clearPointerIds();
    }
  }
  static _endDraw(event) {
    const parent = this._currentParent;
    if (!parent) {
      return;
    }
    parent.toggleDrawing(true);
    this._cleanup(false);
    parent.drawLayer.updateProperties(this._currentDrawId, event?.target === parent.div ? DrawingEditor.#currentDraw.end(...this._getPointerCoords(event), event.timeStamp) : DrawingEditor.#currentDraw.end());
    if (this.supportMultipleDrawings) {
      const draw = DrawingEditor.#currentDraw;
      const drawId = this._currentDrawId;
      const lastElement = draw.getLastElement();
      parent.addCommands({
        cmd: () => {
          parent.drawLayer.updateProperties(drawId, draw.setLastElement(lastElement));
        },
        undo: () => {
          parent.drawLayer.updateProperties(drawId, draw.removeLastElement());
        },
        mustExec: false,
        type: AnnotationEditorParamsType.DRAW_STEP
      });
      return;
    }
    this.endDrawing(false);
  }
  static endDrawing(isAborted) {
    const parent = this._currentParent;
    if (!parent) {
      return null;
    }
    parent.toggleDrawing(true);
    parent.cleanUndoStack(AnnotationEditorParamsType.DRAW_STEP);
    if (!DrawingEditor.#currentDraw.isEmpty()) {
      const {
        pageDimensions: [pageWidth, pageHeight],
        scale
      } = parent;
      const editor = parent.createAndAddNewEditor({
        offsetX: 0,
        offsetY: 0
      }, false, {
        drawId: this._currentDrawId,
        clipPathId: DrawingEditor.#currentClipPathId,
        drawOutlines: DrawingEditor.#currentDraw.getOutlines(pageWidth * scale, pageHeight * scale, scale, this._INNER_MARGIN),
        drawingOptions: DrawingEditor.#currentDrawingOptions,
        mustBeCommitted: !isAborted
      });
      this._cleanup(true);
      return editor;
    }
    parent.drawLayer.remove(this._currentDrawId);
    this._cleanup(true);
    return null;
  }
  createDrawingOptions(_data) {}
  static deserializeDraw(_pageX, _pageY, _pageWidth, _pageHeight, _innerMargin, _data, _uiManager) {
    unreachable("Not implemented");
  }
  static async deserialize(data, parent, uiManager) {
    const {
      rawDims: {
        pageWidth,
        pageHeight,
        pageX,
        pageY
      }
    } = parent.viewport;
    const drawOutlines = this.deserializeDraw(pageX, pageY, pageWidth, pageHeight, this._INNER_MARGIN, data, uiManager);
    const editor = await super.deserialize(data, parent, uiManager);
    editor.createDrawingOptions(data);
    editor.#createDrawOutlines({
      drawOutlines
    });
    editor.#addToDrawLayer();
    editor.onScaleChanging();
    editor.rotate();
    return editor;
  }
  serializeDraw(isForCopying) {
    const [pageX, pageY] = this.pageTranslation;
    const [pageWidth, pageHeight] = this.pageDimensions;
    return this._drawOutlines.serialize([pageX, pageY, pageWidth, pageHeight], isForCopying);
  }
  renderAnnotationElement(annotation) {
    annotation.updateEdited({
      rect: this.getPDFRect()
    });
    return null;
  }
  static canCreateNewEmptyEditor() {
    return false;
  }
}
export { DrawingEditor, DrawingOptions };