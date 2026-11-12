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
import "core-js/modules/es.iterator.for-each.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
{
  var compatParams = new Map();
  const {
    maxTouchPoints,
    platform,
    userAgent
  } = navigator;
  const isAndroid = /Android/.test(userAgent);
  const isIOS = /\b(?:iPad|iPhone|iPod)(?=;)/.test(userAgent) || platform === "MacIntel" && maxTouchPoints > 1;
  if (isIOS || isAndroid) {
    compatParams.set("maxCanvasPixels", 5242880);
  }
  if (isAndroid) {
    compatParams.set("useSystemFonts", false);
  }
}
const OptionKind = {
  BROWSER: 0x01,
  VIEWER: 0x02,
  API: 0x04,
  WORKER: 0x08,
  EVENT_DISPATCH: 0x10,
  PREFERENCE: 0x80
};
const Type = {
  BOOLEAN: 0x01,
  NUMBER: 0x02,
  OBJECT: 0x04,
  STRING: 0x08,
  UNDEFINED: 0x10
};
const defaultOptions = new Map([["allowedGlobalEvents", {
  value: null,
  kind: OptionKind.BROWSER
}], ["canvasMaxAreaInBytes", {
  value: -1,
  kind: OptionKind.BROWSER + OptionKind.API
}], ["isInAutomation", {
  value: false,
  kind: OptionKind.BROWSER
}], ["localeProperties", {
  value: {
    lang: navigator.language || "en-US"
  },
  kind: OptionKind.BROWSER
}], ["maxCanvasDim", {
  value: 32767,
  kind: OptionKind.BROWSER + OptionKind.VIEWER
}], ["nimbusDataStr", {
  value: "",
  kind: OptionKind.BROWSER
}], ["supportsCaretBrowsingMode", {
  value: false,
  kind: OptionKind.BROWSER
}], ["supportsDocumentFonts", {
  value: true,
  kind: OptionKind.BROWSER
}], ["supportsDownloading", {
  value: true,
  kind: OptionKind.BROWSER
}], ["supportsIntegratedFind", {
  value: false,
  kind: OptionKind.BROWSER
}], ["supportsMouseWheelZoomCtrlKey", {
  value: true,
  kind: OptionKind.BROWSER
}], ["supportsMouseWheelZoomMetaKey", {
  value: true,
  kind: OptionKind.BROWSER
}], ["supportsPinchToZoom", {
  value: true,
  kind: OptionKind.BROWSER
}], ["supportsPrinting", {
  value: true,
  kind: OptionKind.BROWSER
}], ["toolbarDensity", {
  value: 0,
  kind: OptionKind.BROWSER + OptionKind.EVENT_DISPATCH
}], ["altTextLearnMoreUrl", {
  value: "",
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["annotationEditorMode", {
  value: 0,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["annotationMode", {
  value: 2,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["capCanvasAreaFactor", {
  value: 200,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["commentLearnMoreUrl", {
  value: "",
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["cursorToolOnLoad", {
  value: 0,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["debuggerSrc", {
  value: "./debugger.mjs",
  kind: OptionKind.VIEWER
}], ...[["defaultUrl", {
  value: "compressed.tracemonkey-pldi-09.pdf",
  kind: OptionKind.VIEWER
}]], ["defaultZoomDelay", {
  value: 400,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["defaultZoomValue", {
  value: "",
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["disableHistory", {
  value: false,
  kind: OptionKind.VIEWER
}], ["disablePageLabels", {
  value: false,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ...[["disablePreferences", {
  value: false,
  kind: OptionKind.VIEWER
}]], ...[], ["enableAltText", {
  value: false,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["enableAltTextModelDownload", {
  value: true,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE + OptionKind.EVENT_DISPATCH
}], ["enableAutoLinking", {
  value: true,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["enableComment", {
  value: false,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["enableDetailCanvas", {
  value: true,
  kind: OptionKind.VIEWER
}], ...[], ["enableGuessAltText", {
  value: true,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE + OptionKind.EVENT_DISPATCH
}], ["enableHighlightFloatingButton", {
  value: false,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["enableMerge", {
  value: false,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["enableNewAltTextWhenAddingImage", {
  value: true,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["enableNewBadge", {
  value: false,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["enableNova", {
  value: true,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["enableOptimizedPartialRendering", {
  value: false,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["enablePermissions", {
  value: false,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["enablePrintAutoRotate", {
  value: true,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["enableScripting", {
  value: true,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["enableSelectionRendering", {
  value: true,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["enableSignatureEditor", {
  value: false,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["enableSignatureVerification", {
  value: false,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["enableSplitMerge", {
  value: false,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["enableUpdatedAddImage", {
  value: false,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["externalLinkRel", {
  value: "noopener noreferrer nofollow",
  kind: OptionKind.VIEWER
}], ["externalLinkTarget", {
  value: 0,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ...[], ["highlightEditorColors", {
  value: "yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F," + "yellow_HCM=#FFFFCC,green_HCM=#53FFBC,blue_HCM=#80EBFF,pink_HCM=#F6B8FF,red_HCM=#C50043",
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["historyUpdateUrl", {
  value: false,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["ignoreDestinationZoom", {
  value: false,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["imageResourcesPath", {
  value: "./images/",
  kind: OptionKind.VIEWER
}], ["imagesRightClickMinSize", {
  value: -1,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["maxCanvasPixels", {
  value: 2 ** 25,
  kind: OptionKind.VIEWER
}], ["minDurationToUpdateCanvas", {
  value: 500,
  kind: OptionKind.VIEWER
}], ["forcePageColors", {
  value: false,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["pageColorsBackground", {
  value: "Canvas",
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["pageColorsForeground", {
  value: "CanvasText",
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["pdfBugEnabled", {
  value: false,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["postMessageAfterPrintCallback", {
  value: false,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["printResolution", {
  value: 150,
  kind: OptionKind.VIEWER
}], ...[], ...[["sandboxBundleSrc", {
  value: "../build/pdf.sandbox.mjs",
  kind: OptionKind.VIEWER
}]], ["sidebarViewOnLoad", {
  value: -1,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["scrollModeOnLoad", {
  value: -1,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["spreadModeOnLoad", {
  value: -1,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["textLayerMode", {
  value: 1,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["viewerCssTheme", {
  value: 0,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["viewOnLoad", {
  value: 0,
  kind: OptionKind.VIEWER + OptionKind.PREFERENCE
}], ["cMapPacked", {
  value: true,
  kind: OptionKind.API
}], ["cMapUrl", {
  value: "../web/cmaps/",
  kind: OptionKind.API
}], ["disableAutoFetch", {
  value: false,
  kind: OptionKind.API + OptionKind.PREFERENCE
}], ["disableFontFace", {
  value: false,
  kind: OptionKind.API + OptionKind.PREFERENCE
}], ["disableRange", {
  value: false,
  kind: OptionKind.API + OptionKind.PREFERENCE
}], ["disableStream", {
  value: false,
  kind: OptionKind.API + OptionKind.PREFERENCE
}], ["disableWorkerRendering", {
  value: true,
  kind: OptionKind.API + OptionKind.PREFERENCE
}], ["docBaseUrl", {
  value: "",
  kind: OptionKind.API
}], ["enableHWA", {
  value: true,
  kind: OptionKind.API + OptionKind.PREFERENCE
}], ["enableWebGPU", {
  value: true,
  kind: OptionKind.API + OptionKind.PREFERENCE
}], ["enableXfa", {
  value: true,
  kind: OptionKind.API + OptionKind.PREFERENCE
}], ["fontExtraProperties", {
  value: false,
  kind: OptionKind.API
}], ["iccUrl", {
  value: "../web/iccs/",
  kind: OptionKind.API
}], ["isOffscreenCanvasSupported", {
  value: true,
  kind: OptionKind.API
}], ["maxImageSize", {
  value: -1,
  kind: OptionKind.API
}], ["pdfBug", {
  value: false,
  kind: OptionKind.API
}], ["standardFontDataUrl", {
  value: "../web/standard_fonts/",
  kind: OptionKind.API
}], ["useSystemFonts", {
  value: undefined,
  kind: OptionKind.API,
  type: Type.BOOLEAN + Type.UNDEFINED
}], ["verbosity", {
  value: 1,
  kind: OptionKind.API
}], ["wasmUrl", {
  value: "../web/wasm/",
  kind: OptionKind.API
}], ["rendererPorts", {
  value: [],
  kind: OptionKind.WORKER
}], ["rendererSrc", {
  value: "../build/pdf.renderer.mjs",
  kind: OptionKind.WORKER
}], ["workerPort", {
  value: null,
  kind: OptionKind.WORKER
}], ["workerSrc", {
  value: "../build/pdf.worker.mjs",
  kind: OptionKind.WORKER
}]]);
class AppOptions {
  static eventBus;
  static #opts = new Map();
  static {
    for (const [name, defaultOpt] of defaultOptions) {
      this.#opts.set(name, defaultOpt.value);
    }
    for (const [name, value] of compatParams) {
      this.#opts.set(name, value);
    }
    this._hasInvokedSet = false;
    this._checkDisablePreferences = () => {
      if (this.get("disablePreferences")) {
        return true;
      }
      if (this._hasInvokedSet) {
        console.warn("The Preferences may override manually set AppOptions; " + 'please use the "disablePreferences"-option to prevent that.');
      }
      return false;
    };
  }
  static get(name) {
    return this.#opts.get(name);
  }
  static getAll(kind = null, defaultOnly = false) {
    const options = Object.create(null);
    for (const [name, defaultOpt] of defaultOptions) {
      if (kind && !(kind & defaultOpt.kind)) {
        continue;
      }
      options[name] = !defaultOnly ? this.#opts.get(name) : defaultOpt.value;
    }
    return options;
  }
  static set(name, value) {
    this.setAll({
      [name]: value
    });
  }
  static setAll(options, prefs = false) {
    this._hasInvokedSet ||= true;
    let events;
    for (const name in options) {
      const defaultOpt = defaultOptions.get(name),
        userOpt = options[name];
      if (!defaultOpt || !(typeof userOpt === typeof defaultOpt.value || Type[(typeof userOpt).toUpperCase()] & defaultOpt.type)) {
        continue;
      }
      const {
        kind
      } = defaultOpt;
      if (prefs && !(kind & OptionKind.BROWSER || kind & OptionKind.PREFERENCE)) {
        continue;
      }
      if (this.eventBus && kind & OptionKind.EVENT_DISPATCH) {
        (events ??= new Map()).set(name, userOpt);
      }
      this.#opts.set(name, userOpt);
    }
    events?.forEach((value, name) => {
      this.eventBus.dispatch(name.toLowerCase(), {
        source: this,
        value
      });
    });
  }
}
export { AppOptions, OptionKind };