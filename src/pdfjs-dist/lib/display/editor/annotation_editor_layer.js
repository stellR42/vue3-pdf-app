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
import { AnnotationEditorPrefix, AnnotationEditorType, FeatureTest } from "../../shared/util.js";
import { setLayerDimensions, stopEvent } from "../dom_utils.js";
import { AnnotationEditor } from "./editor.js";
import { FreeTextEditor } from "./freetext.js";
import { HighlightEditor } from "./highlight.js";
import { InkEditor } from "./ink.js";
import { SignatureEditor } from "./signature.js";
import { StampEditor } from "./stamp.js";
class AnnotationEditorLayer {
  #accessibilityManager;
  #allowClick = false;
  #annotationLayer = null;
  #clickAC = null;
  #editorFocusTimeoutId = null;
  #editors = new Map();
  #hadPointerDown = false;
  #isDisabling = false;
  #isEnabling = false;
  #drawingAC = null;
  #focusedElement = null;
  #textLayer = null;
  #textSelectionAC = null;
  #textLayerDblClickAC = null;
  #lastPointerDownTimestamp = -1;
  #uiManager;
  static _initialized = false;
  static #editorTypes = new Map([FreeTextEditor, InkEditor, StampEditor, HighlightEditor, SignatureEditor].map(type => [type._editorType, type]));
  constructor({
    uiManager,
    pageIndex,
    div,
    structTreeLayer,
    accessibilityManager,
    annotationLayer,
    drawLayer,
    textLayer,
    viewport,
    l10n
  }) {
    const editorTypes = [...AnnotationEditorLayer.#editorTypes.values()];
    if (!AnnotationEditorLayer._initialized) {
      AnnotationEditorLayer._initialized = true;
      for (const editorType of editorTypes) {
        editorType.initialize(l10n, uiManager);
      }
    }
    uiManager.registerEditorTypes(editorTypes);
    this.#uiManager = uiManager;
    this.pageIndex = pageIndex;
    this.div = div;
    this.#accessibilityManager = accessibilityManager;
    this.#annotationLayer = annotationLayer;
    this.viewport = viewport;
    this.#textLayer = textLayer;
    this.drawLayer = drawLayer;
    this._structTree = structTreeLayer;
    this.#uiManager.addLayer(this);
  }
  get isEmpty() {
    return this.#editors.size === 0;
  }
  get isInvisible() {
    return this.isEmpty && this.#uiManager.getMode() === AnnotationEditorType.NONE;
  }
  updateToolbar(options) {
    this.#uiManager.updateToolbar(options);
  }
  updateMode(mode = this.#uiManager.getMode()) {
    this.#cleanup();
    switch (mode) {
      case AnnotationEditorType.NONE:
        this.div.classList.toggle("nonEditing", true);
        this.disableTextSelection();
        this.togglePointerEvents(false);
        this.toggleAnnotationLayerPointerEvents(true);
        this.disableClick();
        return;
      case AnnotationEditorType.INK:
        this.disableTextSelection();
        this.togglePointerEvents(true);
        this.enableClick();
        break;
      case AnnotationEditorType.HIGHLIGHT:
        this.enableTextSelection();
        this.togglePointerEvents(false);
        this.disableClick();
        break;
      default:
        this.disableTextSelection();
        this.togglePointerEvents(true);
        this.enableClick();
    }
    this.toggleAnnotationLayerPointerEvents(false);
    const {
      classList
    } = this.div;
    classList.toggle("nonEditing", false);
    if (mode === AnnotationEditorType.POPUP) {
      classList.toggle("commentEditing", true);
    } else {
      classList.toggle("commentEditing", false);
      for (const editorType of AnnotationEditorLayer.#editorTypes.values()) {
        classList.toggle(`${editorType._type}Editing`, mode === editorType._editorType);
      }
    }
    this.div.hidden = false;
  }
  hasTextLayer(textLayer) {
    return textLayer === this.#textLayer?.div;
  }
  setEditingState(isEditing) {
    this.#uiManager.setEditingState(isEditing);
  }
  addCommands(params) {
    this.#uiManager.addCommands(params);
  }
  cleanUndoStack(type) {
    this.#uiManager.cleanUndoStack(type);
  }
  toggleDrawing(enabled = false) {
    this.div.classList.toggle("drawing", !enabled);
  }
  togglePointerEvents(enabled = false) {
    this.div.classList.toggle("disabled", !enabled);
  }
  toggleAnnotationLayerPointerEvents(enabled = false) {
    this.#annotationLayer?.togglePointerEvents(enabled);
  }
  get #allEditorsIterator() {
    return this.#editors.size !== 0 ? this.#editors.values() : this.#uiManager.getEditors(this.pageIndex);
  }
  async enable() {
    this.#isEnabling = true;
    this.div.tabIndex = 0;
    this.togglePointerEvents(true);
    this.div.classList.toggle("nonEditing", false);
    this.#textLayerDblClickAC?.abort();
    this.#textLayerDblClickAC = null;
    const annotationElementIds = new Set();
    for (const editor of this.#allEditorsIterator) {
      editor.enableEditing();
      editor.show(true);
      if (editor.annotationElementId) {
        this.#uiManager.removeChangedExistingAnnotation(editor);
        annotationElementIds.add(editor.annotationElementId);
      }
    }
    const annotationLayer = this.#annotationLayer;
    if (annotationLayer) {
      for (const editable of annotationLayer.getEditableAnnotations()) {
        editable.hide();
        if (this.#uiManager.isDeletedAnnotationElement(editable.data.id) || annotationElementIds.has(editable.data.id)) {
          continue;
        }
        const editor = await this.deserialize(editable);
        if (!editor) {
          continue;
        }
        this.addOrRebuild(editor);
        editor.enableEditing();
      }
    }
    this.#isEnabling = false;
    this.#uiManager._eventBus.dispatch("editorsrendered", {
      source: this,
      pageNumber: this.pageIndex + 1
    });
  }
  disable() {
    this.#isDisabling = true;
    this.div.tabIndex = -1;
    this.togglePointerEvents(false);
    this.div.classList.toggle("nonEditing", true);
    if (this.#textLayer && !this.#textLayerDblClickAC) {
      this.#textLayerDblClickAC = new AbortController();
      const signal = this.#uiManager.combinedSignal(this.#textLayerDblClickAC);
      this.#textLayer.div.addEventListener("pointerdown", e => {
        const DBL_CLICK_THRESHOLD = 500;
        const {
          clientX,
          clientY,
          timeStamp
        } = e;
        const lastPointerDownTimestamp = this.#lastPointerDownTimestamp;
        if (timeStamp - lastPointerDownTimestamp > DBL_CLICK_THRESHOLD) {
          this.#lastPointerDownTimestamp = timeStamp;
          return;
        }
        this.#lastPointerDownTimestamp = -1;
        const {
          classList
        } = this.div;
        classList.toggle("getElements", true);
        const elements = document.elementsFromPoint(clientX, clientY);
        classList.toggle("getElements", false);
        if (!this.div.contains(elements[0])) {
          return;
        }
        let id;
        const regex = new RegExp(`^${AnnotationEditorPrefix}[0-9]+$`);
        for (const element of elements) {
          if (regex.test(element.id)) {
            id = element.id;
            break;
          }
        }
        if (!id) {
          return;
        }
        const editor = this.#editors.get(id);
        if (editor?.annotationElementId === null) {
          stopEvent(e);
          editor.dblclick(e);
        }
      }, {
        signal,
        capture: true
      });
    }
    const annotationLayer = this.#annotationLayer;
    const needFakeAnnotation = [];
    if (annotationLayer) {
      const changedAnnotations = new Map();
      const resetAnnotations = new Map();
      for (const editor of this.#allEditorsIterator) {
        editor.disableEditing();
        if (!editor.annotationElementId) {
          needFakeAnnotation.push(editor);
          continue;
        }
        if (editor.serialize() !== null) {
          changedAnnotations.set(editor.annotationElementId, editor);
          continue;
        } else {
          resetAnnotations.set(editor.annotationElementId, editor);
        }
        this.getEditableAnnotation(editor.annotationElementId)?.show();
        editor.remove();
      }
      for (const editable of annotationLayer.getEditableAnnotations()) {
        const {
          id
        } = editable.data;
        if (this.#uiManager.isDeletedAnnotationElement(id)) {
          editable.updateEdited({
            deleted: true
          });
          continue;
        }
        let editor = resetAnnotations.get(id);
        if (editor) {
          editor.resetAnnotationElement(editable);
          editor.show(false);
          editable.show();
          continue;
        }
        editor = changedAnnotations.get(id);
        if (editor) {
          this.#uiManager.addChangedExistingAnnotation(editor);
          if (editor.renderAnnotationElement(editable)) {
            editor.show(false);
          }
        }
        editable.show();
      }
    }
    this.#cleanup();
    if (this.isEmpty) {
      this.div.hidden = true;
    }
    const {
      classList
    } = this.div;
    for (const editorType of AnnotationEditorLayer.#editorTypes.values()) {
      classList.remove(`${editorType._type}Editing`);
    }
    this.disableTextSelection();
    this.toggleAnnotationLayerPointerEvents(true);
    annotationLayer?.updateFakeAnnotations(needFakeAnnotation);
    this.#isDisabling = false;
  }
  getEditableAnnotation(id) {
    return this.#annotationLayer?.getEditableAnnotation(id) || null;
  }
  setActiveEditor(editor) {
    const currentActive = this.#uiManager.getActive();
    if (currentActive === editor) {
      return;
    }
    this.#uiManager.setActiveEditor(editor);
  }
  enableTextSelection() {
    this.div.tabIndex = -1;
    if (this.#textLayer?.div && !this.#textSelectionAC) {
      this.#textSelectionAC = new AbortController();
      const signal = this.#uiManager.combinedSignal(this.#textSelectionAC);
      this.#textLayer.div.addEventListener("pointerdown", this.#textLayerPointerDown.bind(this), {
        signal
      });
      this.#textLayer.div.classList.add("highlighting");
    }
  }
  disableTextSelection() {
    this.div.tabIndex = 0;
    if (this.#textLayer?.div && this.#textSelectionAC) {
      this.#textSelectionAC.abort();
      this.#textSelectionAC = null;
      this.#textLayer.div.classList.remove("highlighting");
    }
  }
  #textLayerPointerDown(event) {
    this.#uiManager.unselectAll();
    const {
      target
    } = event;
    if (target === this.#textLayer.div || (target.getAttribute("role") === "img" || target.classList.contains("endOfContent") || target.classList.contains("textLayerImages") || target.classList.contains("textLayerImagePlaceholder")) && this.#textLayer.div.contains(target)) {
      const {
        isMac
      } = FeatureTest.platform;
      if (event.button !== 0 || event.ctrlKey && isMac) {
        return;
      }
      this.#uiManager.showAllEditors("highlight", true, true);
      HighlightEditor.startDrawing(this, this.#uiManager, this.#uiManager.direction === "ltr", event);
      event.preventDefault();
    }
  }
  enableClick() {
    if (this.#clickAC) {
      return;
    }
    this.#clickAC = new AbortController();
    const signal = this.#uiManager.combinedSignal(this.#clickAC);
    this.div.addEventListener("pointerdown", this.pointerdown.bind(this), {
      signal
    });
    const pointerup = this.pointerup.bind(this);
    this.div.addEventListener("pointerup", pointerup, {
      signal
    });
    this.div.addEventListener("pointercancel", pointerup, {
      signal
    });
  }
  disableClick() {
    this.#clickAC?.abort();
    this.#clickAC = null;
  }
  attach(editor) {
    this.#editors.set(editor.id, editor);
    const {
      annotationElementId
    } = editor;
    if (annotationElementId && this.#uiManager.isDeletedAnnotationElement(annotationElementId)) {
      this.#uiManager.removeDeletedAnnotationElement(editor);
    }
  }
  detach(editor) {
    this.#editors.delete(editor.id);
    this.#accessibilityManager?.removePointerInTextLayer(editor.contentDiv);
    if (!this.#isDisabling && editor.annotationElementId) {
      this.#uiManager.addDeletedAnnotationElement(editor);
    }
  }
  remove(editor) {
    this.detach(editor);
    this.#uiManager.removeEditor(editor);
    editor.div.remove();
    editor.isAttachedToDOM = false;
  }
  changeParent(editor) {
    if (editor.parent === this) {
      return;
    }
    if (editor.parent && editor.annotationElementId) {
      this.#uiManager.addDeletedAnnotationElement(editor);
      AnnotationEditor.deleteAnnotationElement(editor);
      editor.annotationElementId = null;
    }
    this.attach(editor);
    editor.parent?.detach(editor);
    editor.setParent(this);
    if (editor.div && editor.isAttachedToDOM) {
      editor.div.remove();
      this.div.append(editor.div);
    }
  }
  add(editor) {
    if (editor.parent === this && editor.isAttachedToDOM) {
      return;
    }
    this.changeParent(editor);
    this.#uiManager.addEditor(editor);
    this.attach(editor);
    if (!editor.isAttachedToDOM) {
      const div = editor.render();
      this.div.append(div);
      editor.isAttachedToDOM = true;
    }
    editor.fixAndSetPosition();
    editor.onceAdded(!this.#isEnabling);
    this.#uiManager.addToAnnotationStorage(editor);
    editor._reportTelemetry(editor.telemetryInitialData);
  }
  moveEditorInDOM(editor) {
    if (!editor.isAttachedToDOM) {
      return;
    }
    const {
      activeElement
    } = document;
    if (editor.div.contains(activeElement) && !this.#editorFocusTimeoutId) {
      editor._focusEventsAllowed = false;
      this.#editorFocusTimeoutId = setTimeout(() => {
        this.#editorFocusTimeoutId = null;
        if (!editor.div.contains(document.activeElement)) {
          editor.div.addEventListener("focusin", () => {
            editor._focusEventsAllowed = true;
          }, {
            once: true,
            signal: this.#uiManager._signal
          });
          activeElement.focus();
        } else {
          editor._focusEventsAllowed = true;
        }
      }, 0);
    }
    editor._structTreeParentId = this.#accessibilityManager?.moveElementInDOM(this.div, editor.div, editor.contentDiv, true);
  }
  addOrRebuild(editor) {
    if (editor.needsToBeRebuilt()) {
      editor.parent ||= this;
      editor.rebuild();
      editor.show();
    } else {
      this.add(editor);
    }
  }
  addUndoableEditor(editor) {
    const cmd = () => editor._uiManager.rebuild(editor);
    const undo = () => {
      editor.remove();
    };
    this.addCommands({
      cmd,
      undo,
      mustExec: false
    });
  }
  getEditorByUID(uid) {
    for (const editor of this.#editors.values()) {
      if (editor.uid === uid) {
        return editor;
      }
    }
    return null;
  }
  get #currentEditorType() {
    return AnnotationEditorLayer.#editorTypes.get(this.#uiManager.getMode());
  }
  combinedSignal(ac) {
    return this.#uiManager.combinedSignal(ac);
  }
  #createNewEditor(params) {
    const editorType = this.#currentEditorType;
    return editorType ? new editorType.prototype.constructor(params) : null;
  }
  canCreateNewEmptyEditor() {
    return this.#currentEditorType?.canCreateNewEmptyEditor();
  }
  async pasteEditor(options, params) {
    this.updateToolbar(options);
    await this.#uiManager.updateMode(options.mode);
    const {
      offsetX,
      offsetY
    } = this.#getCenterPoint();
    const id = this.#uiManager.getId();
    const editor = this.#createNewEditor({
      parent: this,
      id,
      x: offsetX,
      y: offsetY,
      uiManager: this.#uiManager,
      isCentered: true,
      ...params
    });
    if (editor) {
      this.add(editor);
    }
  }
  async deserialize(data) {
    return (await AnnotationEditorLayer.#editorTypes.get(data.annotationType ?? data.annotationEditorType)?.deserialize(data, this, this.#uiManager)) || null;
  }
  createAndAddNewEditor(event, isCentered, data = {}) {
    const id = this.#uiManager.getId();
    const editor = this.#createNewEditor({
      parent: this,
      id,
      x: event.offsetX,
      y: event.offsetY,
      uiManager: this.#uiManager,
      isCentered,
      ...data
    });
    if (editor) {
      this.add(editor);
    }
    return editor;
  }
  get boundingClientRect() {
    return this.div.getBoundingClientRect();
  }
  #getCenterPoint() {
    const {
      x,
      y,
      width,
      height
    } = this.boundingClientRect;
    const tlX = Math.max(0, x);
    const tlY = Math.max(0, y);
    const brX = Math.min(window.innerWidth, x + width);
    const brY = Math.min(window.innerHeight, y + height);
    const centerX = (tlX + brX) / 2 - x;
    const centerY = (tlY + brY) / 2 - y;
    const [offsetX, offsetY] = this.viewport.rotation % 180 === 0 ? [centerX, centerY] : [centerY, centerX];
    return {
      offsetX,
      offsetY
    };
  }
  addNewEditor(data = {}) {
    this.createAndAddNewEditor(this.#getCenterPoint(), true, data);
  }
  setSelected(editor) {
    this.#uiManager.setSelected(editor);
  }
  toggleSelected(editor) {
    this.#uiManager.toggleSelected(editor);
  }
  unselect(editor) {
    this.#uiManager.unselect(editor);
  }
  pointerup(event) {
    const {
      isMac
    } = FeatureTest.platform;
    if (event.button !== 0 || event.ctrlKey && isMac) {
      return;
    }
    if (event.target !== this.div) {
      return;
    }
    if (!this.#hadPointerDown) {
      return;
    }
    this.#hadPointerDown = false;
    if (this.#currentEditorType?.isDrawer && this.#currentEditorType.supportMultipleDrawings) {
      return;
    }
    if (!this.#allowClick) {
      this.#allowClick = true;
      return;
    }
    const currentMode = this.#uiManager.getMode();
    if (currentMode === AnnotationEditorType.STAMP || currentMode === AnnotationEditorType.POPUP || currentMode === AnnotationEditorType.SIGNATURE) {
      this.#uiManager.unselectAll();
      return;
    }
    this.createAndAddNewEditor(event, false);
  }
  pointerdown(event) {
    if (this.#uiManager.getMode() === AnnotationEditorType.HIGHLIGHT) {
      this.enableTextSelection();
    }
    if (this.#hadPointerDown) {
      this.#hadPointerDown = false;
      return;
    }
    const {
      isMac
    } = FeatureTest.platform;
    if (event.button !== 0 || event.ctrlKey && isMac) {
      return;
    }
    if (event.target !== this.div) {
      return;
    }
    this.#hadPointerDown = true;
    if (this.#currentEditorType?.isDrawer) {
      this.startDrawingSession(event);
      return;
    }
    const editor = this.#uiManager.getActive();
    this.#allowClick = !editor || editor.isEmpty();
  }
  startDrawingSession(event) {
    this.div.focus({
      preventScroll: true
    });
    if (this.#drawingAC) {
      this.#currentEditorType.startDrawing(this, this.#uiManager, false, event);
      return;
    }
    this.#uiManager.setCurrentDrawingSession(this);
    this.#drawingAC = new AbortController();
    const signal = this.#uiManager.combinedSignal(this.#drawingAC);
    this.div.addEventListener("blur", ({
      relatedTarget
    }) => {
      if (relatedTarget && !this.div.contains(relatedTarget)) {
        this.#focusedElement = null;
        this.commitOrRemove();
      }
    }, {
      signal
    });
    this.#currentEditorType.startDrawing(this, this.#uiManager, false, event);
  }
  pause(on) {
    if (on) {
      const {
        activeElement
      } = document;
      if (this.div.contains(activeElement)) {
        this.#focusedElement = activeElement;
      }
      return;
    }
    if (this.#focusedElement) {
      setTimeout(() => {
        this.#focusedElement?.focus();
        this.#focusedElement = null;
      }, 0);
    }
  }
  endDrawingSession(isAborted = false) {
    if (!this.#drawingAC) {
      return null;
    }
    this.#uiManager.setCurrentDrawingSession(null);
    this.#drawingAC.abort();
    this.#drawingAC = null;
    this.#focusedElement = null;
    return this.#currentEditorType.endDrawing(isAborted);
  }
  findNewParent(editor, x, y) {
    const layer = this.#uiManager.findParent(x, y);
    if (layer === null || layer === this) {
      return false;
    }
    layer.changeParent(editor);
    return true;
  }
  commitOrRemove() {
    if (this.#drawingAC) {
      this.endDrawingSession();
      return true;
    }
    return false;
  }
  onScaleChanging() {
    if (!this.#drawingAC) {
      return;
    }
    this.#currentEditorType.onScaleChangingWhenDrawing(this);
  }
  destroy() {
    this.commitOrRemove();
    if (this.#uiManager.getActive()?.parent === this) {
      this.#uiManager.commitOrRemove();
      this.#uiManager.setActiveEditor(null);
    }
    if (this.#editorFocusTimeoutId) {
      clearTimeout(this.#editorFocusTimeoutId);
      this.#editorFocusTimeoutId = null;
    }
    for (const editor of this.#editors.values()) {
      this.#accessibilityManager?.removePointerInTextLayer(editor.contentDiv);
      editor.setParent(null);
      editor.isAttachedToDOM = false;
      editor.div.remove();
    }
    this.div = null;
    this.#editors.clear();
    this.#uiManager.removeLayer(this);
  }
  #cleanup() {
    for (const editor of this.#editors.values()) {
      if (editor.isEmpty()) {
        editor.remove();
      }
    }
  }
  async render({
    viewport
  }) {
    this.viewport = viewport;
    setLayerDimensions(this.div, viewport);
    for (const editor of this.#uiManager.getEditors(this.pageIndex)) {
      this.add(editor);
      editor.rebuild();
    }
    await this.#uiManager.findClonesForPage(this);
    this.div.hidden = this.isEmpty;
    this.updateMode();
  }
  update({
    viewport
  }) {
    this.#uiManager.commitOrRemove();
    this.#cleanup();
    const oldRotation = this.viewport.rotation;
    const rotation = viewport.rotation;
    this.viewport = viewport;
    setLayerDimensions(this.div, {
      rotation
    });
    if (oldRotation !== rotation) {
      for (const editor of this.#editors.values()) {
        editor.rotate(rotation);
      }
    }
  }
  get pageDimensions() {
    const {
      pageWidth,
      pageHeight
    } = this.viewport.rawDims;
    return [pageWidth, pageHeight];
  }
  get scale() {
    return this.#uiManager.viewParameters.realScale;
  }
}
export { AnnotationEditorLayer };