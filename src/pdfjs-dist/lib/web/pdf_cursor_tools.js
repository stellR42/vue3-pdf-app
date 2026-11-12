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
import { AnnotationEditorType, shadow } from "../pdf.js";
import { CursorTool, PresentationModeState } from "./ui_utils.js";
import { GrabToPan } from "./grab_to_pan.js";
import { internalOpt } from "./internal_evt.js";
class PDFCursorTools {
  #active = CursorTool.SELECT;
  #prevActive = null;
  constructor({
    container,
    eventBus,
    cursorToolOnLoad = CursorTool.SELECT
  }) {
    this.container = container;
    this.eventBus = eventBus;
    this.#addEventListeners();
    Promise.resolve().then(() => {
      this.switchTool(cursorToolOnLoad);
    });
  }
  get activeTool() {
    return this.#active;
  }
  switchTool(tool) {
    if (this.#prevActive !== null) {
      return;
    }
    this.#switchTool(tool);
  }
  #switchTool(tool, disabled = false) {
    if (tool === this.#active) {
      if (this.#prevActive !== null) {
        this.eventBus.dispatch("cursortoolchanged", {
          source: this,
          tool,
          disabled
        });
      }
      return;
    }
    const disableActiveTool = () => {
      switch (this.#active) {
        case CursorTool.SELECT:
          break;
        case CursorTool.HAND:
          this._handTool.deactivate();
          break;
        case CursorTool.ZOOM:
      }
    };
    switch (tool) {
      case CursorTool.SELECT:
        disableActiveTool();
        break;
      case CursorTool.HAND:
        disableActiveTool();
        this._handTool.activate();
        break;
      case CursorTool.ZOOM:
      default:
        console.error(`switchTool: "${tool}" is an unsupported value.`);
        return;
    }
    this.#active = tool;
    this.eventBus.dispatch("cursortoolchanged", {
      source: this,
      tool,
      disabled
    });
  }
  #addEventListeners() {
    const {
      eventBus
    } = this;
    eventBus.on("switchcursortool", evt => {
      if (!evt.reset) {
        this.switchTool(evt.tool);
      } else if (this.#prevActive !== null) {
        annotationEditorMode = AnnotationEditorType.NONE;
        presentationModeState = PresentationModeState.NORMAL;
        enableActive();
      }
    }, internalOpt);
    let annotationEditorMode = AnnotationEditorType.NONE,
      presentationModeState = PresentationModeState.NORMAL;
    const disableActive = () => {
      this.#prevActive ??= this.#active;
      this.#switchTool(CursorTool.SELECT, true);
    };
    const enableActive = () => {
      if (this.#prevActive !== null && annotationEditorMode === AnnotationEditorType.NONE && presentationModeState === PresentationModeState.NORMAL) {
        this.#switchTool(this.#prevActive);
        this.#prevActive = null;
      }
    };
    eventBus.on("annotationeditormodechanged", ({
      mode
    }) => {
      annotationEditorMode = mode;
      if (mode === AnnotationEditorType.NONE) {
        enableActive();
      } else {
        disableActive();
      }
    }, internalOpt);
    eventBus.on("presentationmodechanged", ({
      state
    }) => {
      presentationModeState = state;
      if (state === PresentationModeState.NORMAL) {
        enableActive();
      } else if (state === PresentationModeState.FULLSCREEN) {
        disableActive();
      }
    }, internalOpt);
  }
  get _handTool() {
    return shadow(this, "_handTool", new GrabToPan({
      element: this.container
    }));
  }
}
export { PDFCursorTools };