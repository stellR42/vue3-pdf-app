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
import "core-js/modules/es.json.stringify.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import { AbortException, AnnotationMode, OutputScale, PixelsPerInch, setLayerDimensions, shadow, TextLayerImages } from "../pdf.js";
import { approximateFraction, calcRound, DEFAULT_SCALE, floorToDivide, TextLayerMode } from "./ui_utils.js";
import { AnnotationEditorLayerBuilder } from "./annotation_editor_layer_builder.js";
import { AnnotationLayerBuilder } from "./annotation_layer_builder.js";
import { AppOptions } from "./app_options.js";
import { Autolinker } from "./autolinker.js";
import { BasePDFPageView } from "./base_pdf_page_view.js";
import { DrawLayerBuilder } from "./draw_layer_builder.js";
import { GenericL10n } from "../web/genericl10n.js";
import { PDFPageDetailView } from "./pdf_page_detail_view.js";
import { RenderingStates } from "./renderable_view.js";
import { SimpleLinkService } from "./pdf_link_service.js";
import { StructTreeLayerBuilder } from "./struct_tree_layer_builder.js";
import { TextAccessibilityManager } from "./text_accessibility.js";
import { TextHighlighter } from "./text_highlighter.js";
import { TextLayerBuilder } from "./text_layer_builder.js";
import { XfaLayerBuilder } from "./xfa_layer_builder.js";
const DEFAULT_LAYER_PROPERTIES = null;
const LAYERS_ORDER = new Map([["canvasWrapper", 0], ["textLayer", 1], ["annotationLayer", 2], ["annotationEditorLayer", 3], ["xfaLayer", 3]]);
class PDFPageView extends BasePDFPageView {
  #abortSignal = null;
  #annotationMode = AnnotationMode.ENABLE_FORMS;
  #canvasWrapper = null;
  #commentManager = null;
  #enableAutoLinking = true;
  #hasRestrictedScaling = false;
  #isEditing = false;
  #layerProperties = null;
  #needsRestrictedScaling = false;
  #originalViewport = null;
  #previousRotation = null;
  #scaleRoundX = 1;
  #scaleRoundY = 1;
  #textLayerMode = TextLayerMode.ENABLE;
  #userUnit = 1;
  #useThumbnailCanvas = {
    directDrawing: true,
    initialOptionalContent: true,
    regularAnnotations: true
  };
  #layers = [null, null, null, null];
  constructor(options) {
    super(options);
    const {
      container,
      defaultViewport
    } = options;
    this.renderingId = "page" + this.id;
    this.#layerProperties = options.layerProperties || DEFAULT_LAYER_PROPERTIES;
    this.#abortSignal = options.abortSignal || null;
    this.pdfPage = null;
    this.pageLabel = null;
    this.rotation = 0;
    this.scale = options.scale || DEFAULT_SCALE;
    this.viewport = defaultViewport;
    this.pdfPageRotate = defaultViewport.rotation;
    this._optionalContentConfigPromise = options.optionalContentConfigPromise || null;
    this.#textLayerMode = options.textLayerMode ?? TextLayerMode.ENABLE;
    this.#annotationMode = options.annotationMode ?? AnnotationMode.ENABLE_FORMS;
    this.imageResourcesPath = options.imageResourcesPath || "";
    this.enableDetailCanvas = options.enableDetailCanvas ?? true;
    this.maxCanvasPixels = options.maxCanvasPixels ?? AppOptions.get("maxCanvasPixels");
    this.maxCanvasDim = options.maxCanvasDim || AppOptions.get("maxCanvasDim");
    this.capCanvasAreaFactor = options.capCanvasAreaFactor ?? AppOptions.get("capCanvasAreaFactor");
    this.#enableAutoLinking = options.enableAutoLinking !== false;
    this.#commentManager = options.commentManager || null;
    this.l10n = options.l10n;
    this.l10n ||= new GenericL10n();
    this._isStandalone = !this.renderingQueue?.hasViewer();
    this._container = container;
    this._annotationCanvasMap = null;
    this.annotationLayer = null;
    this.annotationEditorLayer = null;
    this.textLayer = null;
    this.xfaLayer = null;
    this.structTreeLayer = null;
    this.drawLayer = null;
    this.detailView = null;
    const div = document.createElement("div");
    div.className = "page";
    div.setAttribute("data-page-number", this.id);
    div.setAttribute("role", "region");
    div.setAttribute("data-l10n-id", "pdfjs-page-landmark");
    div.setAttribute("data-l10n-args", JSON.stringify({
      page: this.id
    }));
    this.div = div;
    this.#setDimensions();
    container?.append(div);
    if (this._isStandalone) {
      container?.style.setProperty("--scale-factor", this.scale * PixelsPerInch.PDF_TO_CSS_UNITS);
      if (this.pageColors?.background) {
        container?.style.setProperty("--page-bg-color", this.pageColors.background);
      }
      const {
        optionalContentConfigPromise
      } = options;
      if (optionalContentConfigPromise) {
        optionalContentConfigPromise.then(optionalContentConfig => {
          if (optionalContentConfigPromise !== this._optionalContentConfigPromise) {
            return;
          }
          this.#useThumbnailCanvas.initialOptionalContent = optionalContentConfig.hasInitialVisibility;
        });
      }
      if (!options.l10n) {
        this.l10n.translate(this.div);
      }
    }
  }
  clone(id) {
    const clone = new PDFPageView({
      container: null,
      eventBus: this.eventBus,
      pagesColors: this.pageColors,
      renderingQueue: this.renderingQueue,
      enableOptimizedPartialRendering: this.enableOptimizedPartialRendering,
      minDurationToUpdateCanvas: this.minDurationToUpdateCanvas,
      defaultViewport: this.viewport,
      id,
      layerProperties: this.#layerProperties,
      abortSignal: this.#abortSignal,
      scale: this.scale,
      optionalContentConfigPromise: this._optionalContentConfigPromise,
      textLayerMode: this.#textLayerMode,
      annotationMode: this.#annotationMode,
      imageResourcesPath: this.imageResourcesPath,
      enableDetailCanvas: this.enableDetailCanvas,
      maxCanvasPixels: this.maxCanvasPixels,
      maxCanvasDim: this.maxCanvasDim,
      capCanvasAreaFactor: this.capCanvasAreaFactor,
      enableAutoLinking: this.#enableAutoLinking,
      commentManager: this.#commentManager,
      l10n: this.l10n
    });
    clone.setPdfPage(this.pdfPage.clone(id - 1));
    return clone;
  }
  #addLayer(div, name) {
    const pos = LAYERS_ORDER.get(name);
    const oldDiv = this.#layers[pos];
    this.#layers[pos] = div;
    if (oldDiv) {
      oldDiv.replaceWith(div);
      return;
    }
    for (let i = pos - 1; i >= 0; i--) {
      const layer = this.#layers[i];
      if (layer) {
        layer.after(div);
        return;
      }
    }
    this.div.prepend(div);
  }
  #setDimensions() {
    const {
      div,
      viewport
    } = this;
    if (viewport.userUnit !== this.#userUnit) {
      if (viewport.userUnit !== 1) {
        div.style.setProperty("--user-unit", viewport.userUnit);
      } else {
        div.style.removeProperty("--user-unit");
      }
      this.#userUnit = viewport.userUnit;
    }
    if (this.pdfPage) {
      if (this.#previousRotation === viewport.rotation) {
        return;
      }
      this.#previousRotation = viewport.rotation;
    }
    setLayerDimensions(div, viewport, true, false);
  }
  updatePageNumber(newPageNumber) {
    const oldPageNumber = this.id;
    if (oldPageNumber !== newPageNumber) {
      this.id = newPageNumber;
      this.renderingId = `page${newPageNumber}`;
      if (this.pdfPage) {
        this.pdfPage.pageNumber = newPageNumber;
      }
      this.setPageLabel(this.pageLabel);
      const {
        div
      } = this;
      div.setAttribute("data-page-number", newPageNumber);
      div.setAttribute("data-l10n-args", JSON.stringify({
        page: newPageNumber
      }));
      this._textHighlighter.pageIdx = newPageNumber - 1;
    }
    this.#layerProperties.annotationEditorUIManager?.updatePageIndex(oldPageNumber - 1, newPageNumber - 1);
  }
  setPdfPage(pdfPage) {
    if (this._isStandalone && (this.pageColors?.foreground === "CanvasText" || this.pageColors?.background === "Canvas")) {
      this._container?.style.setProperty("--hcm-highlight-filter", pdfPage.filterFactory.addHighlightHCMFilter("highlight", "CanvasText", "Canvas", "HighlightText", "Highlight"));
      this._container?.style.setProperty("--hcm-highlight-selected-filter", pdfPage.filterFactory.addHighlightHCMFilter("highlight_selected", "CanvasText", "Canvas", "HighlightText", "Highlight"));
    }
    this.pdfPage = pdfPage;
    this.pdfPageRotate = pdfPage.rotate;
    const totalRotation = (this.rotation + this.pdfPageRotate) % 360;
    this.viewport = pdfPage.getViewport({
      scale: this.scale * PixelsPerInch.PDF_TO_CSS_UNITS,
      rotation: totalRotation
    });
    this.#setDimensions();
    this.reset();
  }
  destroy() {
    this.reset();
    this.pdfPage?.cleanup();
  }
  deleteMe(isCut) {
    if (isCut) {
      this.div.remove();
      return;
    }
    this.destroy();
    this.#layerProperties.annotationEditorUIManager?.deletePage(this.id);
  }
  hasEditableAnnotations() {
    return !!this.annotationLayer?.hasEditableAnnotations();
  }
  get _textHighlighter() {
    return shadow(this, "_textHighlighter", new TextHighlighter({
      pageIndex: this.id - 1,
      eventBus: this.eventBus,
      findController: this.#layerProperties.findController
    }));
  }
  #dispatchLayerRendered(name, error) {
    this.eventBus.dispatch(name, {
      source: this,
      pageNumber: this.id,
      error
    });
  }
  async #renderAnnotationLayer(textLayerPromise = null) {
    const {
      annotationLayer,
      textLayer
    } = this;
    let error = null;
    try {
      await this.annotationLayer.render({
        viewport: this.viewport,
        intent: "display",
        structTreeLayer: this.structTreeLayer,
        optionalContentConfigPromise: this._optionalContentConfigPromise
      });
    } catch (ex) {
      console.error("#renderAnnotationLayer:", ex);
      error = ex;
    } finally {
      this.#dispatchLayerRendered("annotationlayerrendered", error);
    }
    if (this.#enableAutoLinking && textLayerPromise && !annotationLayer.linksInjected) {
      this.#injectLinkAnnotations(textLayerPromise, annotationLayer, textLayer);
    }
  }
  _refreshAnnotationLayer() {
    if (this._annotationCanvasMap?.size) {
      this.annotationLayer?.refreshCanvases();
    }
  }
  async #renderAnnotationEditorLayer() {
    let error = null;
    try {
      await this.annotationEditorLayer.render({
        viewport: this.viewport,
        intent: "display"
      });
    } catch (ex) {
      console.error("#renderAnnotationEditorLayer:", ex);
      error = ex;
    } finally {
      this.#dispatchLayerRendered("annotationeditorlayerrendered", error);
    }
  }
  async #renderDrawLayer() {
    try {
      await this.drawLayer.render({
        intent: "display"
      });
    } catch (ex) {
      console.error("#renderDrawLayer:", ex);
    }
  }
  async #renderXfaLayer() {
    let error = null;
    try {
      const result = await this.xfaLayer.render({
        viewport: this.viewport,
        intent: "display"
      });
      if (result?.textDivs && this._textHighlighter) {
        this.#buildXfaTextContentItems(result.textDivs);
      }
    } catch (ex) {
      console.error("#renderXfaLayer:", ex);
      error = ex;
    } finally {
      if (this.xfaLayer?.div) {
        this.l10n.pause();
        this.#addLayer(this.xfaLayer.div, "xfaLayer");
        this.l10n.resume();
      }
      this.#dispatchLayerRendered("xfalayerrendered", error);
    }
  }
  async #renderTextLayer() {
    let error = null;
    try {
      await this.textLayer.render({
        viewport: this.viewport,
        images: this.imageCoordinates ? new TextLayerImages(this.imagesRightClickMinSize, this.imageCoordinates, this.viewport, () => this.canvas) : null
      });
    } catch (ex) {
      if (ex instanceof AbortException) {
        return true;
      }
      console.error("#renderTextLayer:", ex);
      error = ex;
    }
    this.#dispatchLayerRendered("textlayerrendered", error);
    this.#renderStructTreeLayer();
    return false;
  }
  async #renderStructTreeLayer() {
    const treeDom = await this.structTreeLayer?.render();
    if (treeDom) {
      this.l10n.pause();
      this.structTreeLayer?.updateTextLayer();
      if (this.canvas && treeDom.parentNode !== this.canvas) {
        this.canvas.append(treeDom);
      }
      this.l10n.resume();
    }
    this.structTreeLayer?.show();
  }
  async #buildXfaTextContentItems(textDivs) {
    const text = await this.pdfPage.getTextContent();
    const items = [];
    for (const item of text.items) {
      items.push(item.str);
    }
    this._textHighlighter.setTextMapping(textDivs, items);
    this._textHighlighter.enable();
  }
  async #injectLinkAnnotations(textLayerPromise, annotationLayer, textLayer) {
    let error = null;
    try {
      const textLayerAborted = await textLayerPromise;
      if (textLayerAborted || annotationLayer !== this.annotationLayer || textLayer !== this.textLayer || annotationLayer.linksInjected) {
        return;
      }
      await annotationLayer.injectLinkAnnotations(Autolinker.processLinks(this));
    } catch (ex) {
      console.error("#injectLinkAnnotations:", ex);
      error = ex;
    }
    this.#dispatchLayerRendered("linkannotationsadded", error);
  }
  _resetCanvas() {
    super._resetCanvas();
    this.#originalViewport = null;
  }
  reset({
    keepAnnotationLayer = false,
    keepAnnotationEditorLayer = false,
    keepXfaLayer = false,
    keepTextLayer = false,
    keepCanvasWrapper = false,
    preserveDetailViewState = false
  } = {}) {
    const keepPdfBugGroups = this.pdfPage?._pdfBug ?? false;
    this.cancelRendering({
      keepAnnotationLayer,
      keepAnnotationEditorLayer,
      keepXfaLayer,
      keepTextLayer
    });
    this.renderingState = RenderingStates.INITIAL;
    const div = this.div;
    const childNodes = div.childNodes,
      annotationLayerNode = keepAnnotationLayer && this.annotationLayer?.div || null,
      annotationEditorLayerNode = keepAnnotationEditorLayer && this.annotationEditorLayer?.div || null,
      xfaLayerNode = keepXfaLayer && this.xfaLayer?.div || null,
      textLayerNode = keepTextLayer && this.textLayer?.div || null,
      canvasWrapperNode = keepCanvasWrapper && this.#canvasWrapper || null;
    for (let i = childNodes.length - 1; i >= 0; i--) {
      const node = childNodes[i];
      switch (node) {
        case annotationLayerNode:
        case annotationEditorLayerNode:
        case xfaLayerNode:
        case textLayerNode:
        case canvasWrapperNode:
          continue;
      }
      if (keepPdfBugGroups && node.classList.contains("pdfBugGroupsLayer")) {
        continue;
      }
      node.remove();
      const layerIndex = this.#layers.indexOf(node);
      if (layerIndex >= 0) {
        this.#layers[layerIndex] = null;
      }
    }
    div.removeAttribute("data-loaded");
    if (annotationLayerNode) {
      this.annotationLayer.hide();
    }
    if (annotationEditorLayerNode) {
      this.annotationEditorLayer.hide();
    }
    if (xfaLayerNode) {
      this.xfaLayer.hide();
    }
    if (textLayerNode) {
      this.textLayer.hide();
    }
    this.structTreeLayer?.hide();
    if (!keepCanvasWrapper && this.#canvasWrapper) {
      this.#canvasWrapper = null;
      this._resetCanvas();
    }
    if (!preserveDetailViewState) {
      this.detailView?.reset({
        keepCanvas: keepCanvasWrapper
      });
      if (!keepCanvasWrapper) {
        this.detailView = null;
      }
    }
  }
  toggleEditingMode(isEditing) {
    this.#isEditing = isEditing;
    if (!this.hasEditableAnnotations()) {
      return;
    }
    this.reset({
      keepAnnotationLayer: true,
      keepAnnotationEditorLayer: true,
      keepXfaLayer: true,
      keepTextLayer: true,
      keepCanvasWrapper: true
    });
  }
  updateVisibleArea(visibleArea) {
    if (this.enableDetailCanvas) {
      if (this.#needsRestrictedScaling && this.maxCanvasPixels > 0 && visibleArea) {
        this.detailView ??= new PDFPageDetailView({
          pageView: this,
          enableOptimizedPartialRendering: this.enableOptimizedPartialRendering,
          imagesRightClickMinSize: -1
        });
        this.detailView.update({
          visibleArea
        });
      } else if (this.detailView) {
        this.detailView.reset();
        this.detailView = null;
      }
    }
  }
  update({
    scale = 0,
    rotation = null,
    optionalContentConfigPromise = null,
    drawingDelay = -1
  }) {
    this.scale = scale || this.scale;
    if (typeof rotation === "number") {
      this.rotation = rotation;
    }
    if (optionalContentConfigPromise instanceof Promise) {
      this._optionalContentConfigPromise = optionalContentConfigPromise;
      optionalContentConfigPromise.then(optionalContentConfig => {
        if (optionalContentConfigPromise !== this._optionalContentConfigPromise) {
          return;
        }
        this.#useThumbnailCanvas.initialOptionalContent = optionalContentConfig.hasInitialVisibility;
      });
    }
    this.#useThumbnailCanvas.directDrawing = true;
    const totalRotation = (this.rotation + this.pdfPageRotate) % 360;
    this.viewport = this.viewport.clone({
      scale: this.scale * PixelsPerInch.PDF_TO_CSS_UNITS,
      rotation: totalRotation
    });
    this.#setDimensions();
    if (this._isStandalone) {
      this._container?.style.setProperty("--scale-factor", this.viewport.scale);
    }
    this.#computeScale();
    if (this.canvas) {
      const onlyCssZoom = this.#hasRestrictedScaling && this.#needsRestrictedScaling;
      const postponeDrawing = drawingDelay >= 0 && drawingDelay < 1000;
      if (postponeDrawing || onlyCssZoom) {
        if (postponeDrawing && !onlyCssZoom && this.renderingState !== RenderingStates.FINISHED) {
          this.cancelRendering({
            keepAnnotationLayer: true,
            keepAnnotationEditorLayer: true,
            keepXfaLayer: true,
            keepTextLayer: true,
            cancelExtraDelay: drawingDelay
          });
          this.renderingState = RenderingStates.FINISHED;
          this.#useThumbnailCanvas.directDrawing = false;
        }
        this.cssTransform({
          redrawAnnotationLayer: true,
          redrawAnnotationEditorLayer: true,
          redrawXfaLayer: true,
          redrawTextLayer: !postponeDrawing,
          hideTextLayer: postponeDrawing
        });
        if (!postponeDrawing) {
          this.detailView?.update({
            underlyingViewUpdated: true
          });
          this.dispatchPageRendered(true, false);
        }
        return;
      }
    }
    this.cssTransform({});
    this.annotationEditorLayer?.update(this.viewport);
    this.reset({
      keepAnnotationLayer: true,
      keepAnnotationEditorLayer: true,
      keepXfaLayer: true,
      keepTextLayer: true,
      keepCanvasWrapper: true,
      preserveDetailViewState: true
    });
    this.detailView?.update({
      underlyingViewUpdated: true
    });
  }
  #computeScale() {
    const {
      width,
      height
    } = this.viewport;
    const outputScale = this.outputScale = new OutputScale();
    if (this.maxCanvasPixels === 0) {
      const invScale = 1 / this.scale;
      outputScale.sx *= invScale;
      outputScale.sy *= invScale;
      this.#needsRestrictedScaling = true;
    } else {
      this.#needsRestrictedScaling = outputScale.limitCanvas(width, height, this.maxCanvasPixels, this.maxCanvasDim, this.capCanvasAreaFactor);
      if (this.#needsRestrictedScaling && this.enableDetailCanvas) {
        const factor = this.enableOptimizedPartialRendering ? 4 : 2;
        outputScale.sx /= factor;
        outputScale.sy /= factor;
      }
    }
  }
  cancelRendering({
    keepAnnotationLayer = false,
    keepAnnotationEditorLayer = false,
    keepXfaLayer = false,
    keepTextLayer = false,
    cancelExtraDelay = 0
  } = {}) {
    super.cancelRendering({
      cancelExtraDelay
    });
    if (this.textLayer && (!keepTextLayer || !this.textLayer.div)) {
      this.textLayer.cancel();
      this.textLayer = null;
    }
    if (this.annotationLayer && (!keepAnnotationLayer || !this.annotationLayer.div)) {
      this.annotationLayer.cancel();
      this.annotationLayer = null;
      this._annotationCanvasMap = null;
    }
    if (this.structTreeLayer && !this.textLayer) {
      this.structTreeLayer = null;
    }
    if (this.annotationEditorLayer && (!keepAnnotationEditorLayer || !this.annotationEditorLayer.div || !this.textLayer)) {
      if (this.drawLayer) {
        this.drawLayer.cancel();
        this.drawLayer = null;
      }
      this.annotationEditorLayer.cancel();
      this.annotationEditorLayer = null;
    }
    if (this.drawLayer && !this.textLayer) {
      this.drawLayer.cancel();
      this.drawLayer = null;
    }
    if (this.xfaLayer && (!keepXfaLayer || !this.xfaLayer.div)) {
      this.xfaLayer.cancel();
      this.xfaLayer = null;
      this._textHighlighter?.disable();
    }
  }
  cssTransform({
    redrawAnnotationLayer = false,
    redrawAnnotationEditorLayer = false,
    redrawXfaLayer = false,
    redrawTextLayer = false,
    hideTextLayer = false
  }) {
    const {
      canvas
    } = this;
    if (!canvas) {
      return;
    }
    const originalViewport = this.#originalViewport;
    if (this.viewport !== originalViewport) {
      const relativeRotation = (360 + this.viewport.rotation - originalViewport.rotation) % 360;
      if (relativeRotation === 90 || relativeRotation === 270) {
        const {
          width,
          height
        } = this.viewport;
        const scaleX = height / width;
        const scaleY = width / height;
        canvas.style.transform = `rotate(${relativeRotation}deg) scale(${scaleX},${scaleY})`;
      } else {
        canvas.style.transform = relativeRotation === 0 ? "" : `rotate(${relativeRotation}deg)`;
      }
    }
    if (redrawAnnotationLayer && this.annotationLayer) {
      this.#renderAnnotationLayer();
    }
    if (redrawAnnotationEditorLayer && this.annotationEditorLayer) {
      if (this.drawLayer) {
        this.#renderDrawLayer();
      }
      this.#renderAnnotationEditorLayer();
    }
    if (redrawXfaLayer && this.xfaLayer) {
      this.#renderXfaLayer();
    }
    if (this.textLayer) {
      if (hideTextLayer) {
        this.textLayer.hide();
        this.structTreeLayer?.hide();
      } else if (redrawTextLayer) {
        this.#renderTextLayer();
      }
    }
  }
  get width() {
    return this.viewport.width;
  }
  get height() {
    return this.viewport.height;
  }
  getPagePoint(x, y) {
    return this.viewport.convertToPdfPoint(x, y);
  }
  _ensureCanvasWrapper() {
    let canvasWrapper = this.#canvasWrapper;
    if (!canvasWrapper) {
      canvasWrapper = this.#canvasWrapper = document.createElement("div");
      canvasWrapper.classList.add("canvasWrapper");
      this.#addLayer(canvasWrapper, "canvasWrapper");
    }
    return canvasWrapper;
  }
  _getRenderingContext(canvas, transform, recordOperations, recordImages) {
    return {
      canvas,
      transform,
      viewport: this.viewport,
      annotationMode: this.#annotationMode,
      optionalContentConfigPromise: this._optionalContentConfigPromise,
      annotationCanvasMap: this._annotationCanvasMap,
      pageColors: this.pageColors,
      isEditing: this.#isEditing,
      recordOperations,
      recordImages,
      partialFrames: true
    };
  }
  async draw() {
    if (this.renderingState !== RenderingStates.INITIAL) {
      console.error("Must be in new state before drawing");
      this.reset();
    }
    const {
      div,
      l10n,
      pdfPage,
      viewport
    } = this;
    if (!pdfPage) {
      this.renderingState = RenderingStates.FINISHED;
      throw new Error("pdfPage is not loaded");
    }
    this.renderingState = RenderingStates.RUNNING;
    const canvasWrapper = this._ensureCanvasWrapper();
    if (!this.textLayer && this.#textLayerMode !== TextLayerMode.DISABLE && !pdfPage.isPureXfa) {
      this._accessibilityManager ||= new TextAccessibilityManager();
      this.textLayer = new TextLayerBuilder({
        pdfPage,
        highlighter: this._textHighlighter,
        accessibilityManager: this._accessibilityManager,
        enablePermissions: this.#textLayerMode === TextLayerMode.ENABLE_PERMISSIONS,
        onAppend: textLayerDiv => {
          this.l10n.pause();
          this.#addLayer(textLayerDiv, "textLayer");
          this.l10n.resume();
        },
        abortSignal: this.#abortSignal
      });
      if (this.enableSelectionRendering) {
        this.textLayer.div.classList.add("selectionRendering");
      }
    }
    if (!this.annotationLayer && this.#annotationMode !== AnnotationMode.DISABLE) {
      const {
        annotationStorage,
        annotationEditorUIManager,
        downloadManager,
        enableComment,
        enableScripting,
        fieldObjectsPromise,
        hasJSActionsPromise,
        linkService
      } = this.#layerProperties;
      this._annotationCanvasMap ||= new Map();
      this.annotationLayer = new AnnotationLayerBuilder({
        pdfPage,
        annotationStorage,
        imageResourcesPath: this.imageResourcesPath,
        renderForms: this.#annotationMode === AnnotationMode.ENABLE_FORMS,
        linkService,
        downloadManager,
        enableComment,
        enableScripting,
        hasJSActionsPromise,
        fieldObjectsPromise,
        annotationCanvasMap: this._annotationCanvasMap,
        accessibilityManager: this._accessibilityManager,
        annotationEditorUIManager,
        commentManager: this.#commentManager,
        onAppend: annotationLayerDiv => {
          this.#addLayer(annotationLayerDiv, "annotationLayer");
        }
      });
    }
    const {
      width,
      height
    } = viewport;
    this.#originalViewport = viewport;
    const {
      canvas,
      prevCanvas
    } = this._createCanvas(newCanvas => {
      canvasWrapper.prepend(newCanvas);
    });
    canvas.setAttribute("role", "presentation");
    if (!this.outputScale) {
      this.#computeScale();
    }
    const {
      outputScale
    } = this;
    this.#hasRestrictedScaling = this.#needsRestrictedScaling;
    const sfx = approximateFraction(outputScale.sx);
    const sfy = approximateFraction(outputScale.sy);
    const canvasWidth = canvas.width = floorToDivide(calcRound(width * outputScale.sx), sfx[0]);
    const canvasHeight = canvas.height = floorToDivide(calcRound(height * outputScale.sy), sfy[0]);
    const pageWidth = floorToDivide(calcRound(width), sfx[1]);
    const pageHeight = floorToDivide(calcRound(height), sfy[1]);
    outputScale.sx = canvasWidth / pageWidth;
    outputScale.sy = canvasHeight / pageHeight;
    if (this.#scaleRoundX !== sfx[1]) {
      div.style.setProperty("--scale-round-x", `${sfx[1]}px`);
      this.#scaleRoundX = sfx[1];
    }
    if (this.#scaleRoundY !== sfy[1]) {
      div.style.setProperty("--scale-round-y", `${sfy[1]}px`);
      this.#scaleRoundY = sfy[1];
    }
    const recordBBoxes = this.enableOptimizedPartialRendering && this.#hasRestrictedScaling && !this.recordedBBoxes;
    const recordImages = this.imagesRightClickMinSize !== -1 && !this.imageCoordinates;
    const transform = outputScale.scaled ? [outputScale.sx, 0, 0, outputScale.sy, 0, 0] : null;
    const resultPromise = this._drawCanvas(this._getRenderingContext(canvas, transform, recordBBoxes, recordImages), () => {
      if (prevCanvas) {
        prevCanvas.remove();
        prevCanvas.width = prevCanvas.height = 0;
      }
      this._resetCanvas();
    }, renderTask => {
      this.#useThumbnailCanvas.regularAnnotations = !renderTask.separateAnnots;
      this.dispatchPageRendered(false, false);
    }).then(async () => {
      if (this.renderingState !== RenderingStates.FINISHED) {
        return;
      }
      this.structTreeLayer ||= new StructTreeLayerBuilder(pdfPage, viewport.rawDims);
      const textLayerPromise = this.textLayer ? this.#renderTextLayer() : null;
      if (this.annotationLayer) {
        await this.#renderAnnotationLayer(textLayerPromise);
      }
      this.drawLayer ||= new DrawLayerBuilder({
        pageIndex: this.id,
        textLayer: this.enableSelectionRendering ? this.textLayer?.div : null,
        filterFactory: this.pdfPage?.filterFactory,
        pageColors: this.pageColors
      });
      await this.#renderDrawLayer();
      this.drawLayer.setParent(canvasWrapper);
      const {
        annotationEditorUIManager
      } = this.#layerProperties;
      if (!annotationEditorUIManager) {
        return;
      }
      if (this.annotationLayer || this.#annotationMode === AnnotationMode.DISABLE) {
        this.annotationEditorLayer ||= new AnnotationEditorLayerBuilder({
          uiManager: annotationEditorUIManager,
          pageIndex: this.id - 1,
          l10n,
          structTreeLayer: this.structTreeLayer,
          accessibilityManager: this._accessibilityManager,
          annotationLayer: this.annotationLayer?.annotationLayer,
          textLayer: this.textLayer,
          drawLayer: this.drawLayer.getDrawLayer(),
          onAppend: annotationEditorLayerDiv => {
            this.#addLayer(annotationEditorLayerDiv, "annotationEditorLayer");
          }
        });
        this.#renderAnnotationEditorLayer();
      }
    });
    if (pdfPage.isPureXfa) {
      if (!this.xfaLayer) {
        const {
          annotationStorage,
          linkService
        } = this.#layerProperties;
        this.xfaLayer = new XfaLayerBuilder({
          pdfPage,
          annotationStorage,
          linkService
        });
      }
      this.#renderXfaLayer();
    }
    div.setAttribute("data-loaded", true);
    this.dispatchPageRender();
    return resultPromise;
  }
  setPageLabel(label) {
    this.pageLabel = typeof label === "string" ? label : null;
    this.div.setAttribute("data-l10n-args", JSON.stringify({
      page: this.pageLabel ?? this.id
    }));
    if (this.pageLabel !== null) {
      this.div.setAttribute("data-page-label", this.pageLabel);
    } else {
      this.div.removeAttribute("data-page-label");
    }
  }
  get thumbnailCanvas() {
    const {
      directDrawing,
      initialOptionalContent,
      regularAnnotations
    } = this.#useThumbnailCanvas;
    return directDrawing && initialOptionalContent && regularAnnotations ? this.canvas : null;
  }
}
export { PDFPageView };