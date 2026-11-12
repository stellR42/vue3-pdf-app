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
import "core-js/modules/es.json.parse.js";
import "core-js/modules/es.json.stringify.js";
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import "core-js/modules/web.url.parse.js";
import { animationStarted, apiPageLayoutToViewerModes, apiPageModeToSidebarView, AutoPrintRegExp, CursorTool, DEFAULT_SCALE_VALUE, docStyle, getActiveOrFocusedElement, isValidRotation, isValidScrollMode, isValidSpreadMode, MAX_SCALE, MIN_SCALE, normalizeWheelEventDirection, parseQueryString, ProgressBar, ScrollMode, SidebarView, SpreadMode, TextLayerMode } from "./ui_utils.js";
import { AnnotationEditorType, build, FeatureTest, getDocument, getFilenameFromUrl, getPdfFilenameFromUrl, GlobalWorkerOptions, InvalidPDFException, isDataScheme, isPdfFile, MathClamp, OutputScale, PDFWorker, ResponseException, shadow, stopEvent, TouchManager, updateUrlHash, version } from "../pdf.js";
import { AppOptions, OptionKind } from "./app_options.js";
import { EventBus, FirefoxEventBus } from "./event_utils.js";
import { ExternalServices, initCom, MLManager } from "web-external_services";
import { ImageAltTextSettings, NewAltTextManager } from "web-new_alt_text_manager";
import { LinkTarget, PDFLinkService } from "./pdf_link_service.js";
import { AltTextManager } from "web-alt_text_manager";
import { AnnotationEditorParams } from "web-annotation_editor_params";
import { CaretBrowsingMode } from "./caret_browsing.js";
import { CommentManager } from "./comment_manager.js";
import { DownloadManager } from "web-download_manager";
import { EditorUndoBar } from "./editor_undo_bar.js";
import { internalOpt } from "./internal_evt.js";
import { OverlayManager } from "./overlay_manager.js";
import { PasswordPrompt } from "./password_prompt.js";
import { PDFAttachmentViewer } from "web-pdf_attachment_viewer";
import { PDFCursorTools } from "web-pdf_cursor_tools";
import { PDFDocumentProperties } from "web-pdf_document_properties";
import { PDFFindBar } from "web-pdf_find_bar";
import { PDFFindController } from "./pdf_find_controller.js";
import { PDFHistory } from "./pdf_history.js";
import { PDFLayerViewer } from "web-pdf_layer_viewer";
import { PDFOutlineViewer } from "web-pdf_outline_viewer";
import { PDFPresentationMode } from "web-pdf_presentation_mode";
import { PDFPrintServiceFactory } from "web-print_service";
import { PDFRenderingQueue } from "./pdf_rendering_queue.js";
import { PDFScriptingManager } from "./pdf_scripting_manager.js";
import { PdfTextExtractor } from "./pdf_text_extractor.js";
import { PDFThumbnailViewer } from "web-pdf_thumbnail_viewer";
import { PDFViewer } from "./pdf_viewer.js";
import { Preferences } from "web-preferences";
import { RenderingStates } from "./renderable_view.js";
import { SecondaryToolbar } from "web-secondary_toolbar";
import { SignatureManager } from "web-signature_manager";
import { SignaturePropertiesManager } from "web-digital_signature_properties_manager";
import { Toolbar } from "web-toolbar";
import { ViewHistory } from "./view_history.js";
import { ViewsManager } from "web-views_manager";
const FORCE_PAGES_LOADED_TIMEOUT = 10000;
const ViewOnLoad = {
  UNKNOWN: -1,
  PREVIOUS: 0,
  INITIAL: 1
};
const PDFViewerApplication = {
  initialBookmark: document.location.hash.substring(1),
  _initializedCapability: {
    ...Promise.withResolvers(),
    settled: false
  },
  appConfig: null,
  pdfDocument: null,
  pdfLoadingTask: null,
  printService: null,
  pdfViewer: null,
  pdfThumbnailViewer: null,
  pdfRenderingQueue: null,
  pdfPresentationMode: null,
  pdfDocumentProperties: null,
  pdfLinkService: null,
  pdfTextExtractor: null,
  pdfHistory: null,
  viewsManager: null,
  pdfOutlineViewer: null,
  pdfAttachmentViewer: null,
  pdfLayerViewer: null,
  pdfCursorTools: null,
  pdfScriptingManager: null,
  store: null,
  downloadManager: null,
  overlayManager: null,
  preferences: new Preferences(),
  toolbar: null,
  secondaryToolbar: null,
  eventBus: null,
  l10n: null,
  annotationEditorParams: null,
  signaturePropertiesManager: null,
  imageAltTextSettings: null,
  isInitialViewSet: false,
  isViewerEmbedded: window.parent !== window,
  url: "",
  baseUrl: "",
  mlManager: null,
  _downloadUrl: "",
  _isMergedDocument: false,
  _eventBusAC: null,
  _windowAC: null,
  _globalAbortController: new AbortController(),
  documentInfo: null,
  metadata: null,
  _contentDispositionFilename: null,
  _contentLength: null,
  _saveInProgress: false,
  _wheelUnusedTicks: 0,
  _wheelUnusedFactor: 1,
  _touchManager: null,
  _touchUnusedTicks: 0,
  _touchUnusedFactor: 1,
  _PDFBug: null,
  _hasAnnotationEditors: false,
  _title: document.title,
  _printAnnotationStoragePromise: null,
  _isCtrlKeyDown: false,
  _caretBrowsing: null,
  _isScrolling: false,
  editorUndoBar: null,
  _printPermissionPromise: null,
  async initialize(appConfig) {
    this.appConfig = appConfig;
    try {
      await this.preferences.initializedPromise;
    } catch (ex) {
      console.error("initialize:", ex);
    }
    if (AppOptions.get("pdfBugEnabled")) {
      await this._parseHashParams();
    }
    let mode;
    switch (AppOptions.get("viewerCssTheme")) {
      case 1:
        mode = "light";
        break;
      case 2:
        mode = "dark";
        break;
    }
    if (mode) {
      docStyle.setProperty("color-scheme", mode);
    }
    this.l10n = await this.externalServices.createL10n();
    document.getElementsByTagName("html")[0].dir = this.l10n.getDirection();
    this.l10n.translate(appConfig.appContainer || document.documentElement);
    if (this.isViewerEmbedded && AppOptions.get("externalLinkTarget") === LinkTarget.NONE) {
      AppOptions.set("externalLinkTarget", LinkTarget.TOP);
    }
    await this._initializeViewerComponents();
    this.bindEvents();
    this.bindWindowEvents();
    this._initializedCapability.settled = true;
    this._initializedCapability.resolve();
  },
  async _parseHashParams() {
    const hash = document.location.hash.substring(1);
    if (!hash) {
      return;
    }
    const {
        mainContainer,
        viewerContainer
      } = this.appConfig,
      params = parseQueryString(hash);
    const loadPDFBug = async () => {
      if (this._PDFBug) {
        return;
      }
      const {
        PDFBug
      } = await import(
      /*webpackIgnore: true*/
      /*@vite-ignore*/
      AppOptions.get("debuggerSrc"));
      this._PDFBug = PDFBug;
    };
    if (params.get("disableworker") === "true") {
      try {
        GlobalWorkerOptions.workerSrc ||= AppOptions.get("workerSrc");
        await import(
        /*webpackIgnore: true*/
        /*@vite-ignore*/
        PDFWorker.workerSrc);
        AppOptions.set("workerPort", null);
      } catch (ex) {
        console.error("_parseHashParams:", ex);
      }
    }
    if (params.has("textlayer")) {
      switch (params.get("textlayer")) {
        case "off":
          AppOptions.set("textLayerMode", TextLayerMode.DISABLE);
          break;
        case "visible":
        case "shadow":
        case "hover":
          viewerContainer.classList.add(`textLayer-${params.get("textlayer")}`);
          try {
            await loadPDFBug();
            this._PDFBug.loadCSS();
          } catch (ex) {
            console.error("_parseHashParams:", ex);
          }
          break;
      }
    }
    if (params.has("pdfbug")) {
      const enabled = params.get("pdfbug").split(",");
      try {
        await loadPDFBug();
        this._PDFBug.init(mainContainer, enabled);
      } catch (ex) {
        console.error("_parseHashParams:", ex);
      }
      const debugOpts = {
        pdfBug: true,
        fontExtraProperties: true
      };
      if (globalThis.StepperManager?.enabled) {
        debugOpts.minDurationToUpdateCanvas = 0;
      }
      AppOptions.setAll(debugOpts);
    }
    if (params.has("locale")) {
      AppOptions.set("localeProperties", {
        lang: params.get("locale")
      });
    }
    const opts = {
      disableAutoFetch: x => x === "true",
      disableFontFace: x => x === "true",
      disableHistory: x => x === "true",
      disableRange: x => x === "true",
      disableStream: x => x === "true",
      verbosity: x => x | 0
    };
    for (const name in opts) {
      const check = opts[name],
        key = name.toLowerCase();
      if (params.has(key)) {
        AppOptions.set(name, check(params.get(key)));
      }
    }
  },
  async _initializeViewerComponents() {
    const {
      appConfig,
      externalServices,
      l10n,
      mlManager
    } = this;
    const abortSignal = this._globalAbortController.signal;
    const eventBus = new EventBus();
    this.eventBus = AppOptions.eventBus = eventBus;
    mlManager?.setEventBus(eventBus, abortSignal);
    const overlayManager = this.overlayManager = new OverlayManager();
    const renderingQueue = this.pdfRenderingQueue = new PDFRenderingQueue();
    renderingQueue.onIdle = this._cleanup.bind(this);
    const linkService = this.pdfLinkService = new PDFLinkService({
      eventBus,
      externalLinkTarget: AppOptions.get("externalLinkTarget"),
      externalLinkRel: AppOptions.get("externalLinkRel"),
      ignoreDestinationZoom: AppOptions.get("ignoreDestinationZoom")
    });
    const supportsDownloading = AppOptions.get("supportsDownloading");
    const downloadManager = this.downloadManager = supportsDownloading ? new DownloadManager() : null;
    if (appConfig.secondaryToolbar?.downloadButton) {
      appConfig.secondaryToolbar.downloadButton.hidden = !supportsDownloading;
    }
    if (appConfig.toolbar?.download) {
      appConfig.toolbar.download.hidden = !supportsDownloading;
    }
    const findController = this.findController = new PDFFindController({
      linkService,
      eventBus,
      updateMatchesCountOnProgress: true
    });
    const pdfScriptingManager = this.pdfScriptingManager = new PDFScriptingManager({
      eventBus,
      externalServices,
      docProperties: this._scriptingDocProperties.bind(this)
    });
    const container = appConfig.mainContainer,
      viewer = appConfig.viewerContainer;
    const annotationEditorMode = AppOptions.get("annotationEditorMode");
    const hasForcedColors = AppOptions.get("forcePageColors") || window.matchMedia("(forced-colors: active)").matches;
    const pageColors = hasForcedColors ? {
      background: AppOptions.get("pageColorsBackground"),
      foreground: AppOptions.get("pageColorsForeground")
    } : null;
    const enableMerge = AppOptions.get("enableMerge");
    const enableSplitMerge = AppOptions.get("enableSplitMerge");
    let altTextManager;
    if (AppOptions.get("enableUpdatedAddImage")) {
      altTextManager = appConfig.newAltTextDialog ? new NewAltTextManager(appConfig.newAltTextDialog, overlayManager, eventBus) : null;
    } else {
      altTextManager = appConfig.altTextDialog ? new AltTextManager(appConfig.altTextDialog, container, overlayManager, eventBus) : null;
    }
    if (appConfig.editorUndoBar) {
      this.editorUndoBar = new EditorUndoBar(appConfig.editorUndoBar, eventBus);
    }
    let signatureManager = null;
    if (AppOptions.get("enableSignatureEditor")) {
      if (appConfig.addSignatureDialog) {
        signatureManager = new SignatureManager(appConfig.addSignatureDialog, appConfig.editSignatureDialog, appConfig.annotationEditorParams?.editorSignatureAddSignature || null, overlayManager, l10n, externalServices.createSignatureStorage(eventBus, abortSignal), eventBus);
      }
    }
    const commentManager = AppOptions.get("enableComment") && appConfig.editCommentDialog ? new CommentManager(appConfig.editCommentDialog, {
      learnMoreUrl: AppOptions.get("commentLearnMoreUrl"),
      sidebar: appConfig.annotationEditorParams?.editorCommentsSidebar || null,
      sidebarResizer: appConfig.annotationEditorParams?.editorCommentsSidebarResizer || null,
      commentsList: appConfig.annotationEditorParams?.editorCommentsSidebarList || null,
      commentCount: appConfig.annotationEditorParams?.editorCommentsSidebarCount || null,
      sidebarTitle: appConfig.annotationEditorParams?.editorCommentsSidebarTitle || null,
      closeButton: appConfig.annotationEditorParams?.editorCommentsSidebarCloseButton || null,
      commentToolbarButton: appConfig.toolbar?.editorCommentButton || null
    }, eventBus, linkService, overlayManager, l10n.getDirection() === "ltr", hasForcedColors, abortSignal) : null;
    const maxCanvasPixels = AppOptions.get("maxCanvasPixels"),
      maxCanvasDim = AppOptions.get("maxCanvasDim"),
      capCanvasAreaFactor = AppOptions.get("capCanvasAreaFactor");
    const pdfViewer = this.pdfViewer = new PDFViewer({
      container,
      viewer,
      viewerAlert: appConfig.viewerAlert,
      eventBus,
      renderingQueue,
      linkService,
      downloadManager,
      altTextManager,
      commentManager,
      signatureManager,
      editorUndoBar: this.editorUndoBar,
      findController,
      scriptingManager: AppOptions.get("enableScripting") && pdfScriptingManager,
      l10n,
      textLayerMode: AppOptions.get("textLayerMode"),
      annotationMode: AppOptions.get("annotationMode"),
      annotationEditorMode,
      annotationEditorHighlightColors: AppOptions.get("highlightEditorColors"),
      enableHighlightFloatingButton: AppOptions.get("enableHighlightFloatingButton"),
      enableUpdatedAddImage: AppOptions.get("enableUpdatedAddImage"),
      enableNewAltTextWhenAddingImage: AppOptions.get("enableNewAltTextWhenAddingImage"),
      imageResourcesPath: AppOptions.get("imageResourcesPath"),
      enablePrintAutoRotate: AppOptions.get("enablePrintAutoRotate"),
      maxCanvasPixels,
      maxCanvasDim,
      capCanvasAreaFactor,
      enableDetailCanvas: AppOptions.get("enableDetailCanvas"),
      enablePermissions: AppOptions.get("enablePermissions"),
      enableOptimizedPartialRendering: AppOptions.get("enableOptimizedPartialRendering"),
      enableSelectionRendering: AppOptions.get("enableSelectionRendering"),
      imagesRightClickMinSize: AppOptions.get("imagesRightClickMinSize"),
      pageColors,
      mlManager,
      abortSignal,
      supportsPinchToZoom: this.supportsPinchToZoom,
      enableAutoLinking: AppOptions.get("enableAutoLinking"),
      minDurationToUpdateCanvas: AppOptions.get("minDurationToUpdateCanvas")
    });
    renderingQueue.setViewer(pdfViewer);
    linkService.setViewer(pdfViewer);
    pdfScriptingManager.setViewer(pdfViewer);
    if (appConfig.viewsManager?.thumbnailsView) {
      const {
        viewsManager
      } = appConfig;
      this.pdfThumbnailViewer = new PDFThumbnailViewer({
        container: viewsManager.thumbnailsView,
        eventBus,
        renderingQueue,
        linkService,
        l10n,
        maxCanvasPixels,
        maxCanvasDim,
        pageColors,
        abortSignal,
        enableSplitMerge,
        enableMerge,
        enableNewBadge: AppOptions.get("enableNewBadge"),
        statusBar: viewsManager.viewsManagerStatusBar,
        undoBar: viewsManager.viewsManagerUndoBar,
        manageMenu: viewsManager.manageMenu,
        waitingBar: viewsManager.viewsManagerWaitingBar,
        addFileComponent: viewsManager.viewsManagerAddFile
      });
      renderingQueue.setThumbnailViewer(this.pdfThumbnailViewer);
    }
    if (!this.isViewerEmbedded && !AppOptions.get("disableHistory")) {
      this.pdfHistory = new PDFHistory({
        linkService,
        eventBus
      });
      linkService.setHistory(this.pdfHistory);
    }
    if (!this.supportsIntegratedFind && appConfig.findBar) {
      this.findBar = new PDFFindBar(appConfig.findBar, appConfig.principalContainer, eventBus);
    }
    if (appConfig.annotationEditorParams) {
      if (annotationEditorMode !== AnnotationEditorType.DISABLE) {
        const editorSignatureButton = appConfig.toolbar?.editorSignatureButton;
        if (editorSignatureButton && AppOptions.get("enableSignatureEditor")) {
          editorSignatureButton.parentElement.hidden = false;
        }
        const editorCommentButton = appConfig.toolbar?.editorCommentButton;
        if (editorCommentButton && AppOptions.get("enableComment")) {
          editorCommentButton.parentElement.hidden = false;
        }
        this.annotationEditorParams = new AnnotationEditorParams(appConfig.annotationEditorParams, eventBus);
      } else {
        for (const id of ["editorModeButtons", "editorModeSeparator"]) {
          document.getElementById(id)?.classList.add("hidden");
        }
      }
    }
    if (mlManager && appConfig.secondaryToolbar?.imageAltTextSettingsButton) {
      this.imageAltTextSettings = new ImageAltTextSettings(appConfig.altTextSettingsDialog, overlayManager, eventBus, mlManager);
    }
    if (appConfig.documentProperties) {
      this.pdfDocumentProperties = new PDFDocumentProperties(appConfig.documentProperties, overlayManager, eventBus, l10n, () => this._docFilename, () => this._docTitle);
    }
    if (appConfig.secondaryToolbar?.cursorHandToolButton) {
      this.pdfCursorTools = new PDFCursorTools({
        container,
        eventBus,
        cursorToolOnLoad: AppOptions.get("cursorToolOnLoad")
      });
    }
    if (appConfig.toolbar) {
      this.toolbar = new Toolbar(appConfig.toolbar, eventBus, AppOptions.get("toolbarDensity"));
    }
    if (appConfig.secondaryToolbar) {
      if (AppOptions.get("enableAltText") && this.imageAltTextSettings) {
        appConfig.secondaryToolbar.imageAltTextSettingsButton?.classList.remove("hidden");
        appConfig.secondaryToolbar.imageAltTextSettingsSeparator?.classList.remove("hidden");
      }
      this.secondaryToolbar = new SecondaryToolbar(appConfig.secondaryToolbar, eventBus);
    }
    if (this.supportsFullscreen && appConfig.secondaryToolbar?.presentationModeButton) {
      this.pdfPresentationMode = new PDFPresentationMode({
        container,
        pdfViewer,
        eventBus
      });
    }
    if (appConfig.passwordOverlay) {
      this.passwordPrompt = new PasswordPrompt(appConfig.passwordOverlay, overlayManager, this.isViewerEmbedded);
    }
    if (appConfig.viewsManager?.outlinesView) {
      this.pdfOutlineViewer = new PDFOutlineViewer({
        container: appConfig.viewsManager.outlinesView,
        eventBus,
        l10n,
        linkService,
        downloadManager
      });
    }
    if (appConfig.viewsManager?.attachmentsView) {
      this.pdfAttachmentViewer = new PDFAttachmentViewer({
        container: appConfig.viewsManager.attachmentsView,
        eventBus,
        l10n,
        downloadManager,
        linkService
      });
    }
    if (appConfig.viewsManager?.layersView) {
      this.pdfLayerViewer = new PDFLayerViewer({
        container: appConfig.viewsManager.layersView,
        eventBus,
        l10n
      });
    }
    if (appConfig.viewsManager) {
      this.viewsManager = new ViewsManager({
        elements: appConfig.viewsManager,
        eventBus,
        l10n,
        enableMerge,
        enableSplitMerge,
        globalAbortSignal: abortSignal
      });
      this.viewsManager.onToggled = this.forceRendering.bind(this);
      this.viewsManager.onUpdateThumbnails = () => {
        for (const pageView of pdfViewer.getCachedPageViews()) {
          if (pageView.renderingState === RenderingStates.FINISHED) {
            this.pdfThumbnailViewer.getThumbnail(pageView.id - 1)?.setImage(pageView);
          }
        }
        this.pdfThumbnailViewer.scrollThumbnailIntoView(pdfViewer.currentPageNumber);
      };
    }
  },
  async run(config) {
    await this.initialize(config);
    const {
      appConfig,
      eventBus
    } = this;
    let file;
    const queryString = document.location.search.substring(1);
    const params = parseQueryString(queryString);
    file = params.get("file") ?? AppOptions.get("defaultUrl");
    file = URL.parse(file)?.href ?? file.replaceAll("#", "%23");
    validateFileURL(file);
    const fileInput = this._openFileInput = document.createElement("input");
    fileInput.id = "fileInput";
    fileInput.hidden = true;
    fileInput.type = "file";
    fileInput.value = null;
    document.body.append(fileInput);
    fileInput.addEventListener("change", function (evt) {
      const {
        files
      } = evt.target;
      if (!files?.length) {
        return;
      }
      eventBus.dispatch("fileinputchange", {
        source: this,
        fileInput: evt.target
      });
    });
    appConfig.mainContainer.addEventListener("dragover", function (evt) {
      for (const item of evt.dataTransfer.items) {
        if (item.type === "application/pdf") {
          evt.dataTransfer.dropEffect = evt.dataTransfer.effectAllowed === "copy" ? "copy" : "move";
          stopEvent(evt);
          return;
        }
      }
    });
    appConfig.mainContainer.addEventListener("drop", function (evt) {
      if (evt.dataTransfer.files?.[0].type !== "application/pdf") {
        return;
      }
      stopEvent(evt);
      eventBus.dispatch("fileinputchange", {
        source: this,
        fileInput: evt.dataTransfer
      });
    });
    if (!AppOptions.get("supportsDocumentFonts")) {
      AppOptions.set("disableFontFace", true);
      this.l10n.get("pdfjs-web-fonts-disabled").then(msg => {
        console.warn(msg);
      });
    }
    const togglePrintingButtons = visible => {
      appConfig.toolbar?.print?.classList.toggle("hidden", !visible);
      appConfig.secondaryToolbar?.printButton.classList.toggle("hidden", !visible);
    };
    if (!this.supportsPrinting) {
      togglePrintingButtons(false);
    } else {
      eventBus.on("printingallowed", ({
        isAllowed
      }) => togglePrintingButtons(isAllowed), internalOpt);
    }
    if (!this.supportsFullscreen) {
      appConfig.secondaryToolbar?.presentationModeButton.classList.add("hidden");
    }
    if (this.supportsIntegratedFind) {
      appConfig.findBar?.toggleButton?.classList.add("hidden");
    }
    if (file) {
      this.open({
        url: file
      });
    } else {
      this._hideViewBookmark();
    }
  },
  get externalServices() {
    return shadow(this, "externalServices", new ExternalServices());
  },
  get initialized() {
    return this._initializedCapability.settled;
  },
  get initializedPromise() {
    return this._initializedCapability.promise;
  },
  updateZoom(steps, scaleFactor, origin, pan = null) {
    if (this.pdfViewer.isInPresentationMode) {
      return;
    }
    this.pdfViewer.updateScale({
      drawingDelay: AppOptions.get("defaultZoomDelay"),
      steps,
      scaleFactor,
      origin,
      pan
    });
  },
  zoomIn() {
    this.updateZoom(1);
  },
  zoomOut() {
    this.updateZoom(-1);
  },
  zoomReset() {
    if (this.pdfViewer.isInPresentationMode) {
      return;
    }
    this.pdfViewer.currentScaleValue = DEFAULT_SCALE_VALUE;
  },
  touchPinchCallback(origin, prevDistance, distance, panX, panY) {
    const pan = [panX, panY];
    if (this.supportsPinchToZoom) {
      const newScaleFactor = this._accumulateFactor(this.pdfViewer.currentScale, distance / prevDistance, "_touchUnusedFactor");
      this.updateZoom(null, newScaleFactor, origin, pan);
    } else {
      const PIXELS_PER_LINE_SCALE = 30;
      const ticks = this._accumulateTicks((distance - prevDistance) / PIXELS_PER_LINE_SCALE, "_touchUnusedTicks");
      this.updateZoom(ticks, null, origin, pan);
    }
  },
  touchPanCallback(dx, dy) {
    const {
      pdfViewer
    } = this;
    if (!this.pdfDocument || pdfViewer.isInPresentationMode) {
      return;
    }
    pdfViewer.panBy(dx, dy);
  },
  touchPinchEndCallback() {
    this._touchUnusedTicks = 0;
    this._touchUnusedFactor = 1;
  },
  get pagesCount() {
    return this.pdfDocument ? this.pdfDocument.numPages : 0;
  },
  get page() {
    return this.pdfViewer.currentPageNumber;
  },
  set page(val) {
    this.pdfViewer.currentPageNumber = val;
  },
  get supportsPrinting() {
    return shadow(this, "supportsPrinting", AppOptions.get("supportsPrinting") && PDFPrintServiceFactory.supportsPrinting);
  },
  get supportsFullscreen() {
    return shadow(this, "supportsFullscreen", document.fullscreenEnabled);
  },
  get supportsPinchToZoom() {
    return shadow(this, "supportsPinchToZoom", AppOptions.get("supportsPinchToZoom"));
  },
  get supportsIntegratedFind() {
    return shadow(this, "supportsIntegratedFind", AppOptions.get("supportsIntegratedFind"));
  },
  get loadingBar() {
    const barElement = document.getElementById("loadingBar");
    const bar = barElement ? new ProgressBar(barElement) : null;
    return shadow(this, "loadingBar", bar);
  },
  get supportsMouseWheelZoomCtrlKey() {
    return shadow(this, "supportsMouseWheelZoomCtrlKey", AppOptions.get("supportsMouseWheelZoomCtrlKey"));
  },
  get supportsMouseWheelZoomMetaKey() {
    return shadow(this, "supportsMouseWheelZoomMetaKey", AppOptions.get("supportsMouseWheelZoomMetaKey"));
  },
  get supportsCaretBrowsingMode() {
    return AppOptions.get("supportsCaretBrowsingMode");
  },
  moveCaret(isUp, select) {
    this._caretBrowsing ||= new CaretBrowsingMode(this._globalAbortController.signal, this.appConfig.mainContainer, this.appConfig.viewerContainer, this.appConfig.toolbar?.container);
    this._caretBrowsing.moveCaret(isUp, select);
  },
  setTitleUsingUrl(url = "", downloadUrl = null) {
    this.url = url;
    this.baseUrl = updateUrlHash(url, "", true);
    if (downloadUrl) {
      this._downloadUrl = downloadUrl === url ? this.baseUrl : updateUrlHash(downloadUrl, "", true);
    }
    if (isDataScheme(url)) {
      this._hideViewBookmark();
    }
    let title = getPdfFilenameFromUrl(url, "");
    if (!title) {
      try {
        title = decodeURIComponent(getFilenameFromUrl(url));
      } catch {}
    }
    this.setTitle(title || url);
  },
  setTitle(title = this._title) {
    this._title = title;
    if (this.isViewerEmbedded) {
      return;
    }
    const hasChangesIndicator = this._hasChanges() && !this.pdfRenderingQueue.printing;
    document.title = `${hasChangesIndicator ? "* " : ""}${title}`;
  },
  get _docFilename() {
    return this._contentDispositionFilename || getPdfFilenameFromUrl(this.url);
  },
  get _docTitle() {
    const {
      documentInfo,
      metadata
    } = this;
    const title = metadata?.get("dc:title");
    if (title) {
      if (title !== "Untitled" && !/[\uFFF0-\uFFFF]/.test(title)) {
        return title;
      }
    }
    return documentInfo.Title;
  },
  _hideViewBookmark() {
    const {
      secondaryToolbar
    } = this.appConfig;
    secondaryToolbar?.viewBookmarkButton.classList.add("hidden");
    if (secondaryToolbar?.presentationModeButton.classList.contains("hidden")) {
      document.getElementById("viewBookmarkSeparator")?.classList.add("hidden");
    }
  },
  async close() {
    this._unblockDocumentLoadEvent();
    this._hideViewBookmark();
    if (!this.pdfLoadingTask) {
      return;
    }
    if (this._hasChanges() && this._annotationStorageModified) {
      try {
        await this.downloadOrSave();
      } catch {}
    }
    const promises = [];
    promises.push(this.pdfLoadingTask.destroy());
    this.pdfLoadingTask = null;
    if (this.pdfDocument) {
      this.pdfDocument = null;
      this.pdfThumbnailViewer?.setDocument(null);
      this.pdfViewer.setDocument(null);
      this.pdfLinkService.setDocument(null);
      this.pdfDocumentProperties?.setDocument(null);
      this.signaturePropertiesManager?.setDocument(null);
    }
    this.pdfLinkService.externalLinkEnabled = true;
    this.store = null;
    this.isInitialViewSet = false;
    this.url = "";
    this.baseUrl = "";
    this._downloadUrl = "";
    this._isMergedDocument = false;
    this.documentInfo = null;
    this.metadata = null;
    this._contentDispositionFilename = null;
    this._contentLength = null;
    this._saveInProgress = false;
    this._hasAnnotationEditors = false;
    promises.push(this.pdfScriptingManager.destroyPromise, this.passwordPrompt.close());
    this.setTitle();
    this.viewsManager?.reset();
    this.pdfOutlineViewer?.reset();
    this.pdfAttachmentViewer?.reset();
    this.pdfLayerViewer?.reset();
    this.pdfHistory?.reset();
    this.findBar?.reset();
    this.toolbar?.reset();
    this.secondaryToolbar?.reset();
    this._PDFBug?.cleanup();
    await Promise.all(promises);
  },
  async open(args) {
    if (this.pdfLoadingTask) {
      await this.close();
    }
    const workerParams = AppOptions.getAll(OptionKind.WORKER);
    Object.assign(GlobalWorkerOptions, workerParams);
    if (args.data && isPdfFile(args.filename)) {
      this._contentDispositionFilename = args.filename;
    } else if (args.url) {
      this.setTitleUsingUrl(args.originalUrl || args.url, args.url);
    }
    const apiParams = AppOptions.getAll(OptionKind.API);
    const loadingTask = getDocument({
      ...apiParams,
      ...args
    });
    this.pdfLoadingTask = loadingTask;
    loadingTask.onPassword = (updateCallback, reason) => {
      if (this.isViewerEmbedded) {
        this._unblockDocumentLoadEvent();
      }
      this.pdfLinkService.externalLinkEnabled = false;
      this.passwordPrompt.setUpdateCallback(updateCallback, reason);
      this.passwordPrompt.open();
    };
    loadingTask.onProgress = evt => this.progress(evt.percent);
    return loadingTask.promise.then(pdfDocument => {
      this.load(pdfDocument);
    }, reason => {
      if (loadingTask !== this.pdfLoadingTask) {
        return undefined;
      }
      if (this.loadingBar) {
        this.loadingBar.percent ||= 0;
      }
      let key = "pdfjs-loading-error";
      if (reason instanceof InvalidPDFException) {
        key = "pdfjs-invalid-file-error";
      } else if (reason instanceof ResponseException) {
        key = reason.missing ? "pdfjs-missing-file-error" : "pdfjs-unexpected-response-error";
      }
      return this._documentError(key, {
        message: reason.message
      }).then(() => {
        throw reason;
      });
    });
  },
  async download() {
    if (!this.downloadManager) {
      return;
    }
    let data;
    try {
      data = await (this.pdfDocument ? this.pdfDocument.getData() : this.pdfLoadingTask.getData());
    } catch {}
    this.downloadManager.download(data, this._downloadUrl, this._docFilename, this._isMergedDocument);
  },
  async save() {
    if (!this.downloadManager) {
      return;
    }
    if (this._saveInProgress) {
      return;
    }
    this._saveInProgress = true;
    const {
      pdfDocument
    } = this;
    try {
      await this.pdfScriptingManager.dispatchWillSave();
      const data = await pdfDocument.saveDocument(this.externalServices.printToPDF);
      this.downloadManager.download(data, this._downloadUrl, this._docFilename, true);
    } catch (reason) {
      console.error(`Error when saving the document:`, reason);
      if (pdfDocument === this.pdfDocument) {
        await this.download();
      }
    } finally {
      try {
        if (pdfDocument === this.pdfDocument) {
          await this.pdfScriptingManager.dispatchDidSave();
        }
      } finally {
        this._saveInProgress = false;
      }
    }
    const editorStats = this.pdfDocument?.annotationStorage.editorStats;
    if (editorStats) {
      this.externalServices.reportTelemetry({
        type: "editing",
        data: {
          type: "save",
          stats: editorStats
        }
      });
    }
  },
  async downloadOrSave() {
    if (!this.downloadManager) {
      return;
    }
    this.pdfViewer._layerProperties.annotationEditorUIManager?.endCurrentEditing();
    const {
      classList
    } = this.appConfig.appContainer;
    classList.add("wait");
    try {
      if (this.pdfThumbnailViewer?.hasStructuralChanges()) {
        this.externalServices.reportTelemetry({
          type: "pageOrganization",
          data: {
            action: "save"
          }
        });
        await this.onSavePages({
          data: this.pdfThumbnailViewer.getStructuralChanges()
        });
      } else {
        await (this.pdfDocument?.annotationStorage.size > 0 ? this.save() : this.download());
      }
      delete this._mergedDocumentNeedsSaving;
    } finally {
      this.setTitle();
      classList.remove("wait");
    }
  },
  async _documentError(key, moreInfo = null) {
    this._unblockDocumentLoadEvent();
    const message = await this._otherError(key || "pdfjs-loading-error", moreInfo);
    this.eventBus.dispatch("documenterror", {
      source: this,
      message,
      reason: moreInfo?.message ?? null
    });
  },
  async _otherError(key, moreInfo = null) {
    const message = await this.l10n.get(key);
    const moreInfoText = [`PDF.js v${version || "?"} (build: ${build || "?"})`];
    if (moreInfo) {
      moreInfoText.push(`Message: ${moreInfo.message}`);
      if (moreInfo.stack) {
        moreInfoText.push(`Stack: ${moreInfo.stack}`);
      } else {
        if (moreInfo.filename) {
          moreInfoText.push(`File: ${moreInfo.filename}`);
        }
        if (moreInfo.lineNumber) {
          moreInfoText.push(`Line: ${moreInfo.lineNumber}`);
        }
      }
    }
    console.error(`${message}\n\n${moreInfoText.join("\n")}`);
    return message;
  },
  progress(percent) {
    if (!this.loadingBar || percent <= this.loadingBar.percent) {
      return;
    }
    this.loadingBar.percent = percent;
    if (this.pdfDocument?.loadingParams.disableAutoFetch ?? AppOptions.get("disableAutoFetch")) {
      this.loadingBar.setDisableAutoFetch();
    }
  },
  load(pdfDocument) {
    this.pdfDocument = pdfDocument;
    this._printPermissionPromise = new Promise(resolve => {
      this.eventBus.on("printingallowed", ({
        isAllowed
      }) => {
        resolve(isAllowed);
      }, {
        once: true,
        ...internalOpt
      });
    });
    pdfDocument.getDownloadInfo().then(({
      length
    }) => {
      this._contentLength = length;
      this.loadingBar?.hide();
      firstPagePromise.then(() => {
        this.eventBus.dispatch("documentloaded", {
          source: this
        });
      });
    });
    const pageLayoutPromise = pdfDocument.getPageLayout().catch(() => {});
    const pageModePromise = pdfDocument.getPageMode().catch(() => {});
    const openActionPromise = pdfDocument.getOpenAction().catch(() => {});
    this.toolbar?.setPagesCount(pdfDocument.numPages, false);
    this.secondaryToolbar?.setPagesCount(pdfDocument.numPages);
    this.pdfLinkService.setDocument(pdfDocument);
    this.pdfDocumentProperties?.setDocument(pdfDocument);
    const pdfViewer = this.pdfViewer;
    pdfViewer.setDocument(pdfDocument);
    const {
      firstPagePromise,
      onePageRendered,
      pagesPromise
    } = pdfViewer;
    this.pdfThumbnailViewer?.setDocument(pdfDocument);
    const storedPromise = (this.store = new ViewHistory(pdfDocument.fingerprints[0])).getMultiple({
      page: null,
      zoom: DEFAULT_SCALE_VALUE,
      scrollLeft: "0",
      scrollTop: "0",
      rotation: null,
      sidebarView: SidebarView.UNKNOWN,
      scrollMode: ScrollMode.UNKNOWN,
      spreadMode: SpreadMode.UNKNOWN
    }).catch(() => {});
    firstPagePromise.then(pdfPage => {
      this.loadingBar?.setWidth(this.appConfig.viewerContainer);
      this._initializeAnnotationStorageCallbacks(pdfDocument);
      Promise.all([animationStarted, storedPromise, pageLayoutPromise, pageModePromise, openActionPromise]).then(async ([timeStamp, stored, pageLayout, pageMode, openAction]) => {
        const viewOnLoad = AppOptions.get("viewOnLoad");
        this._initializePdfHistory({
          fingerprint: pdfDocument.fingerprints[0],
          viewOnLoad,
          initialDest: openAction?.get("dest")
        });
        const initialBookmark = this.initialBookmark;
        const zoom = AppOptions.get("defaultZoomValue");
        let hash = zoom ? `zoom=${zoom}` : null;
        let rotation = null;
        let sidebarView = AppOptions.get("sidebarViewOnLoad");
        let scrollMode = AppOptions.get("scrollModeOnLoad");
        let spreadMode = AppOptions.get("spreadModeOnLoad");
        if (stored?.page && viewOnLoad !== ViewOnLoad.INITIAL) {
          hash = `page=${stored.page}&zoom=${zoom || stored.zoom},` + `${stored.scrollLeft},${stored.scrollTop}`;
          rotation = parseInt(stored.rotation, 10);
          if (sidebarView === SidebarView.UNKNOWN) {
            sidebarView = stored.sidebarView | 0;
          }
          if (scrollMode === ScrollMode.UNKNOWN) {
            scrollMode = stored.scrollMode | 0;
          }
          if (spreadMode === SpreadMode.UNKNOWN) {
            spreadMode = stored.spreadMode | 0;
          }
        }
        if (pageMode && sidebarView === SidebarView.UNKNOWN) {
          sidebarView = apiPageModeToSidebarView(pageMode);
        }
        if (pageLayout && scrollMode === ScrollMode.UNKNOWN && spreadMode === SpreadMode.UNKNOWN) {
          const modes = apiPageLayoutToViewerModes(pageLayout);
          spreadMode = modes.spreadMode;
        }
        this.setInitialView(hash, {
          rotation,
          sidebarView,
          scrollMode,
          spreadMode
        });
        this.eventBus.dispatch("documentinit", {
          source: this
        });
        await Promise.race([pagesPromise, new Promise(resolve => {
          setTimeout(resolve, FORCE_PAGES_LOADED_TIMEOUT);
        })]);
        if (!initialBookmark && !hash) {
          return;
        }
        if (pdfViewer.hasEqualPageSizes) {
          return;
        }
        this.initialBookmark = initialBookmark;
        pdfViewer.currentScaleValue = pdfViewer.currentScaleValue;
        this.setInitialView(hash);
      }).catch(() => {
        this.setInitialView();
      }).then(function () {
        pdfViewer.update();
      });
    });
    pagesPromise.then(() => {
      this._unblockDocumentLoadEvent();
      this._initializeAutoPrint(pdfDocument, openActionPromise);
    }, reason => {
      this._documentError("pdfjs-loading-error", {
        message: reason.message
      });
    });
    onePageRendered.then(data => {
      this.externalServices.reportTelemetry({
        type: "pageInfo",
        timestamp: data.timestamp
      });
      if (this.pdfOutlineViewer) {
        pdfDocument.getOutline().then(outline => {
          if (pdfDocument !== this.pdfDocument) {
            return;
          }
          this.pdfOutlineViewer.render({
            outline,
            pdfDocument
          });
        }, reason => {
          if (pdfDocument !== this.pdfDocument) {
            return;
          }
          console.error("getOutline", reason);
          this.pdfOutlineViewer.render({
            outline: null,
            pdfDocument
          });
        });
      }
      if (this.pdfAttachmentViewer) {
        pdfDocument.getAttachments().then(attachments => {
          if (pdfDocument !== this.pdfDocument) {
            return;
          }
          this.pdfAttachmentViewer.render({
            attachments
          });
        }, reason => {
          if (pdfDocument !== this.pdfDocument) {
            return;
          }
          console.error("getAttachments", reason);
          this.pdfAttachmentViewer.render({
            attachments: null
          });
        });
      }
      if (this.pdfLayerViewer) {
        pdfViewer.optionalContentConfigPromise.then(optionalContentConfig => {
          if (pdfDocument !== this.pdfDocument) {
            return;
          }
          this.pdfLayerViewer.render({
            optionalContentConfig,
            pdfDocument
          });
        });
      }
    });
    this._initializePageLabels(pdfDocument);
    this._initializeMetadata(pdfDocument);
  },
  async _scriptingDocProperties(pdfDocument) {
    if (!this.documentInfo) {
      await new Promise(resolve => {
        this.eventBus.on("metadataloaded", resolve, {
          once: true,
          ...internalOpt
        });
      });
      if (pdfDocument !== this.pdfDocument) {
        return null;
      }
    }
    if (!this._contentLength) {
      await new Promise(resolve => {
        this.eventBus.on("documentloaded", resolve, {
          once: true,
          ...internalOpt
        });
      });
      if (pdfDocument !== this.pdfDocument) {
        return null;
      }
    }
    return {
      ...this.documentInfo,
      baseURL: this.baseUrl,
      filesize: this._contentLength,
      filename: this._docFilename,
      metadata: this.metadata?.getRaw(),
      authors: this.metadata?.get("dc:creator"),
      numPages: this.pagesCount,
      URL: this.url
    };
  },
  async _initializeAutoPrint(pdfDocument, openActionPromise) {
    const [openAction, jsActions] = await Promise.all([openActionPromise, this.pdfViewer.enableScripting ? null : pdfDocument.getJSActions()]);
    if (pdfDocument !== this.pdfDocument) {
      return;
    }
    let triggerAutoPrint = openAction?.get("action") === "Print";
    if (jsActions) {
      console.warn("Warning: JavaScript support is not enabled");
      for (const [name, actions] of jsActions) {
        if (triggerAutoPrint) {
          break;
        }
        switch (name) {
          case "WillClose":
          case "WillSave":
          case "DidSave":
          case "WillPrint":
          case "DidPrint":
            continue;
        }
        triggerAutoPrint = actions.some(js => AutoPrintRegExp.test(js));
      }
    }
    if (triggerAutoPrint) {
      this.triggerPrinting();
    }
  },
  async _initializeMetadata(pdfDocument) {
    const {
      info,
      metadata,
      contentDispositionFilename,
      contentLength,
      hasStructTree
    } = await pdfDocument.getMetadata();
    if (pdfDocument !== this.pdfDocument) {
      return;
    }
    this.externalServices.reportTelemetry({
      type: "taggedPDF",
      data: hasStructTree
    });
    this.documentInfo = info;
    this.metadata = metadata;
    this._contentDispositionFilename ??= contentDispositionFilename;
    this._contentLength ??= contentLength;
    console.log(`PDF ${pdfDocument.fingerprints[0]} [${info.PDFFormatVersion} ` + `${(metadata?.get("pdf:producer") || info.Producer || "-").trim()} / ` + `${(metadata?.get("xmp:creatortool") || info.Creator || "-").trim()}` + `] (PDF.js: ${version || "?"} [${build || "?"}])`);
    const pdfTitle = this._docTitle;
    if (pdfTitle) {
      this.setTitle(`${pdfTitle} - ${this._contentDispositionFilename || this._title}`);
    } else if (this._contentDispositionFilename) {
      this.setTitle(this._contentDispositionFilename);
    }
    if (info.IsXFAPresent && !info.IsAcroFormPresent && !pdfDocument.isPureXfa) {
      if (pdfDocument.loadingParams.enableXfa) {
        console.warn("Warning: XFA Foreground documents are not supported");
      } else {
        console.warn("Warning: XFA support is not enabled");
      }
    } else if ((info.IsAcroFormPresent || info.IsXFAPresent) && !this.pdfViewer.renderForms) {
      console.warn("Warning: Interactive form support is not enabled");
    }
    if (info.IsSignaturesPresent) {
      const success = this._maybeInitSignatureProperties(pdfDocument);
      if (!success) {
        console.warn("Warning: Digital signatures validation is not supported");
      }
    }
    this.eventBus.dispatch("metadataloaded", {
      source: this
    });
  },
  _maybeInitSignatureProperties(pdfDocument) {
    if (!AppOptions.get("enableSignatureVerification")) {
      return false;
    }
    const verifier = this.externalServices.createSignatureVerifier();
    if (!verifier) {
      return false;
    }
    if (pdfDocument !== this.pdfDocument) {
      return true;
    }
    this.signaturePropertiesManager ??= new SignaturePropertiesManager({
      appConfig: this.appConfig.toolbar,
      verifier,
      eventBus: this.eventBus
    });
    this.signaturePropertiesManager.setDocument(pdfDocument);
    return true;
  },
  async _initializePageLabels(pdfDocument) {
    const labels = await pdfDocument.getPageLabels();
    if (pdfDocument !== this.pdfDocument) {
      return;
    }
    if (!labels || AppOptions.get("disablePageLabels")) {
      return;
    }
    const numLabels = labels.length;
    let standardLabels = 0,
      emptyLabels = 0;
    for (let i = 0; i < numLabels; i++) {
      const label = labels[i];
      if (label === (i + 1).toString()) {
        standardLabels++;
      } else if (label === "") {
        emptyLabels++;
      } else {
        break;
      }
    }
    if (standardLabels >= numLabels || emptyLabels >= numLabels) {
      return;
    }
    const {
      pdfViewer,
      pdfThumbnailViewer,
      toolbar
    } = this;
    pdfViewer.setPageLabels(labels);
    pdfThumbnailViewer?.setPageLabels(labels);
    toolbar?.setPagesCount(numLabels, true);
    toolbar?.setPageNumber(pdfViewer.currentPageNumber, pdfViewer.currentPageLabel);
  },
  _initializePdfHistory({
    fingerprint,
    viewOnLoad,
    initialDest = null
  }) {
    if (!this.pdfHistory) {
      return;
    }
    this.pdfHistory.initialize({
      fingerprint,
      resetHistory: viewOnLoad === ViewOnLoad.INITIAL || !!this._mergedDocumentNeedsSaving,
      updateUrl: AppOptions.get("historyUpdateUrl")
    });
    if (this.pdfHistory.initialBookmark) {
      this.initialBookmark = this.pdfHistory.initialBookmark;
      this.initialRotation = this.pdfHistory.initialRotation;
    }
    if (initialDest && !this.initialBookmark && viewOnLoad === ViewOnLoad.UNKNOWN) {
      this.initialBookmark = JSON.stringify(initialDest);
      this.pdfHistory.push({
        explicitDest: initialDest,
        pageNumber: null
      });
    }
  },
  _hasChanges() {
    return this.pdfDocument?.annotationStorage.size > 0 || this.pdfThumbnailViewer?.hasStructuralChanges() || this._mergedDocumentNeedsSaving === true;
  },
  _initializeAnnotationStorageCallbacks(pdfDocument) {
    if (pdfDocument !== this.pdfDocument) {
      return;
    }
    const {
      annotationStorage
    } = pdfDocument;
    annotationStorage.onSetModified = () => {
      this._annotationStorageModified = true;
    };
    annotationStorage.onResetModified = () => {
      delete this._annotationStorageModified;
    };
    annotationStorage.onAnnotationEditor = typeStr => {
      this._hasAnnotationEditors = !!typeStr;
      this.setTitle();
    };
  },
  setInitialView(storedHash, {
    rotation,
    sidebarView,
    scrollMode,
    spreadMode
  } = {}) {
    const setRotation = angle => {
      if (isValidRotation(angle)) {
        this.pdfViewer.pagesRotation = angle;
      }
    };
    const setViewerModes = (scroll, spread) => {
      if (isValidScrollMode(scroll)) {
        this.pdfViewer.scrollMode = scroll;
      }
      if (isValidSpreadMode(spread)) {
        this.pdfViewer.spreadMode = spread;
      }
    };
    this.isInitialViewSet = true;
    this.viewsManager?.setInitialView(sidebarView);
    setViewerModes(scrollMode, spreadMode);
    if (this.initialBookmark) {
      setRotation(this.initialRotation);
      delete this.initialRotation;
      this.pdfLinkService.setHash(this.initialBookmark);
      this.initialBookmark = null;
    } else if (storedHash) {
      setRotation(rotation);
      this.pdfLinkService.setHash(storedHash);
    }
    this.toolbar?.setPageNumber(this.pdfViewer.currentPageNumber, this.pdfViewer.currentPageLabel);
    this.secondaryToolbar?.setPageNumber(this.pdfViewer.currentPageNumber);
    this.pdfViewer.currentScaleValue ||= DEFAULT_SCALE_VALUE;
  },
  _cleanup() {
    if (!this.pdfDocument) {
      return;
    }
    this.pdfViewer.cleanup();
    this.pdfThumbnailViewer?.cleanup();
    this.pdfDocument.cleanup(AppOptions.get("fontExtraProperties"));
  },
  forceRendering() {
    this.pdfRenderingQueue.printing = !!this.printService;
    this.pdfRenderingQueue.isThumbnailViewEnabled = this.viewsManager?.visibleView === SidebarView.THUMBS;
    this.pdfRenderingQueue.renderHighestPriority();
  },
  beforePrint() {
    this._printAnnotationStoragePromise = this.pdfScriptingManager.dispatchWillPrint().catch(() => {}).then(() => this.pdfDocument?.annotationStorage.print);
    if (this.printService) {
      return;
    }
    if (!this.supportsPrinting || !this.pdfViewer.printingAllowed) {
      this._otherError("pdfjs-printing-not-supported");
      return;
    }
    if (!this.pdfViewer.pageViewsReady) {
      this.l10n.get("pdfjs-printing-not-ready").then(msg => {
        window.alert(msg);
      });
      return;
    }
    this.printService = PDFPrintServiceFactory.createPrintService({
      pdfDocument: this.pdfDocument,
      pagesOverview: this.pdfViewer.getPagesOverview(),
      printContainer: this.appConfig.printContainer,
      printResolution: AppOptions.get("printResolution"),
      printAnnotationStoragePromise: this._printAnnotationStoragePromise
    });
    this.forceRendering();
    this.setTitle();
    this.printService.layout();
    if (this._hasAnnotationEditors) {
      this.externalServices.reportTelemetry({
        type: "editing",
        data: {
          type: "print",
          stats: this.pdfDocument?.annotationStorage.editorStats
        }
      });
    }
  },
  afterPrint() {
    if (this._printAnnotationStoragePromise) {
      this._printAnnotationStoragePromise.then(() => {
        this.pdfScriptingManager.dispatchDidPrint();
      });
      this._printAnnotationStoragePromise = null;
    }
    if (this.printService) {
      this.printService.destroy();
      this.printService = null;
      this.pdfDocument?.annotationStorage.resetModified();
    }
    this.forceRendering();
    this.setTitle();
  },
  rotatePages(delta) {
    this.pdfViewer.pagesRotation += delta;
  },
  requestPresentationMode() {
    this.pdfPresentationMode?.request();
  },
  async triggerPrinting() {
    if (this.supportsPrinting && (await this._printPermissionPromise)) {
      window.print();
    }
  },
  bindEvents() {
    if (this._eventBusAC) {
      return;
    }
    const ac = this._eventBusAC = new AbortController();
    const opts = {
      signal: ac.signal,
      ...internalOpt
    };
    const {
      eventBus,
      externalServices,
      pdfDocumentProperties,
      pdfViewer,
      preferences
    } = this;
    eventBus.on("resize", onResize.bind(this), opts);
    eventBus.on("hashchange", onHashchange.bind(this), opts);
    eventBus.on("beforeprint", this.beforePrint.bind(this), opts);
    eventBus.on("afterprint", this.afterPrint.bind(this), opts);
    eventBus.on("pagerender", onPageRender.bind(this), opts);
    eventBus.on("pagerendered", onPageRendered.bind(this), opts);
    eventBus.on("updateviewarea", onUpdateViewarea.bind(this), opts);
    eventBus.on("pagechanging", onPageChanging.bind(this), opts);
    eventBus.on("scalechanging", onScaleChanging.bind(this), opts);
    eventBus.on("rotationchanging", onRotationChanging.bind(this), opts);
    eventBus.on("sidebarviewchanged", onSidebarViewChanged.bind(this), opts);
    eventBus.on("pagemode", onPageMode.bind(this), opts);
    eventBus.on("namedaction", onNamedAction.bind(this), opts);
    eventBus.on("presentationmodechanged", evt => pdfViewer.presentationModeState = evt.state, opts);
    eventBus.on("presentationmode", this.requestPresentationMode.bind(this), opts);
    eventBus.on("switchannotationeditormode", evt => pdfViewer.annotationEditorMode = evt, opts);
    eventBus.on("print", this.triggerPrinting.bind(this), opts);
    eventBus.on("download", this.downloadOrSave.bind(this), opts);
    eventBus.on("firstpage", () => this.page = 1, opts);
    eventBus.on("lastpage", () => this.page = this.pagesCount, opts);
    eventBus.on("nextpage", () => pdfViewer.nextPage(), opts);
    eventBus.on("previouspage", () => pdfViewer.previousPage(), opts);
    eventBus.on("zoomin", this.zoomIn.bind(this), opts);
    eventBus.on("zoomout", this.zoomOut.bind(this), opts);
    eventBus.on("zoomreset", this.zoomReset.bind(this), opts);
    eventBus.on("pagenumberchanged", onPageNumberChanged.bind(this), opts);
    eventBus.on("scalechanged", evt => pdfViewer.currentScaleValue = evt.value, opts);
    eventBus.on("rotatecw", this.rotatePages.bind(this, 90), opts);
    eventBus.on("rotateccw", this.rotatePages.bind(this, -90), opts);
    eventBus.on("optionalcontentconfig", evt => pdfViewer.optionalContentConfigPromise = evt.promise, opts);
    eventBus.on("switchscrollmode", evt => pdfViewer.scrollMode = evt.mode, opts);
    eventBus.on("scrollmodechanged", onViewerModesChanged.bind(this, "scrollMode"), opts);
    eventBus.on("switchspreadmode", evt => pdfViewer.spreadMode = evt.mode, opts);
    eventBus.on("spreadmodechanged", onViewerModesChanged.bind(this, "spreadMode"), opts);
    eventBus.on("imagealttextsettings", onImageAltTextSettings.bind(this), opts);
    eventBus.on("documentproperties", () => pdfDocumentProperties?.open(), opts);
    eventBus.on("findfromurlhash", onFindFromUrlHash.bind(this), opts);
    eventBus.on("updatefindmatchescount", onUpdateFindMatchesCount.bind(this), opts);
    eventBus.on("updatefindcontrolstate", onUpdateFindControlState.bind(this), opts);
    eventBus.on("fileinputchange", onFileInputChange.bind(this), opts);
    eventBus.on("openfile", onOpenFile.bind(this), opts);
    eventBus.on("pagesedited", this.onPagesEdited.bind(this), opts);
    eventBus.on("saveextractedpages", this.onSavePages.bind(this), opts);
    eventBus.on("saveandload", this.onSaveAndLoad.bind(this), opts);
  },
  bindWindowEvents() {
    if (this._windowAC) {
      return;
    }
    this._windowAC = new AbortController();
    const {
      eventBus,
      appConfig: {
        mainContainer
      },
      pdfViewer,
      _windowAC: {
        signal
      }
    } = this;
    this._touchManager = new TouchManager({
      container: window,
      isPinchingDisabled: () => pdfViewer.isInPresentationMode,
      isPinchingStopped: () => this.overlayManager?.active,
      onPinching: this.touchPinchCallback.bind(this),
      onPinchEnd: this.touchPinchEndCallback.bind(this),
      onPanning: this.touchPanCallback.bind(this),
      signal
    });
    function addWindowResolutionChange(evt = null) {
      if (evt) {
        pdfViewer.refresh();
      }
      const mediaQueryList = window.matchMedia(`(resolution: ${OutputScale.pixelRatio}dppx)`);
      mediaQueryList.addEventListener("change", addWindowResolutionChange, {
        once: true,
        signal
      });
    }
    addWindowResolutionChange();
    window.addEventListener("wheel", evt => this.appConfig.appContainer.contains(evt.target) && onWheel.call(this, evt), {
      passive: false,
      signal
    });
    window.addEventListener("click", onClick.bind(this), {
      signal
    });
    window.addEventListener("keydown", evt => this.appConfig.appContainer.contains(evt.target) && onKeyDown.call(this, evt), {
      signal
    });
    window.addEventListener("keyup", onKeyUp.bind(this), {
      signal
    });
    window.addEventListener("resize", () => eventBus.dispatch("resize", {
      source: window
    }), {
      signal
    });
    window.addEventListener("hashchange", () => {
      eventBus.dispatch("hashchange", {
        source: window,
        hash: document.location.hash.substring(1)
      });
    }, {
      signal
    });
    window.addEventListener("beforeprint", () => eventBus.dispatch("beforeprint", {
      source: window
    }), {
      signal
    });
    window.addEventListener("afterprint", () => eventBus.dispatch("afterprint", {
      source: window
    }), {
      signal
    });
    window.addEventListener("updatefromsandbox", evt => {
      eventBus.dispatch("updatefromsandbox", {
        source: window,
        detail: evt.detail
      });
    }, {
      signal
    });
    window.addEventListener("beforeunload", onBeforeUnload.bind(this), {
      signal
    });
    if (!("onscrollend" in document.documentElement)) {
      return;
    }
    ({
      scrollTop: this._lastScrollTop,
      scrollLeft: this._lastScrollLeft
    } = mainContainer);
    let scrollendTimeoutID, scrollAbortController;
    const scrollend = () => {
      ({
        scrollTop: this._lastScrollTop,
        scrollLeft: this._lastScrollLeft
      } = mainContainer);
      clearTimeout(scrollendTimeoutID);
      if (this._isScrolling) {
        scrollAbortController.abort();
        scrollAbortController = null;
        this._isScrolling = false;
      }
    };
    const scroll = () => {
      if (this._isCtrlKeyDown) {
        return;
      }
      if (this._lastScrollTop === mainContainer.scrollTop && this._lastScrollLeft === mainContainer.scrollLeft) {
        return;
      }
      if (!this._isScrolling) {
        scrollAbortController = new AbortController();
        const abortSignal = AbortSignal.any([scrollAbortController.signal, signal]);
        mainContainer.addEventListener("scrollend", scrollend, {
          signal: abortSignal
        });
        mainContainer.addEventListener("blur", scrollend, {
          signal: abortSignal
        });
        this._isScrolling = true;
      }
      clearTimeout(scrollendTimeoutID);
      scrollendTimeoutID = setTimeout(scrollend, 100);
    };
    mainContainer.addEventListener("scroll", scroll, {
      passive: true,
      signal
    });
  },
  unbindEvents() {
    this._eventBusAC?.abort();
    this._eventBusAC = null;
  },
  unbindWindowEvents() {
    this._windowAC?.abort();
    this._windowAC = null;
    this._touchManager = null;
  },
  async testingClose() {
    this.unbindEvents();
    this.unbindWindowEvents();
    this._globalAbortController?.abort();
    this._globalAbortController = null;
    this.findBar?.close();
    await Promise.all([this.l10n?.destroy(), this.close()]);
  },
  onPagesEdited(data) {
    this.pdfViewer.onPagesEdited(data);
  },
  async onSavePages({
    data: {
      pageInfos,
      copyLevels
    }
  }) {
    if (!this.downloadManager || !this.pdfDocument) {
      return;
    }
    const modifiedPdfBytes = await this.pdfDocument.extractPages(pageInfos, copyLevels);
    if (!modifiedPdfBytes) {
      console.error("Something wrong happened when saving the edited PDF.\nPlease file a bug.");
      return;
    }
    this.downloadManager.download(modifiedPdfBytes, this._downloadUrl, this._docFilename, true);
  },
  async onSaveAndLoad({
    data: {
      pageInfos,
      copyLevels
    }
  }) {
    if (!this.pdfDocument) {
      return;
    }
    const modifiedPdfBytes = await this.pdfDocument.extractPages(pageInfos, copyLevels);
    if (!modifiedPdfBytes) {
      console.error("Something wrong happened when saving the edited PDF.\nPlease file a bug.");
      return;
    }
    this._mergedDocumentNeedsSaving = true;
    const downloadUrl = this._downloadUrl;
    await this.open({
      data: modifiedPdfBytes,
      filename: this._docFilename
    });
    this._downloadUrl = downloadUrl;
    this._isMergedDocument = true;
  },
  _accumulateTicks(ticks, prop) {
    if (this[prop] > 0 && ticks < 0 || this[prop] < 0 && ticks > 0) {
      this[prop] = 0;
    }
    this[prop] += ticks;
    const wholeTicks = Math.trunc(this[prop]);
    this[prop] -= wholeTicks;
    return wholeTicks;
  },
  _accumulateFactor(previousScale, factor, prop) {
    if (factor === 1) {
      return 1;
    }
    const target = MathClamp(previousScale * factor * this[prop], MIN_SCALE, MAX_SCALE);
    const newScale = Math.round(target * 100) / 100;
    this[prop] = target / newScale;
    return newScale / previousScale;
  },
  _unblockDocumentLoadEvent() {
    document.blockUnblockOnload?.(false);
    this._unblockDocumentLoadEvent = () => {};
  },
  get scriptingReady() {
    return this.pdfScriptingManager.ready;
  }
};
initCom(PDFViewerApplication);
PDFPrintServiceFactory.initGlobals(PDFViewerApplication);
{
  const HOSTED_VIEWER_ORIGINS = new Set(["null", "http://mozilla.github.io", "https://mozilla.github.io"]);
  var validateFileURL = function (file) {
    if (!file) {
      return;
    }
    const viewerOrigin = URL.parse(window.location)?.origin || "null";
    if (HOSTED_VIEWER_ORIGINS.has(viewerOrigin)) {
      return;
    }
    const fileOrigin = URL.parse(file, window.location)?.origin;
    if (fileOrigin === viewerOrigin) {
      return;
    }
    const ex = new Error("file origin does not match viewer's");
    PDFViewerApplication._documentError("pdfjs-loading-error", {
      message: ex.message
    });
    throw ex;
  };
  var onFileInputChange = function (evt) {
    if (this.pdfViewer?.isInPresentationMode) {
      return;
    }
    const file = evt.fileInput.files[0];
    this.open({
      url: URL.createObjectURL(file),
      originalUrl: encodeURIComponent(file.name)
    });
  };
  var onOpenFile = function (evt) {
    this._openFileInput?.click();
  };
}
function onPageRender({
  pageNumber
}) {
  if (pageNumber === this.page) {
    this.toolbar?.updateLoadingIndicatorState(true);
  }
}
function onPageRendered({
  pageNumber,
  isDetailView,
  error
}) {
  if (pageNumber === this.page) {
    this.toolbar?.updateLoadingIndicatorState(false);
  }
  if (!isDetailView && this.viewsManager?.visibleView === SidebarView.THUMBS) {
    const pageView = this.pdfViewer.getPageView(pageNumber - 1);
    const thumbnailView = this.pdfThumbnailViewer?.getThumbnail(pageNumber - 1);
    if (pageView) {
      thumbnailView?.setImage(pageView);
    }
  }
  if (error) {
    this._otherError("pdfjs-rendering-error", error);
  }
}
function onPageMode({
  mode
}) {
  let view;
  switch (mode) {
    case "thumbs":
      view = SidebarView.THUMBS;
      break;
    case "bookmarks":
    case "outline":
      view = SidebarView.OUTLINE;
      break;
    case "attachments":
      view = SidebarView.ATTACHMENTS;
      break;
    case "layers":
      view = SidebarView.LAYERS;
      break;
    case "none":
      view = SidebarView.NONE;
      break;
    default:
      console.error('Invalid "pagemode" hash parameter: ' + mode);
      return;
  }
  this.viewsManager?.switchView(view, true);
}
function onNamedAction(evt) {
  switch (evt.action) {
    case "GoToPage":
      this.appConfig.toolbar?.pageNumber.select();
      break;
    case "Find":
      if (!this.supportsIntegratedFind) {
        this.findBar?.toggle();
      }
      break;
    case "Print":
      this.triggerPrinting();
      break;
    case "SaveAs":
      this.downloadOrSave();
      break;
  }
}
function onSidebarViewChanged({
  view
}) {
  this.pdfRenderingQueue.isThumbnailViewEnabled = view === SidebarView.THUMBS;
  if (this.isInitialViewSet) {
    this.store?.setMultiple({
      sidebarView: view
    }).catch(() => {});
  }
}
function onUpdateViewarea({
  location
}) {
  if (this.isInitialViewSet) {
    this.store?.setMultiple({
      page: location.pageNumber,
      zoom: location.scale,
      scrollLeft: location.left,
      scrollTop: location.top,
      rotation: location.rotation
    }).catch(() => {});
  }
  if (this.appConfig.secondaryToolbar) {
    this.appConfig.secondaryToolbar.viewBookmarkButton.href = this.pdfLinkService.getAnchorUrl(location.pdfOpenParams);
  }
}
function onViewerModesChanged(name, evt) {
  if (this.isInitialViewSet && !this.pdfViewer.isInPresentationMode) {
    this.store?.setMultiple({
      [name]: evt.mode
    }).catch(() => {});
  }
}
function onResize() {
  const {
    pdfDocument,
    pdfViewer,
    pdfRenderingQueue
  } = this;
  if (pdfRenderingQueue.printing && window.matchMedia("print").matches) {
    return;
  }
  if (!pdfDocument) {
    return;
  }
  const currentScaleValue = pdfViewer.currentScaleValue;
  if (currentScaleValue === "auto" || currentScaleValue === "page-fit" || currentScaleValue === "page-width") {
    pdfViewer.currentScaleValue = currentScaleValue;
  }
  pdfViewer.update();
}
function onHashchange(evt) {
  const hash = evt.hash;
  if (!hash) {
    return;
  }
  if (!this.isInitialViewSet) {
    this.initialBookmark = hash;
  } else if (!this.pdfHistory?.popStateInProgress) {
    this.pdfLinkService.setHash(hash);
  }
}
function onPageNumberChanged(evt) {
  const {
    pdfViewer
  } = this;
  if (evt.value !== "") {
    this.pdfLinkService.goToPage(evt.value);
  }
  if (evt.value !== pdfViewer.currentPageNumber.toString() && evt.value !== pdfViewer.currentPageLabel) {
    this.toolbar?.setPageNumber(pdfViewer.currentPageNumber, pdfViewer.currentPageLabel);
  }
}
function onImageAltTextSettings() {
  this.imageAltTextSettings?.open({
    enableGuessAltText: AppOptions.get("enableGuessAltText"),
    enableNewAltTextWhenAddingImage: AppOptions.get("enableNewAltTextWhenAddingImage")
  });
}
function onFindFromUrlHash(evt) {
  this.eventBus.dispatch("find", {
    source: evt.source,
    type: "",
    query: evt.query,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious: false,
    matchDiacritics: true
  });
}
function onUpdateFindMatchesCount({
  matchesCount
}) {
  if (this.supportsIntegratedFind) {
    this.externalServices.updateFindMatchesCount(matchesCount);
  } else {
    this.findBar?.updateResultsCount(matchesCount);
  }
}
function onUpdateFindControlState({
  state,
  previous,
  entireWord,
  matchesCount,
  rawQuery
}) {
  if (this.supportsIntegratedFind) {
    this.externalServices.updateFindControlState({
      result: state,
      findPrevious: previous,
      entireWord,
      matchesCount,
      rawQuery
    });
  } else {
    this.findBar?.updateUIState(state, previous, matchesCount);
  }
}
function onScaleChanging(evt) {
  this.toolbar?.setPageScale(evt.presetValue, evt.scale);
  this.pdfViewer.update();
}
function onRotationChanging(evt) {
  if (this.pdfThumbnailViewer) {
    this.pdfThumbnailViewer.pagesRotation = evt.pagesRotation;
  }
  this.forceRendering();
  this.pdfViewer.currentPageNumber = evt.pageNumber;
}
function onPageChanging({
  pageNumber,
  pageLabel
}) {
  this.toolbar?.setPageNumber(pageNumber, pageLabel);
  this.secondaryToolbar?.setPageNumber(pageNumber);
  if (this.viewsManager?.visibleView === SidebarView.THUMBS) {
    this.pdfThumbnailViewer?.scrollThumbnailIntoView(pageNumber);
  }
  const currentPage = this.pdfViewer.getPageView(pageNumber - 1);
  this.toolbar?.updateLoadingIndicatorState(currentPage?.renderingState === RenderingStates.RUNNING);
}
function onWheel(evt) {
  const {
    pdfViewer,
    supportsMouseWheelZoomCtrlKey,
    supportsMouseWheelZoomMetaKey,
    supportsPinchToZoom
  } = this;
  if (pdfViewer.isInPresentationMode) {
    return;
  }
  const deltaMode = evt.deltaMode;
  let scaleFactor = Math.exp(-evt.deltaY / 100);
  const isBuiltInMac = false;
  const isPinchToZoom = evt.ctrlKey && !this._isCtrlKeyDown && deltaMode === WheelEvent.DOM_DELTA_PIXEL && evt.deltaX === 0 && (Math.abs(scaleFactor - 1) < 0.05 || isBuiltInMac) && evt.deltaZ === 0;
  const origin = [evt.clientX, evt.clientY];
  if (isPinchToZoom || evt.ctrlKey && supportsMouseWheelZoomCtrlKey || evt.metaKey && supportsMouseWheelZoomMetaKey) {
    evt.preventDefault();
    if (this._isScrolling || document.visibilityState === "hidden" || this.overlayManager.active) {
      return;
    }
    if (isPinchToZoom && supportsPinchToZoom) {
      scaleFactor = this._accumulateFactor(pdfViewer.currentScale, scaleFactor, "_wheelUnusedFactor");
      this.updateZoom(null, scaleFactor, origin);
    } else {
      const delta = normalizeWheelEventDirection(evt);
      let ticks = 0;
      if (deltaMode === WheelEvent.DOM_DELTA_LINE || deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        ticks = Math.abs(delta) >= 1 ? Math.sign(delta) : this._accumulateTicks(delta, "_wheelUnusedTicks");
      } else {
        const PIXELS_PER_LINE_SCALE = 30;
        ticks = this._accumulateTicks(delta / PIXELS_PER_LINE_SCALE, "_wheelUnusedTicks");
      }
      this.updateZoom(ticks, null, origin);
    }
  }
}
function closeSecondaryToolbar({
  target
}) {
  if (!this.secondaryToolbar?.isOpen) {
    return;
  }
  const {
    toolbar,
    secondaryToolbar
  } = this.appConfig;
  if (this.pdfViewer.containsElement(target) || toolbar?.container.contains(target) && !secondaryToolbar?.toolbar.contains(target) && !secondaryToolbar?.toggleButton.contains(target)) {
    this.secondaryToolbar.close();
  }
}
function closeEditorUndoBar(evt) {
  if (!this.editorUndoBar?.isOpen) {
    return;
  }
  if (this.appConfig.secondaryToolbar?.toolbar.contains(evt.target)) {
    this.editorUndoBar.hide();
  }
}
function closeSignatureProperties({
  target
}) {
  if (this.signaturePropertiesManager?.shouldCloseOnClick(target)) {
    this.signaturePropertiesManager.close();
  }
}
function onBeforeUnload(evt) {
  if (this._hasChanges()) {
    evt.preventDefault();
    evt.returnValue = "";
    return false;
  }
  return true;
}
function onClick(evt) {
  closeSecondaryToolbar.call(this, evt);
  closeEditorUndoBar.call(this, evt);
  closeSignatureProperties.call(this, evt);
}
function onKeyUp(evt) {
  if (evt.key === "Control") {
    this._isCtrlKeyDown = false;
  }
}
function onKeyDown(evt) {
  this._isCtrlKeyDown = evt.key === "Control";
  if (this.editorUndoBar?.isOpen && evt.keyCode !== 9 && evt.keyCode !== 16 && !((evt.keyCode === 13 || evt.keyCode === 32) && getActiveOrFocusedElement() === this.appConfig.editorUndoBar.undoButton)) {
    this.editorUndoBar.hide();
  }
  if (this.overlayManager.active) {
    return;
  }
  const {
    eventBus,
    pdfViewer
  } = this;
  const isViewerInPresentationMode = pdfViewer.isInPresentationMode;
  let handled = false,
    ensureViewerFocused = false;
  const cmd = (evt.ctrlKey ? 1 : 0) | (evt.altKey ? 2 : 0) | (evt.shiftKey ? 4 : 0) | (evt.metaKey ? 8 : 0);
  if (cmd === 1 || cmd === 8 || cmd === 5 || cmd === 12) {
    switch (evt.keyCode) {
      case 70:
        if (!this.supportsIntegratedFind && !evt.shiftKey) {
          this.findBar?.open();
          handled = true;
        }
        break;
      case 71:
        if (!this.supportsIntegratedFind) {
          const {
            state
          } = this.findController;
          if (state) {
            const newState = {
              source: window,
              type: "again",
              findPrevious: cmd === 5 || cmd === 12
            };
            eventBus.dispatch("find", {
              ...state,
              ...newState
            });
          }
          handled = true;
        }
        break;
      case 61:
      case 107:
      case 187:
      case 171:
        this.zoomIn();
        handled = true;
        break;
      case 173:
      case 109:
      case 189:
        this.zoomOut();
        handled = true;
        break;
      case 48:
      case 96:
        if (!isViewerInPresentationMode) {
          setTimeout(() => {
            this.zoomReset();
          });
          handled = false;
        }
        break;
      case 38:
        if (isViewerInPresentationMode || this.page > 1) {
          this.page = 1;
          handled = true;
          ensureViewerFocused = true;
        }
        break;
      case 40:
        if (isViewerInPresentationMode || this.page < this.pagesCount) {
          this.page = this.pagesCount;
          handled = true;
          ensureViewerFocused = true;
        }
        break;
    }
  }
  if (cmd === 1 || cmd === 8) {
    switch (evt.keyCode) {
      case 83:
        eventBus.dispatch("download", {
          source: window
        });
        handled = true;
        break;
      case 79:
        {
          eventBus.dispatch("openfile", {
            source: window
          });
          handled = true;
        }
        break;
    }
  }
  if (cmd === 3 || cmd === 10) {
    switch (evt.keyCode) {
      case 80:
        this.requestPresentationMode();
        handled = true;
        this.externalServices.reportTelemetry({
          type: "buttons",
          data: {
            id: "presentationModeKeyboard"
          }
        });
        break;
      case 71:
        if (this.appConfig.toolbar) {
          this.appConfig.toolbar.pageNumber.select();
          handled = true;
        }
        break;
    }
  }
  if (handled) {
    if (ensureViewerFocused && !isViewerInPresentationMode) {
      pdfViewer.focus();
    }
    evt.preventDefault();
    return;
  }
  const curElement = getActiveOrFocusedElement();
  const curElementTagName = curElement?.tagName.toUpperCase();
  if (curElementTagName === "INPUT" || curElementTagName === "TEXTAREA" || curElementTagName === "SELECT" || curElementTagName === "BUTTON" && evt.keyCode === 32 || curElement?.isContentEditable) {
    if (evt.keyCode !== 27) {
      return;
    }
  }
  if (cmd === 0) {
    let turnPage = 0,
      turnOnlyIfPageFit = false;
    switch (evt.keyCode) {
      case 38:
        if (this.supportsCaretBrowsingMode) {
          this.moveCaret(true, false);
          handled = true;
          break;
        }
      case 33:
        if (pdfViewer.isVerticalScrollbarEnabled) {
          turnOnlyIfPageFit = true;
        }
        turnPage = -1;
        break;
      case 8:
        if (!isViewerInPresentationMode) {
          turnOnlyIfPageFit = true;
        }
        turnPage = -1;
        break;
      case 37:
        if (this.supportsCaretBrowsingMode) {
          return;
        }
        if (pdfViewer.isHorizontalScrollbarEnabled) {
          turnOnlyIfPageFit = true;
        }
      case 75:
      case 80:
        turnPage = -1;
        break;
      case 27:
        if (this.secondaryToolbar?.isOpen) {
          this.secondaryToolbar.close();
          handled = true;
        }
        if (this.signaturePropertiesManager?.isOpen) {
          this.signaturePropertiesManager.close();
          handled = true;
        }
        if (!this.supportsIntegratedFind && this.findBar?.opened) {
          this.findBar.close();
          handled = true;
        }
        break;
      case 40:
        if (this.supportsCaretBrowsingMode) {
          this.moveCaret(false, false);
          handled = true;
          break;
        }
      case 34:
        if (pdfViewer.isVerticalScrollbarEnabled) {
          turnOnlyIfPageFit = true;
        }
        turnPage = 1;
        break;
      case 32:
        if (!isViewerInPresentationMode) {
          turnOnlyIfPageFit = true;
        }
        turnPage = 1;
        break;
      case 39:
        if (this.supportsCaretBrowsingMode) {
          return;
        }
        if (pdfViewer.isHorizontalScrollbarEnabled) {
          turnOnlyIfPageFit = true;
        }
      case 74:
      case 78:
        turnPage = 1;
        break;
      case 36:
        if (isViewerInPresentationMode || this.page > 1) {
          this.page = 1;
          handled = true;
          ensureViewerFocused = true;
        }
        break;
      case 35:
        if (isViewerInPresentationMode || this.page < this.pagesCount) {
          this.page = this.pagesCount;
          handled = true;
          ensureViewerFocused = true;
        }
        break;
      case 83:
        this.pdfCursorTools?.switchTool(CursorTool.SELECT);
        break;
      case 72:
        this.pdfCursorTools?.switchTool(CursorTool.HAND);
        break;
      case 82:
        this.rotatePages(90);
        break;
      case 115:
        this.viewsManager?.toggle();
        break;
    }
    if (turnPage !== 0 && (!turnOnlyIfPageFit || pdfViewer.currentScaleValue === "page-fit")) {
      if (turnPage > 0) {
        pdfViewer.nextPage();
      } else {
        pdfViewer.previousPage();
      }
      handled = true;
    }
  }
  if (cmd === 4) {
    switch (evt.keyCode) {
      case 32:
        if (!isViewerInPresentationMode && pdfViewer.currentScaleValue !== "page-fit") {
          break;
        }
        pdfViewer.previousPage();
        handled = true;
        break;
      case 38:
        this.moveCaret(true, true);
        handled = true;
        break;
      case 40:
        this.moveCaret(false, true);
        handled = true;
        break;
      case 82:
        this.rotatePages(-90);
        break;
    }
  }
  if (!handled && !isViewerInPresentationMode) {
    if (evt.keyCode >= 33 && evt.keyCode <= 40 || evt.keyCode === 32 && curElementTagName !== "BUTTON") {
      ensureViewerFocused = true;
    }
  }
  if (ensureViewerFocused && !pdfViewer.containsElement(curElement)) {
    pdfViewer.focus();
  }
  if (handled) {
    evt.preventDefault();
  }
}
export { PDFViewerApplication };