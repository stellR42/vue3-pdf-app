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
import { AnnotationEditorParamsType, FeatureTest, getRGBA, Util } from "../pdf.js";
import { internalOpt } from "./internal_evt.js";
class AnnotationEditorParams {
  constructor(options, eventBus) {
    this.eventBus = eventBus;
    this.#bindListeners(options);
  }
  #bindListeners({
    editorFreeTextFontSize,
    editorFreeTextColor,
    editorInkColor,
    editorInkThickness,
    editorInkOpacity,
    editorStampAddImage,
    editorFreeHighlightThickness,
    editorHighlightShowAll,
    editorSignatureAddSignature
  }) {
    const {
      eventBus
    } = this;
    const dispatchEvent = (typeStr, value) => {
      eventBus.dispatch("switchannotationeditorparams", {
        source: this,
        type: AnnotationEditorParamsType[typeStr],
        value
      });
    };
    editorFreeTextFontSize.addEventListener("input", function () {
      dispatchEvent("FREETEXT_SIZE", this.valueAsNumber);
    });
    editorFreeTextColor.addEventListener("input", function () {
      dispatchEvent("FREETEXT_COLOR", this.value);
    });
    let updateInkColor, updateInkOpacity;
    if (FeatureTest.isAlphaColorInputSupported) {
      editorInkColor.setAttribute("alpha", "");
      editorInkOpacity.closest(".editorParamsSetter").remove();
      let currentInkColor = "#000000";
      let currentInkOpacity = 1;
      editorInkColor.addEventListener("input", function () {
        const rgba = getRGBA(this.value);
        if (!rgba) {
          return;
        }
        const [r, g, b, opacity] = rgba;
        const hex = Util.makeHexColor(r, g, b);
        currentInkColor = hex;
        currentInkOpacity = opacity;
        dispatchEvent("INK_COLOR_AND_OPACITY", {
          color: hex,
          opacity
        });
      });
      updateInkColor = value => {
        currentInkColor = value;
        const alphaHex = Util.hexNums[Math.round(currentInkOpacity * 255)];
        editorInkColor.value = currentInkColor + alphaHex;
      };
      updateInkOpacity = value => {
        currentInkOpacity = value;
        const alphaHex = Util.hexNums[Math.round(currentInkOpacity * 255)];
        editorInkColor.value = currentInkColor + alphaHex;
      };
    } else {
      editorInkColor.addEventListener("input", function () {
        dispatchEvent("INK_COLOR", this.value);
      });
      editorInkOpacity.addEventListener("input", function () {
        dispatchEvent("INK_OPACITY", this.valueAsNumber);
      });
      updateInkColor = value => {
        editorInkColor.value = value;
      };
      updateInkOpacity = value => {
        editorInkOpacity.value = value;
      };
    }
    editorInkThickness.addEventListener("input", function () {
      dispatchEvent("INK_THICKNESS", this.valueAsNumber);
    });
    editorStampAddImage.addEventListener("click", () => {
      eventBus.dispatch("reporttelemetry", {
        source: this,
        details: {
          type: "editing",
          data: {
            action: "pdfjs.image.add_image_click"
          }
        }
      });
      dispatchEvent("CREATE");
    });
    editorFreeHighlightThickness.addEventListener("input", function () {
      dispatchEvent("HIGHLIGHT_THICKNESS", this.valueAsNumber);
    });
    editorHighlightShowAll.addEventListener("click", function () {
      const checked = this.getAttribute("aria-pressed") === "true";
      this.setAttribute("aria-pressed", !checked);
      dispatchEvent("HIGHLIGHT_SHOW_ALL", !checked);
    });
    editorSignatureAddSignature.addEventListener("click", () => {
      dispatchEvent("CREATE");
    });
    eventBus.on("annotationeditorparamschanged", evt => {
      for (const [type, value] of evt.details) {
        switch (type) {
          case AnnotationEditorParamsType.FREETEXT_SIZE:
            editorFreeTextFontSize.value = value;
            break;
          case AnnotationEditorParamsType.FREETEXT_COLOR:
            editorFreeTextColor.value = value;
            break;
          case AnnotationEditorParamsType.INK_COLOR:
            updateInkColor(value);
            break;
          case AnnotationEditorParamsType.INK_THICKNESS:
            editorInkThickness.value = value;
            break;
          case AnnotationEditorParamsType.INK_OPACITY:
            updateInkOpacity(value);
            break;
          case AnnotationEditorParamsType.HIGHLIGHT_COLOR:
            eventBus.dispatch("mainhighlightcolorpickerupdatecolor", {
              source: this,
              value
            });
            break;
          case AnnotationEditorParamsType.HIGHLIGHT_THICKNESS:
            editorFreeHighlightThickness.value = value;
            break;
          case AnnotationEditorParamsType.HIGHLIGHT_FREE:
            editorFreeHighlightThickness.disabled = !value;
            break;
          case AnnotationEditorParamsType.HIGHLIGHT_SHOW_ALL:
            editorHighlightShowAll.setAttribute("aria-pressed", value);
            break;
        }
      }
    }, internalOpt);
  }
}
export { AnnotationEditorParams };