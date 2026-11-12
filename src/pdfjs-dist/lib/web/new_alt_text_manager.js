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
import "core-js/modules/es.json.stringify.js";
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import { internalOpt } from "./internal_evt.js";
import { noContextMenu } from "../pdf.js";
class NewAltTextManager {
  #boundCancel = this.#cancel.bind(this);
  #createAutomaticallyButton;
  #currentEditor = null;
  #cancelButton;
  #descriptionContainer;
  #dialog;
  #disclaimer;
  #downloadModel;
  #downloadModelDescription;
  #eventBus;
  #firstTime = false;
  #guessedAltText;
  #hasAI = null;
  #isEditing = null;
  #imagePreview;
  #imageData;
  #isAILoading = false;
  #wasAILoading = false;
  #learnMore;
  #notNowButton;
  #overlayManager;
  #textarea;
  #title;
  #uiManager;
  #previousAltText = null;
  constructor({
    descriptionContainer,
    dialog,
    imagePreview,
    cancelButton,
    disclaimer,
    notNowButton,
    saveButton,
    textarea,
    learnMore,
    errorCloseButton,
    createAutomaticallyButton,
    downloadModel,
    downloadModelDescription,
    title
  }, overlayManager, eventBus) {
    this.#cancelButton = cancelButton;
    this.#createAutomaticallyButton = createAutomaticallyButton;
    this.#descriptionContainer = descriptionContainer;
    this.#dialog = dialog;
    this.#disclaimer = disclaimer;
    this.#notNowButton = notNowButton;
    this.#imagePreview = imagePreview;
    this.#textarea = textarea;
    this.#learnMore = learnMore;
    this.#title = title;
    this.#downloadModel = downloadModel;
    this.#downloadModelDescription = downloadModelDescription;
    this.#overlayManager = overlayManager;
    this.#eventBus = eventBus;
    dialog.addEventListener("close", this.#close.bind(this));
    dialog.addEventListener("contextmenu", event => {
      if (event.target !== this.#textarea) {
        event.preventDefault();
      }
    });
    cancelButton.addEventListener("click", this.#boundCancel);
    notNowButton.addEventListener("click", this.#boundCancel);
    saveButton.addEventListener("click", this.#save.bind(this));
    errorCloseButton.addEventListener("click", () => {
      this.#toggleError(false);
    });
    createAutomaticallyButton.addEventListener("click", async () => {
      const checked = createAutomaticallyButton.getAttribute("aria-pressed") !== "true";
      this.#currentEditor._reportTelemetry({
        action: "pdfjs.image.alt_text.ai_generation_check",
        data: {
          status: checked
        }
      });
      if (this.#uiManager) {
        const isAltTextEnabled = await this.#uiManager.mlManager.isEnabledFor("altText");
        this.#createAutomaticallyButton.disabled = true;
        if (checked && !isAltTextEnabled) {
          this.#textarea.value = "";
          this.#setProgress();
          this.#uiManager.setPreference("enableGuessAltText", true);
          await this.#uiManager.mlManager.downloadModel("altText");
          this.#setPref("enableAltTextModelDownload", true);
        } else if (!checked && isAltTextEnabled) {
          this.#uiManager.setPreference("enableGuessAltText", false);
          await this.#uiManager.mlManager.deleteModel("altText");
          this.#setPref("enableAltTextModelDownload", false);
        }
        this.#createAutomaticallyButton.disabled = false;
        await this.#uiManager.mlManager.toggleService("altText", checked);
      }
      this.#toggleGuessAltText(checked, false);
    });
    textarea.addEventListener("focus", () => {
      this.#wasAILoading = this.#isAILoading;
      this.#toggleLoading(false);
      this.#toggleTitleAndDisclaimer();
    });
    textarea.addEventListener("blur", () => {
      if (!textarea.value) {
        this.#toggleLoading(this.#wasAILoading);
      }
      this.#toggleTitleAndDisclaimer();
    });
    textarea.addEventListener("input", () => {
      this.#toggleTitleAndDisclaimer();
    });
    textarea.addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !saveButton.disabled) {
        this.#save();
      }
    });
    eventBus.on("enableguessalttext", ({
      value
    }) => {
      this.#toggleGuessAltText(value, false);
    }, internalOpt);
    this.#overlayManager.register(dialog);
    this.#learnMore.addEventListener("click", () => {
      this.#currentEditor._reportTelemetry({
        action: "pdfjs.image.alt_text.info",
        data: {
          topic: "alt_text"
        }
      });
    });
  }
  #setPref(name, value) {
    this.#eventBus.dispatch("setpreference", {
      source: this,
      name,
      value
    });
  }
  #toggleLoading(value) {
    if (!this.#uiManager || this.#isAILoading === value) {
      return;
    }
    this.#isAILoading = value;
    this.#descriptionContainer.classList.toggle("loading", value);
  }
  #toggleError(value) {
    if (!this.#uiManager) {
      return;
    }
    this.#dialog.classList.toggle("error", value);
  }
  async #toggleGuessAltText(value, isInitial) {
    if (!this.#uiManager) {
      return;
    }
    this.#dialog.classList.toggle("aiDisabled", !value);
    this.#createAutomaticallyButton.setAttribute("aria-pressed", value);
    if (value) {
      const {
        altTextLearnMoreUrl
      } = this.#uiManager.mlManager;
      if (altTextLearnMoreUrl) {
        this.#learnMore.href = altTextLearnMoreUrl;
      }
      this.#mlGuessAltText(isInitial);
    } else {
      this.#toggleLoading(false);
      this.#isAILoading = false;
      this.#toggleTitleAndDisclaimer();
    }
  }
  #toggleNotNow() {
    this.#notNowButton.classList.toggle("hidden", !this.#firstTime);
    this.#cancelButton.classList.toggle("hidden", this.#firstTime);
  }
  #toggleAI(value) {
    if (!this.#uiManager || this.#hasAI === value) {
      return;
    }
    this.#hasAI = value;
    this.#dialog.classList.toggle("noAi", !value);
    this.#toggleTitleAndDisclaimer();
  }
  #toggleTitleAndDisclaimer() {
    const visible = this.#isAILoading || this.#guessedAltText && this.#guessedAltText === this.#textarea.value;
    this.#disclaimer.hidden = !visible;
    const isEditing = this.#isAILoading || !!this.#textarea.value;
    if (this.#isEditing === isEditing) {
      return;
    }
    this.#isEditing = isEditing;
    this.#title.setAttribute("data-l10n-id", isEditing ? "pdfjs-editor-new-alt-text-dialog-edit-label" : "pdfjs-editor-new-alt-text-dialog-add-label");
  }
  async #mlGuessAltText(isInitial) {
    if (this.#isAILoading) {
      return;
    }
    if (this.#textarea.value) {
      return;
    }
    if (isInitial && this.#previousAltText !== null) {
      return;
    }
    this.#guessedAltText = this.#currentEditor.guessedAltText;
    if (this.#previousAltText === null && this.#guessedAltText) {
      this.#addAltText(this.#guessedAltText);
      return;
    }
    this.#toggleLoading(true);
    this.#toggleTitleAndDisclaimer();
    let hasError = false;
    try {
      const altText = await this.#currentEditor.mlGuessAltText(this.#imageData, false);
      if (altText) {
        this.#guessedAltText = altText;
        this.#wasAILoading = this.#isAILoading;
        if (this.#isAILoading) {
          this.#addAltText(altText);
        }
      }
    } catch (e) {
      console.error(e);
      hasError = true;
    }
    this.#toggleLoading(false);
    this.#toggleTitleAndDisclaimer();
    if (hasError && this.#uiManager) {
      this.#toggleError(true);
    }
  }
  #addAltText(altText) {
    if (!this.#uiManager || this.#textarea.value) {
      return;
    }
    this.#textarea.value = altText;
    this.#toggleTitleAndDisclaimer();
  }
  #setProgress() {
    this.#downloadModel.classList.toggle("hidden", false);
    const callback = async ({
      detail: {
        finished,
        total,
        totalLoaded
      }
    }) => {
      const ONE_MEGA_BYTES = 1e6;
      totalLoaded = Math.min(0.99 * total, totalLoaded);
      const totalSize = this.#downloadModelDescription.ariaValueMax = Math.round(total / ONE_MEGA_BYTES);
      const downloadedSize = this.#downloadModelDescription.ariaValueNow = Math.round(totalLoaded / ONE_MEGA_BYTES);
      this.#downloadModelDescription.setAttribute("data-l10n-args", JSON.stringify({
        totalSize,
        downloadedSize
      }));
      if (!finished) {
        return;
      }
      this.#eventBus.off("loadaiengineprogress", callback);
      this.#downloadModel.classList.toggle("hidden", true);
      this.#toggleAI(true);
      if (!this.#uiManager) {
        return;
      }
      const {
        mlManager
      } = this.#uiManager;
      mlManager.toggleService("altText", true);
      this.#toggleGuessAltText(await mlManager.isEnabledFor("altText"), true);
    };
    this.#eventBus.on("loadaiengineprogress", callback, internalOpt);
  }
  async editAltText(uiManager, editor, firstTime) {
    if (this.#currentEditor || !editor) {
      return;
    }
    if (firstTime && editor.hasAltTextData()) {
      editor.altTextFinish();
      return;
    }
    this.#firstTime = firstTime;
    const {
      mlManager
    } = uiManager;
    const hasAI = !!mlManager;
    this.#toggleTitleAndDisclaimer();
    if (mlManager && !mlManager.isReady("altText")) {
      if (mlManager.hasProgress) {
        this.#setProgress();
      } else {
        this.#createAutomaticallyButton.setAttribute("aria-pressed", false);
      }
    } else {
      this.#downloadModel.classList.toggle("hidden", true);
    }
    const isAltTextEnabledPromise = mlManager?.isEnabledFor("altText");
    this.#currentEditor = editor;
    this.#uiManager = uiManager;
    this.#uiManager.removeEditListeners();
    ({
      altText: this.#previousAltText
    } = editor.altTextData);
    this.#textarea.value = this.#previousAltText ?? "";
    const AI_MAX_IMAGE_DIMENSION = 224;
    const MAX_PREVIEW_DIMENSION = 180;
    let canvas, width, height;
    if (mlManager) {
      ({
        canvas,
        width,
        height,
        imageData: this.#imageData
      } = editor.copyCanvas(AI_MAX_IMAGE_DIMENSION, MAX_PREVIEW_DIMENSION, true));
      if (hasAI) {
        this.#toggleGuessAltText(await isAltTextEnabledPromise, true);
      }
    } else {
      ({
        canvas,
        width,
        height
      } = editor.copyCanvas(AI_MAX_IMAGE_DIMENSION, MAX_PREVIEW_DIMENSION, false));
    }
    canvas.setAttribute("role", "presentation");
    const {
      style
    } = canvas;
    style.width = `${width}px`;
    style.height = `${height}px`;
    this.#imagePreview.append(canvas);
    this.#toggleNotNow();
    this.#toggleAI(hasAI);
    this.#toggleError(false);
    try {
      await this.#overlayManager.open(this.#dialog);
    } catch (ex) {
      this.#close();
      throw ex;
    }
  }
  #cancel() {
    this.#currentEditor.altTextData = {
      cancel: true
    };
    const altText = this.#textarea.value.trim();
    this.#currentEditor._reportTelemetry({
      action: "pdfjs.image.alt_text.dismiss",
      data: {
        alt_text_type: altText ? "present" : "empty",
        flow: this.#firstTime ? "image_add" : "alt_text_edit"
      }
    });
    this.#currentEditor._reportTelemetry({
      action: "pdfjs.image.image_added",
      data: {
        alt_text_modal: true,
        alt_text_type: "skipped"
      }
    });
    this.#finish();
  }
  #finish() {
    this.#overlayManager.closeIfActive(this.#dialog);
  }
  #close() {
    const canvas = this.#imagePreview.firstElementChild;
    canvas.remove();
    canvas.width = canvas.height = 0;
    this.#imageData = null;
    this.#toggleLoading(false);
    this.#uiManager?.addEditListeners();
    this.#currentEditor.altTextFinish();
    this.#uiManager?.setSelected(this.#currentEditor);
    this.#currentEditor = null;
    this.#uiManager = null;
  }
  #extractWords(text) {
    return new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/gu).filter(Boolean));
  }
  #save() {
    const altText = this.#textarea.value.trim();
    this.#currentEditor.altTextData = {
      altText,
      decorative: false
    };
    this.#currentEditor.altTextData.guessedAltText = this.#guessedAltText;
    if (this.#guessedAltText && this.#guessedAltText !== altText) {
      const guessedWords = this.#extractWords(this.#guessedAltText);
      const words = this.#extractWords(altText);
      this.#currentEditor._reportTelemetry({
        action: "pdfjs.image.alt_text.user_edit",
        data: {
          total_words: guessedWords.size,
          words_removed: guessedWords.difference(words).size,
          words_added: words.difference(guessedWords).size
        }
      });
    }
    this.#currentEditor._reportTelemetry({
      action: "pdfjs.image.image_added",
      data: {
        alt_text_modal: true,
        alt_text_type: altText ? "present" : "empty"
      }
    });
    this.#currentEditor._reportTelemetry({
      action: "pdfjs.image.alt_text.save",
      data: {
        alt_text_type: altText ? "present" : "empty",
        flow: this.#firstTime ? "image_add" : "alt_text_edit"
      }
    });
    this.#finish();
  }
  destroy() {
    this.#uiManager = null;
    this.#finish();
  }
}
class ImageAltTextSettings {
  #createModelButton;
  #dialog;
  #eventBus;
  #mlManager;
  #overlayManager;
  #showAltTextDialogButton;
  constructor({
    dialog,
    createModelButton,
    learnMore,
    closeButton,
    showAltTextDialogButton
  }, overlayManager, eventBus, mlManager) {
    this.#dialog = dialog;
    this.#createModelButton = createModelButton;
    this.#showAltTextDialogButton = showAltTextDialogButton;
    this.#overlayManager = overlayManager;
    this.#eventBus = eventBus;
    this.#mlManager = mlManager;
    const {
      altTextLearnMoreUrl
    } = mlManager;
    if (altTextLearnMoreUrl) {
      learnMore.href = altTextLearnMoreUrl;
    }
    dialog.addEventListener("contextmenu", noContextMenu);
    createModelButton.addEventListener("click", async e => {
      const checked = this.#togglePref("enableGuessAltText", e);
      await (checked ? this.#download(true) : this.#delete(true));
      await mlManager.toggleService("altText", checked);
      this.#reportTelemetry({
        type: "stamp",
        action: "pdfjs.image.alt_text.settings_ai_generation_check",
        data: {
          status: checked
        }
      });
    });
    showAltTextDialogButton.addEventListener("click", e => {
      const checked = this.#togglePref("enableNewAltTextWhenAddingImage", e);
      this.#reportTelemetry({
        type: "stamp",
        action: "pdfjs.image.alt_text.settings_edit_alt_text_check",
        data: {
          status: checked
        }
      });
    });
    closeButton.addEventListener("click", this.#finish.bind(this));
    learnMore.addEventListener("click", () => {
      this.#reportTelemetry({
        type: "stamp",
        action: "pdfjs.image.alt_text.info",
        data: {
          topic: "ai_generation"
        }
      });
    });
    eventBus.on("enablealttextmodeldownload", ({
      value
    }) => {
      if (value) {
        this.#download(false);
      } else {
        this.#delete(false);
      }
    }, internalOpt);
    this.#overlayManager.register(dialog);
  }
  #reportTelemetry(data) {
    this.#eventBus.dispatch("reporttelemetry", {
      source: this,
      details: {
        type: "editing",
        data
      }
    });
  }
  async #download(isFromUI = false) {
    if (isFromUI) {
      await this.#mlManager.downloadModel("altText");
      this.#setPref("enableGuessAltText", true);
      this.#mlManager.toggleService("altText", true);
      this.#setPref("enableAltTextModelDownload", true);
    }
  }
  async #delete(isFromUI = false) {
    if (isFromUI) {
      await this.#mlManager.deleteModel("altText");
      this.#setPref("enableGuessAltText", false);
      this.#setPref("enableAltTextModelDownload", false);
    }
    this.#createModelButton.setAttribute("aria-pressed", false);
  }
  async open({
    enableGuessAltText,
    enableNewAltTextWhenAddingImage
  }) {
    const {
      enableAltTextModelDownload
    } = this.#mlManager;
    this.#createModelButton.setAttribute("aria-pressed", enableAltTextModelDownload && enableGuessAltText);
    this.#showAltTextDialogButton.setAttribute("aria-pressed", enableNewAltTextWhenAddingImage);
    await this.#overlayManager.open(this.#dialog);
    this.#reportTelemetry({
      type: "stamp",
      action: "pdfjs.image.alt_text.settings_displayed"
    });
  }
  #togglePref(name, {
    target
  }) {
    const checked = target.getAttribute("aria-pressed") !== "true";
    this.#setPref(name, checked);
    target.setAttribute("aria-pressed", checked);
    return checked;
  }
  #setPref(name, value) {
    this.#eventBus.dispatch("setpreference", {
      source: this,
      name,
      value
    });
  }
  #finish() {
    this.#overlayManager.closeIfActive(this.#dialog);
  }
}
export { ImageAltTextSettings, NewAltTextManager };