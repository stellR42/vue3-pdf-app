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
import { OutputScale, RenderingCancelledException } from "../pdf.js";
import { RenderableView, RenderingStates } from "./renderable_view.js";
import { AppOptions } from "./app_options.js";
const DRAW_UPSCALE_FACTOR = 2;
const MAX_NUM_SCALING_STEPS = 3;
const THUMBNAIL_WIDTH = 126;
function getTempCanvas(width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", {
    alpha: false
  });
  ctx.save();
  ctx.fillStyle = "rgb(255, 255, 255)";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  return [canvas, ctx];
}
class PDFThumbnailView extends RenderableView {
  #renderingState = RenderingStates.INITIAL;
  constructor({
    container,
    eventBus,
    id,
    defaultViewport,
    optionalContentConfigPromise,
    linkService,
    renderingQueue,
    maxCanvasPixels,
    maxCanvasDim,
    pageColors,
    enableSplitMerge = false
  }) {
    super();
    this.id = id;
    this.renderingId = `thumbnail${id}`;
    this.pageLabel = null;
    this.pdfPage = null;
    this.rotation = 0;
    this.viewport = defaultViewport;
    this.pdfPageRotate = defaultViewport.rotation;
    this._optionalContentConfigPromise = optionalContentConfigPromise || null;
    this.maxCanvasPixels = maxCanvasPixels ?? AppOptions.get("maxCanvasPixels");
    this.maxCanvasDim = maxCanvasDim || AppOptions.get("maxCanvasDim");
    this.pageColors = pageColors || null;
    this.eventBus = eventBus;
    this.linkService = linkService;
    this.renderingQueue = renderingQueue;
    this.placeholder = null;
    const thumbnailContainer = this.div = document.createElement("div");
    thumbnailContainer.className = "thumbnail";
    thumbnailContainer.setAttribute("page-number", id);
    const imageContainer = this.imageContainer = document.createElement("div");
    thumbnailContainer.append(imageContainer);
    imageContainer.classList.add("thumbnailImageContainer", "missingThumbnailImage");
    imageContainer.role = "button";
    imageContainer.tabIndex = -1;
    imageContainer.draggable = false;
    imageContainer.setAttribute("page-number", id);
    imageContainer.setAttribute("data-l10n-id", "pdfjs-thumb-page-title1");
    imageContainer.setAttribute("data-l10n-args", this.#getPageL10nArgs(true));
    const image = this.image = document.createElement("img");
    imageContainer.append(image);
    if (enableSplitMerge) {
      const checkbox = this.checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.tabIndex = -1;
      checkbox.setAttribute("data-l10n-id", "pdfjs-thumb-page-checkbox1");
      checkbox.setAttribute("data-l10n-args", this.#getPageL10nArgs());
      thumbnailContainer.append(checkbox);
      this.pasteButton = null;
    }
    this.#updateDims();
    container.append(thumbnailContainer);
  }
  clone(container, id) {
    const thumbnailView = new PDFThumbnailView({
      container,
      id,
      eventBus: this.eventBus,
      defaultViewport: this.viewport,
      optionalContentConfigPromise: this._optionalContentConfigPromise,
      linkService: this.linkService,
      renderingQueue: this.renderingQueue,
      maxCanvasPixels: this.maxCanvasPixels,
      maxCanvasDim: this.maxCanvasDim,
      pageColors: this.pageColors,
      enableSplitMerge: !!this.checkbox
    });
    const {
      imageContainer
    } = this;
    if (!imageContainer.classList.contains("missingThumbnailImage")) {
      thumbnailView.image.replaceWith(this.image.cloneNode(true));
      thumbnailView.imageContainer.classList.remove("missingThumbnailImage");
    }
    return thumbnailView;
  }
  addPasteButton(pasteCallback) {
    if (this.pasteButton) {
      return;
    }
    const pasteButton = this.pasteButton = document.createElement("button");
    pasteButton.classList.add("thumbnailPasteButton", "viewsManagerButton");
    pasteButton.tabIndex = 0;
    pasteButton.setAttribute("data-l10n-id", "pdfjs-views-manager-paste-button-after");
    pasteButton.setAttribute("data-l10n-args", this.#getPageL10nArgs());
    const span = document.createElement("span");
    span.setAttribute("data-l10n-id", "pdfjs-views-manager-paste-button-label");
    pasteButton.append(span);
    pasteButton.addEventListener("click", () => {
      pasteCallback(this.id);
    });
    if (this.id === 1) {
      const prevPasteButton = this.prevPasteButton = pasteButton.cloneNode(true);
      prevPasteButton.setAttribute("data-l10n-id", "pdfjs-views-manager-paste-button-before");
      prevPasteButton.addEventListener("click", () => {
        pasteCallback(0);
      });
      this.imageContainer.before(prevPasteButton);
    }
    this.imageContainer.after(pasteButton);
  }
  removePasteButton() {
    this.pasteButton?.remove();
    this.pasteButton = null;
    this.prevPasteButton?.remove();
    this.prevPasteButton = null;
  }
  toggleSelected(isSelected) {
    if (this.checkbox) {
      this.checkbox.checked = isSelected;
    }
  }
  updateId(newId) {
    this.id = newId;
    this.renderingId = `thumbnail${newId}`;
    this.div.setAttribute("page-number", newId);
    this.imageContainer.setAttribute("page-number", newId);
    this.setPageLabel(this.pageLabel);
  }
  #updateDims() {
    const {
      width,
      height
    } = this.viewport;
    const ratio = width / height;
    const canvasWidth = this.canvasWidth = THUMBNAIL_WIDTH;
    const canvasHeight = this.canvasHeight = canvasWidth / ratio | 0;
    this.scale = canvasWidth / width;
    this.imageContainer.style.height = `${canvasHeight}px`;
  }
  get renderingState() {
    return this.#renderingState;
  }
  set renderingState(state) {
    this.#renderingState = state;
  }
  setPdfPage(pdfPage) {
    this.pdfPage = pdfPage;
    this.pdfPageRotate = pdfPage.rotate;
    const totalRotation = (this.rotation + this.pdfPageRotate) % 360;
    this.viewport = pdfPage.getViewport({
      scale: 1,
      rotation: totalRotation
    });
    this.reset();
  }
  reset() {
    this.cancelRendering();
    this.renderingState = RenderingStates.INITIAL;
    this.#updateDims();
    const {
      image,
      imageContainer
    } = this;
    const url = image.src;
    if (url) {
      URL.revokeObjectURL(url);
      image.src = "";
      imageContainer.removeAttribute("data-l10n-id");
      imageContainer.removeAttribute("data-l10n-args");
      imageContainer.classList.add("missingThumbnailImage");
    }
  }
  destroy() {
    this.reset();
    this.toggleCurrent(false);
    this.div.remove();
  }
  update({
    rotation = null
  }) {
    if (typeof rotation === "number") {
      this.rotation = rotation;
    }
    const totalRotation = (this.rotation + this.pdfPageRotate) % 360;
    this.viewport = this.viewport.clone({
      scale: 1,
      rotation: totalRotation
    });
    this.reset();
  }
  toggleCurrent(isCurrent) {
    const {
      imageContainer
    } = this;
    if (isCurrent) {
      imageContainer.ariaCurrent = "page";
      imageContainer.tabIndex = 0;
      if (this.checkbox) {
        this.checkbox.tabIndex = 0;
      }
    } else {
      imageContainer.ariaCurrent = false;
      imageContainer.tabIndex = -1;
      if (this.checkbox) {
        this.checkbox.tabIndex = -1;
      }
    }
  }
  cancelRendering() {
    if (this.renderTask) {
      this.renderTask.cancel();
      this.renderTask = null;
    }
    this.resume = null;
  }
  #getPageDrawContext(upscaleFactor = 1) {
    const outputScale = new OutputScale();
    const width = upscaleFactor * this.canvasWidth,
      height = upscaleFactor * this.canvasHeight;
    outputScale.limitCanvas(width, height, this.maxCanvasPixels, this.maxCanvasDim);
    const canvas = document.createElement("canvas");
    canvas.width = width * outputScale.sx | 0;
    canvas.height = height * outputScale.sy | 0;
    const transform = outputScale.scaled ? [outputScale.sx, 0, 0, outputScale.sy, 0, 0] : null;
    return {
      canvas,
      transform
    };
  }
  async #convertCanvasToImage(canvas) {
    if (this.renderingState !== RenderingStates.FINISHED) {
      throw new Error("#convertCanvasToImage: Rendering has not finished.");
    }
    const reducedCanvas = this.#reduceImage(canvas);
    const {
      imageContainer,
      image
    } = this;
    const {
      promise,
      resolve
    } = Promise.withResolvers();
    reducedCanvas.toBlob(resolve);
    const blob = await promise;
    image.src = URL.createObjectURL(blob);
    image.setAttribute("data-l10n-id", "pdfjs-thumb-page-canvas");
    image.setAttribute("data-l10n-args", this.#getPageL10nArgs());
    imageContainer.classList.remove("missingThumbnailImage");
  }
  async draw() {
    if (this.renderingState !== RenderingStates.INITIAL) {
      console.error("Must be in new state before drawing");
      return;
    }
    const {
      pageColors,
      pdfPage
    } = this;
    if (!pdfPage) {
      this.renderingState = RenderingStates.FINISHED;
      throw new Error("pdfPage is not loaded");
    }
    this.renderingState = RenderingStates.RUNNING;
    const {
      canvas,
      transform
    } = this.#getPageDrawContext(DRAW_UPSCALE_FACTOR);
    const drawViewport = this.viewport.clone({
      scale: DRAW_UPSCALE_FACTOR * this.scale
    });
    const renderContinueCallback = cont => {
      if (!this.renderingQueue.isHighestPriority(this)) {
        this.renderingState = RenderingStates.PAUSED;
        this.resume = () => {
          this.renderingState = RenderingStates.RUNNING;
          cont();
        };
        return;
      }
      cont();
    };
    const renderContext = {
      canvas,
      transform,
      viewport: drawViewport,
      optionalContentConfigPromise: this._optionalContentConfigPromise,
      pageColors
    };
    const renderTask = this.renderTask = pdfPage.render(renderContext);
    renderTask.onContinue = renderContinueCallback;
    let error = null;
    try {
      await renderTask.promise;
    } catch (e) {
      if (e instanceof RenderingCancelledException) {
        return;
      }
      error = e;
    } finally {
      if (renderTask === this.renderTask) {
        this.renderTask = null;
      }
    }
    this.renderingState = RenderingStates.FINISHED;
    await this.#convertCanvasToImage(canvas);
    this.eventBus.dispatch("thumbnailrendered", {
      source: this,
      pageNumber: this.id,
      pdfPage
    });
    if (error) {
      throw error;
    }
  }
  setImage(pageView) {
    if (this.renderingState !== RenderingStates.INITIAL) {
      return;
    }
    const {
      thumbnailCanvas: canvas,
      pdfPage,
      scale
    } = pageView;
    if (!canvas) {
      return;
    }
    if (!this.pdfPage) {
      this.setPdfPage(pdfPage);
    }
    if (scale < this.scale) {
      return;
    }
    this.renderingState = RenderingStates.FINISHED;
    this.#convertCanvasToImage(canvas);
  }
  #getReducedImageDims(canvas) {
    const width = canvas.width << MAX_NUM_SCALING_STEPS,
      height = canvas.height << MAX_NUM_SCALING_STEPS;
    const outputScale = new OutputScale();
    outputScale.sx = outputScale.sy = 1;
    outputScale.limitCanvas(width, height, this.maxCanvasPixels, this.maxCanvasDim);
    return [width * outputScale.sx | 0, height * outputScale.sy | 0];
  }
  #reduceImage(img) {
    const {
      canvas
    } = this.#getPageDrawContext(1);
    const ctx = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: false
    });
    if (img.width <= 2 * canvas.width) {
      ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
      return canvas;
    }
    let [reducedWidth, reducedHeight] = this.#getReducedImageDims(canvas);
    const [reducedImage, reducedImageCtx] = getTempCanvas(reducedWidth, reducedHeight);
    while (reducedWidth > img.width || reducedHeight > img.height) {
      reducedWidth >>= 1;
      reducedHeight >>= 1;
    }
    reducedImageCtx.drawImage(img, 0, 0, img.width, img.height, 0, 0, reducedWidth, reducedHeight);
    while (reducedWidth > 2 * canvas.width) {
      reducedImageCtx.drawImage(reducedImage, 0, 0, reducedWidth, reducedHeight, 0, 0, reducedWidth >> 1, reducedHeight >> 1);
      reducedWidth >>= 1;
      reducedHeight >>= 1;
    }
    ctx.drawImage(reducedImage, 0, 0, reducedWidth, reducedHeight, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  #getPageL10nArgs(hasTotal = false) {
    return JSON.stringify({
      page: this.pageLabel ?? this.id,
      total: hasTotal ? this.linkService.pagesCount : undefined
    });
  }
  setPageLabel(label) {
    this.pageLabel = typeof label === "string" ? label : null;
    this.imageContainer.setAttribute("data-l10n-args", this.#getPageL10nArgs(true));
    this.image.setAttribute("data-l10n-args", this.#getPageL10nArgs());
    this.checkbox?.setAttribute("data-l10n-args", this.#getPageL10nArgs());
  }
}
export { PDFThumbnailView };