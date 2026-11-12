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
import "core-js/modules/es.json.stringify.js";
import { AnnotationEditorType, ColorPicker, noContextMenu } from "../pdf.js";
import { DEFAULT_SCALE, DEFAULT_SCALE_VALUE, MAX_SCALE, MIN_SCALE, toggleExpandedBtn } from "./ui_utils.js";
import { internalOpt } from "./internal_evt.js";
class Toolbar {
  #colorPicker = null;
  #opts;
  constructor(options, eventBus, toolbarDensity = 0) {
    this.#opts = options;
    this.eventBus = eventBus;
    const buttons = [{
      element: options.previous,
      eventName: "previouspage"
    }, {
      element: options.next,
      eventName: "nextpage"
    }, {
      element: options.zoomIn,
      eventName: "zoomin"
    }, {
      element: options.zoomOut,
      eventName: "zoomout"
    }, {
      element: options.print,
      eventName: "print"
    }, {
      element: options.download,
      eventName: "download"
    }, {
      element: options.editorCommentButton,
      eventName: "switchannotationeditormode",
      eventDetails: {
        get mode() {
          const {
            classList
          } = options.editorCommentButton;
          return classList.contains("toggled") ? AnnotationEditorType.NONE : AnnotationEditorType.POPUP;
        }
      }
    }, {
      element: options.editorFreeTextButton,
      eventName: "switchannotationeditormode",
      eventDetails: {
        get mode() {
          const {
            classList
          } = options.editorFreeTextButton;
          return classList.contains("toggled") ? AnnotationEditorType.NONE : AnnotationEditorType.FREETEXT;
        }
      }
    }, {
      element: options.editorHighlightButton,
      eventName: "switchannotationeditormode",
      eventDetails: {
        get mode() {
          const {
            classList
          } = options.editorHighlightButton;
          return classList.contains("toggled") ? AnnotationEditorType.NONE : AnnotationEditorType.HIGHLIGHT;
        }
      }
    }, {
      element: options.editorInkButton,
      eventName: "switchannotationeditormode",
      eventDetails: {
        get mode() {
          const {
            classList
          } = options.editorInkButton;
          return classList.contains("toggled") ? AnnotationEditorType.NONE : AnnotationEditorType.INK;
        }
      }
    }, {
      element: options.editorStampButton,
      eventName: "switchannotationeditormode",
      eventDetails: {
        get mode() {
          const {
            classList
          } = options.editorStampButton;
          return classList.contains("toggled") ? AnnotationEditorType.NONE : AnnotationEditorType.STAMP;
        }
      },
      telemetry: {
        type: "editing",
        data: {
          action: "pdfjs.image.icon_click"
        }
      }
    }, {
      element: options.editorSignatureButton,
      eventName: "switchannotationeditormode",
      eventDetails: {
        get mode() {
          const {
            classList
          } = options.editorSignatureButton;
          return classList.contains("toggled") ? AnnotationEditorType.NONE : AnnotationEditorType.SIGNATURE;
        }
      }
    }];
    this.#bindListeners(buttons);
    this.#updateToolbarDensity({
      value: toolbarDensity
    });
    this.reset();
  }
  #updateToolbarDensity({
    value
  }) {
    let name = "normal";
    switch (value) {
      case 1:
        name = "compact";
        break;
      case 2:
        name = "touch";
        break;
    }
    document.documentElement.setAttribute("data-toolbar-density", name);
  }
  setPageNumber(pageNumber, pageLabel) {
    this.pageNumber = pageNumber;
    this.pageLabel = pageLabel;
    this.#updateUIState(false);
  }
  setPagesCount(pagesCount, hasPageLabels) {
    this.pagesCount = pagesCount;
    this.hasPageLabels = hasPageLabels;
    this.#updateUIState(true);
  }
  setPageScale(pageScaleValue, pageScale) {
    this.pageScaleValue = (pageScaleValue || pageScale).toString();
    this.pageScale = pageScale;
    this.#updateUIState(false);
  }
  reset() {
    this.#colorPicker = null;
    this.pageNumber = 0;
    this.pageLabel = null;
    this.hasPageLabels = false;
    this.pagesCount = 0;
    this.pageScaleValue = DEFAULT_SCALE_VALUE;
    this.pageScale = DEFAULT_SCALE;
    this.#updateUIState(true);
    this.updateLoadingIndicatorState();
    this.#editorModeChanged({
      mode: AnnotationEditorType.DISABLE
    });
  }
  #bindListeners(buttons) {
    const {
      eventBus
    } = this;
    const {
      editorHighlightColorPicker,
      editorHighlightButton,
      pageNumber,
      scaleSelect
    } = this.#opts;
    const self = this;
    for (const {
      element,
      eventName,
      eventDetails,
      telemetry
    } of buttons) {
      element.addEventListener("click", evt => {
        if (eventName !== null) {
          eventBus.dispatch(eventName, {
            source: this,
            ...eventDetails,
            isFromKeyboard: evt.detail === 0
          });
        }
        if (telemetry) {
          eventBus.dispatch("reporttelemetry", {
            source: this,
            details: telemetry
          });
        }
      });
    }
    pageNumber.addEventListener("click", function () {
      this.select();
    });
    pageNumber.addEventListener("change", function () {
      eventBus.dispatch("pagenumberchanged", {
        source: self,
        value: this.value
      });
    });
    eventBus.on("pagesedited", ({
      pagesMapper
    }) => {
      const pagesCount = pagesMapper.pagesNumber;
      if (pagesCount !== this.pagesCount) {
        this.setPagesCount(pagesCount, this.hasPageLabels);
      }
    }, internalOpt);
    scaleSelect.addEventListener("change", function () {
      if (this.value === "custom") {
        return;
      }
      eventBus.dispatch("scalechanged", {
        source: self,
        value: this.value
      });
    });
    scaleSelect.addEventListener("click", function ({
      target
    }) {
      if (this.value === self.pageScaleValue && target.tagName.toUpperCase() === "OPTION") {
        this.blur();
      }
    });
    scaleSelect.oncontextmenu = noContextMenu;
    eventBus.on("annotationeditormodechanged", this.#editorModeChanged.bind(this), internalOpt);
    eventBus.on("showannotationeditorui", ({
      mode
    }) => {
      switch (mode) {
        case AnnotationEditorType.HIGHLIGHT:
          editorHighlightButton.click();
          break;
      }
    }, internalOpt);
    eventBus.on("toolbardensity", this.#updateToolbarDensity.bind(this), internalOpt);
    if (editorHighlightColorPicker) {
      eventBus.on("annotationeditoruimanager", ({
        uiManager
      }) => {
        const cp = this.#colorPicker = new ColorPicker({
          uiManager
        });
        uiManager.setMainHighlightColorPicker(cp);
        editorHighlightColorPicker.append(cp.renderMainDropdown());
      }, internalOpt);
      eventBus.on("mainhighlightcolorpickerupdatecolor", ({
        value
      }) => {
        this.#colorPicker?.update(value);
      }, internalOpt);
    }
  }
  #editorModeChanged({
    mode
  }) {
    const {
      editorCommentButton,
      editorCommentParamsToolbar,
      editorFreeTextButton,
      editorFreeTextParamsToolbar,
      editorHighlightButton,
      editorHighlightParamsToolbar,
      editorInkButton,
      editorInkParamsToolbar,
      editorStampButton,
      editorStampParamsToolbar,
      editorSignatureButton,
      editorSignatureParamsToolbar
    } = this.#opts;
    toggleExpandedBtn(editorCommentButton, mode === AnnotationEditorType.POPUP, editorCommentParamsToolbar);
    toggleExpandedBtn(editorFreeTextButton, mode === AnnotationEditorType.FREETEXT, editorFreeTextParamsToolbar);
    toggleExpandedBtn(editorHighlightButton, mode === AnnotationEditorType.HIGHLIGHT, editorHighlightParamsToolbar);
    toggleExpandedBtn(editorInkButton, mode === AnnotationEditorType.INK, editorInkParamsToolbar);
    toggleExpandedBtn(editorStampButton, mode === AnnotationEditorType.STAMP, editorStampParamsToolbar);
    toggleExpandedBtn(editorSignatureButton, mode === AnnotationEditorType.SIGNATURE, editorSignatureParamsToolbar);
    editorCommentButton.disabled = editorFreeTextButton.disabled = editorHighlightButton.disabled = editorInkButton.disabled = editorStampButton.disabled = editorSignatureButton.disabled = mode === AnnotationEditorType.DISABLE;
  }
  #updateUIState(resetNumPages = false) {
    const {
      pageNumber,
      pagesCount,
      pageScaleValue,
      pageScale
    } = this;
    const opts = this.#opts;
    if (resetNumPages) {
      if (this.hasPageLabels) {
        opts.pageNumber.type = "text";
        opts.numPages.setAttribute("data-l10n-id", "pdfjs-page-of-pages");
      } else {
        opts.pageNumber.type = "number";
        opts.numPages.setAttribute("data-l10n-id", "pdfjs-of-pages");
        opts.numPages.setAttribute("data-l10n-args", JSON.stringify({
          pagesCount
        }));
      }
      opts.pageNumber.max = pagesCount;
    }
    if (this.hasPageLabels) {
      opts.pageNumber.value = this.pageLabel;
      opts.numPages.setAttribute("data-l10n-args", JSON.stringify({
        pageNumber,
        pagesCount
      }));
    } else {
      opts.pageNumber.value = pageNumber;
    }
    opts.previous.disabled = pageNumber <= 1;
    opts.next.disabled = pageNumber >= pagesCount;
    opts.zoomOut.disabled = pageScale <= MIN_SCALE;
    opts.zoomIn.disabled = pageScale >= MAX_SCALE;
    let predefinedValueFound = false;
    for (const option of opts.scaleSelect.options) {
      if (option.value !== pageScaleValue) {
        option.selected = false;
        continue;
      }
      option.selected = true;
      predefinedValueFound = true;
    }
    if (!predefinedValueFound) {
      opts.customScaleOption.selected = true;
      opts.customScaleOption.setAttribute("data-l10n-args", JSON.stringify({
        scale: Math.round(pageScale * 10000) / 100
      }));
    }
  }
  updateLoadingIndicatorState(loading = false) {
    const {
      pageNumber
    } = this.#opts;
    pageNumber.classList.toggle("loading", loading);
  }
}
export { Toolbar };