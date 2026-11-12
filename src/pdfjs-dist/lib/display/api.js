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
import "core-js/modules/es.iterator.map.js";
import "core-js/modules/es.iterator.take.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import "core-js/modules/es.typed-array.with.js";
import "core-js/modules/es.uint8-array.set-from-base64.js";
import "core-js/modules/es.uint8-array.set-from-hex.js";
import "core-js/modules/es.uint8-array.to-base64.js";
import "core-js/modules/es.uint8-array.to-hex.js";
import "core-js/modules/es.weak-map.get-or-insert.js";
import "core-js/modules/es.weak-map.get-or-insert-computed.js";
import { AbortException, AnnotationMode, assert, getVerbosityLevel, info, isNodeJS, makeObj, RenderingIntentFlag, setVerbosityLevel, shadow, unreachable, warn } from "../shared/util.js";
import { AnnotationStorage, PrintAnnotationStorage, SerializableEmpty } from "./annotation_storage.js";
import { getDataProp, getFactoryUrlProp, getUrlProp, getWorkerSrc, isRefProxy, LoopbackPort, StatTimer } from "./api_utils.js";
import { initGPU, isGPUReady } from "./webgpu.js";
import { isDataScheme, isValidFetchUrl } from "./dom_utils.js";
import { MessageHandler, wrapReason } from "../shared/message_handler.js";
import { NodeBinaryDataFactory, NodeCanvasFactory, NodeFilterFactory } from "./node_utils.js";
import { CanvasGraphics } from "./canvas.js";
import { createCanvasTrackers } from "./canvas_dependency_tracker.js";
import { DOMBinaryDataFactory } from "./binary_data_factory.js";
import { DOMCanvasFactory } from "./dom_canvas_factory.js";
import { DOMFilterFactory } from "./dom_filter_factory.js";
import { FontLoader } from "./font_loader.js";
import { getNetworkStream } from "./network_stream.js";
import { GlobalWorkerOptions } from "./worker_options.js";
import { MathClamp } from "../shared/math_clamp.js";
import { Metadata } from "./metadata.js";
import { ObjectHandler } from "./object_handler.js";
import { OptionalContentConfig } from "./optional_content_config.js";
import { PagesMapper } from "./pages_mapper.js";
import { PageViewport } from "./page_viewport.js";
import { PDFDataTransportStream } from "./transport_stream.js";
import { PDFObjects } from "./pdf_objects.js";
import { RendererWorker } from "./renderer_worker_proxy.js";
import { RenderingCancelledException } from "./display_utils.js";
import { TextLayer } from "./text_layer.js";
import { XfaText } from "./xfa_text.js";
const RENDERING_CANCELLED_TIMEOUT = 100;
function getDocument(src = {}) {
  const task = new PDFDocumentLoadingTask();
  const {
    docId
  } = task;
  const url = src.url ? getUrlProp(src.url) : null;
  const data = src.data ? getDataProp(src.data) : null;
  const httpHeaders = src.httpHeaders || null;
  const withCredentials = src.withCredentials === true;
  const password = src.password ?? null;
  const rangeTransport = src.range instanceof PDFDataRangeTransport ? src.range : null;
  const rangeChunkSize = Number.isInteger(src.rangeChunkSize) && src.rangeChunkSize > 0 ? src.rangeChunkSize : 2 ** 16;
  let worker = src.worker instanceof PDFWorker ? src.worker : null;
  const verbosity = src.verbosity;
  const docBaseUrl = typeof src.docBaseUrl === "string" && !isDataScheme(src.docBaseUrl) ? src.docBaseUrl : null;
  const cMapUrl = getFactoryUrlProp(src.cMapUrl);
  const cMapPacked = src.cMapPacked !== false;
  const iccUrl = getFactoryUrlProp(src.iccUrl);
  const standardFontDataUrl = getFactoryUrlProp(src.standardFontDataUrl);
  const wasmUrl = getFactoryUrlProp(src.wasmUrl);
  const ignoreErrors = src.stopAtErrors !== true;
  const maxImageSize = Number.isInteger(src.maxImageSize) && src.maxImageSize > -1 ? src.maxImageSize : -1;
  const isOffscreenCanvasSupported = typeof src.isOffscreenCanvasSupported === "boolean" ? src.isOffscreenCanvasSupported : !isNodeJS;
  const isImageDecoderSupported = typeof src.isImageDecoderSupported === "boolean" ? src.isImageDecoderSupported : !isNodeJS;
  const canvasMaxAreaInBytes = Number.isInteger(src.canvasMaxAreaInBytes) ? src.canvasMaxAreaInBytes : -1;
  const disableFontFace = typeof src.disableFontFace === "boolean" ? src.disableFontFace : isNodeJS;
  const fontExtraProperties = src.fontExtraProperties === true;
  const enableXfa = src.enableXfa === true;
  const ownerDocument = src.ownerDocument || globalThis.document;
  const disableRange = src.disableRange === true;
  const disableStream = src.disableStream === true;
  const disableAutoFetch = src.disableAutoFetch === true;
  const pdfBug = src.pdfBug === true;
  const CanvasFactory = src.CanvasFactory || (isNodeJS ? NodeCanvasFactory : DOMCanvasFactory);
  const FilterFactory = src.FilterFactory || (isNodeJS ? NodeFilterFactory : DOMFilterFactory);
  const BinaryDataFactory = src.BinaryDataFactory || (isNodeJS ? NodeBinaryDataFactory : DOMBinaryDataFactory);
  const enableHWA = src.enableHWA === true;
  const enableWebGPU = src.enableWebGPU === true;
  if (enableWebGPU) {
    initGPU();
  }
  const useWasm = src.useWasm !== false;
  const pagesMapper = src.pagesMapper || new PagesMapper();
  const styleElement = null;
  const useSystemFonts = typeof src.useSystemFonts === "boolean" ? src.useSystemFonts : !isNodeJS && !disableFontFace;
  const useWorkerFetch = typeof src.useWorkerFetch === "boolean" ? src.useWorkerFetch : !!(BinaryDataFactory === DOMBinaryDataFactory && cMapUrl && cMapPacked && standardFontDataUrl && wasmUrl && isValidFetchUrl(cMapUrl, document.baseURI) && isValidFetchUrl(standardFontDataUrl, document.baseURI) && isValidFetchUrl(wasmUrl, document.baseURI));
  const disableWorkerRendering = src.disableWorkerRendering === true || !isOffscreenCanvasSupported || ownerDocument !== globalThis.document || !!styleElement || !RendererWorker.isAvailable;
  setVerbosityLevel(verbosity);
  const transportFactory = {
    canvasFactory: new CanvasFactory({
      ownerDocument,
      enableHWA
    }),
    filterFactory: new FilterFactory({
      docId,
      ownerDocument
    }),
    binaryDataFactory: useWorkerFetch ? null : new BinaryDataFactory({
      cMapUrl,
      standardFontDataUrl,
      wasmUrl
    })
  };
  if (!worker) {
    worker = PDFWorker.create({
      verbosity,
      port: GlobalWorkerOptions.workerPort
    });
    task._worker = worker;
  }
  if (!disableWorkerRendering) {
    const rendererWorker = RendererWorker.create({
      verbosity,
      enableHWA,
      enableWebGPU,
      ports: GlobalWorkerOptions.rendererPorts
    });
    rendererWorker.promise.catch(reason => {
      if (!rendererWorker.destroyed) {
        warn(`Renderer worker disabled: ${reason.message}`);
        rendererWorker.destroy();
      }
    });
    task._rendererWorker = rendererWorker;
  }
  const docParams = {
    docId,
    apiVersion: "6.5.0",
    data,
    password,
    disableAutoFetch,
    rangeChunkSize,
    docBaseUrl,
    enableXfa,
    evaluatorOptions: {
      maxImageSize,
      disableFontFace,
      ignoreErrors,
      isOffscreenCanvasSupported,
      isImageDecoderSupported,
      canvasMaxAreaInBytes,
      fontExtraProperties,
      useSystemFonts,
      useWasm,
      useWorkerFetch,
      cMapUrl,
      cMapPacked,
      iccUrl,
      standardFontDataUrl,
      wasmUrl
    }
  };
  const transportParams = {
    ownerDocument,
    pdfBug,
    styleElement,
    rendererWorker: task._rendererWorker,
    enableWebGPU,
    loadingParams: {
      disableAutoFetch,
      enableXfa
    }
  };
  worker.promise.then(function () {
    if (worker.destroyed) {
      throw new Error("Worker was destroyed");
    }
    const workerIdPromise = worker.messageHandler.sendWithPromise("GetDocRequest", docParams, data ? [data.buffer] : null);
    let networkStream;
    if (data) {} else if (rangeTransport) {
      networkStream = new PDFDataTransportStream({
        pdfDataRangeTransport: rangeTransport,
        disableRange,
        disableStream
      });
    } else if (url) {
      const NetworkStream = getNetworkStream(url);
      networkStream = new NetworkStream({
        url,
        httpHeaders,
        withCredentials,
        rangeChunkSize,
        disableRange,
        disableStream
      });
    } else {
      throw new Error("getDocument - expected either `data`, `range`, or `url` parameter.");
    }
    return workerIdPromise.then(workerId => {
      if (worker.destroyed) {
        throw new Error("Worker was destroyed");
      }
      const messageHandler = new MessageHandler(docId, workerId, worker.port);
      const transport = new WorkerTransport(messageHandler, task, networkStream, transportParams, transportFactory, pagesMapper);
      task._transport = transport;
      if (task.destroyed) {
        throw new Error("Loading aborted");
      }
      messageHandler.send("Ready", null);
    });
  }).catch(task._capability.reject).finally(task._setupCapability.resolve);
  return task;
}
class PDFDocumentLoadingTask {
  static #docId = 0;
  _capability = Promise.withResolvers();
  _setupCapability = Promise.withResolvers();
  _transport = null;
  _worker = null;
  _rendererWorker = null;
  docId = `d${PDFDocumentLoadingTask.#docId++}`;
  destroyed = false;
  onPassword = null;
  onProgress = null;
  get promise() {
    return this._capability.promise;
  }
  async destroy() {
    this.destroyed = true;
    this._capability.promise.catch(() => {});
    try {
      if (this._worker?.port) {
        this._worker._pendingDestroy = true;
      }
      await this._setupCapability.promise;
      await this._transport?.destroy();
    } catch (ex) {
      if (this._worker?.port) {
        delete this._worker._pendingDestroy;
      }
      throw ex;
    } finally {
      this._rendererWorker?.destroy();
      this._rendererWorker = null;
    }
    this._transport = null;
    this._worker?.destroy();
    this._worker = null;
  }
  async getData() {
    return this._transport.getData();
  }
}
class PDFDataRangeTransport {
  #capability = Promise.withResolvers();
  #listener = null;
  constructor(length, initialData, progressiveDone = false, contentDispositionFilename = null) {
    this.length = length;
    this.initialData = initialData;
    this.progressiveDone = progressiveDone;
    this.contentDispositionFilename = contentDispositionFilename;
  }
  onDataRange(begin, chunk) {
    this.#listener({
      type: "range",
      begin,
      chunk
    });
  }
  onDataProgressiveRead(chunk) {
    this.#capability.promise.then(() => {
      this.#listener({
        type: "progressiveRead",
        chunk
      });
    });
  }
  onDataProgressiveDone() {
    this.#capability.promise.then(() => {
      this.#listener({
        type: "progressiveDone"
      });
    });
  }
  transportReady(listener) {
    this.#listener = listener;
    this.#capability.resolve();
  }
  requestDataRange(begin, end) {
    unreachable("Abstract method PDFDataRangeTransport.requestDataRange");
  }
  abort() {}
}
class PDFDocumentProxy {
  constructor(pdfInfo, transport) {
    this._pdfInfo = pdfInfo;
    this._transport = transport;
  }
  get pagesMapper() {
    return this._transport.pagesMapper;
  }
  get annotationStorage() {
    return this._transport.annotationStorage;
  }
  get canvasFactory() {
    return this._transport.canvasFactory;
  }
  get filterFactory() {
    return this._transport.filterFactory;
  }
  get numPages() {
    return this._pdfInfo.numPages;
  }
  get fingerprints() {
    return this._pdfInfo.fingerprints;
  }
  get isPureXfa() {
    return shadow(this, "isPureXfa", !!this._transport._htmlForXfa);
  }
  get allXfaHtml() {
    return this._transport._htmlForXfa;
  }
  getPage(pageNumber) {
    return this._transport.getPage(pageNumber);
  }
  getPageIndex(ref) {
    return this._transport.getPageIndex(ref);
  }
  getDestinations() {
    return this._transport.getDestinations();
  }
  getDestination(id) {
    return this._transport.getDestination(id);
  }
  getPageLabels() {
    return this._transport.getPageLabels();
  }
  getPageLayout() {
    return this._transport.getPageLayout();
  }
  getPageMode() {
    return this._transport.getPageMode();
  }
  getViewerPreferences() {
    return this._transport.getViewerPreferences();
  }
  getOpenAction() {
    return this._transport.getOpenAction();
  }
  getAttachments() {
    return this._transport.getAttachments();
  }
  getAttachmentContent(id) {
    return this._transport.getAttachmentContent(id);
  }
  getAnnotationsByType(types, pageIndexesToSkip) {
    return this._transport.getAnnotationsByType(types, pageIndexesToSkip);
  }
  getJSActions() {
    return this._transport.getDocJSActions();
  }
  getOutline() {
    return this._transport.getOutline();
  }
  getOptionalContentConfig({
    intent = "display"
  } = {}) {
    const {
      renderingIntent
    } = this._transport.getRenderingIntent(intent);
    return this._transport.getOptionalContentConfig(renderingIntent);
  }
  getPermissions() {
    return this._transport.getPermissions();
  }
  getMetadata() {
    return this._transport.getMetadata();
  }
  getMarkInfo() {
    return this._transport.getMarkInfo();
  }
  getData() {
    return this._transport.getData();
  }
  saveDocument(printToPDF) {
    return this._transport.saveDocument(printToPDF);
  }
  extractPages(pageInfos, copyLevels = null) {
    return this._transport.extractPages(pageInfos, copyLevels);
  }
  getDownloadInfo() {
    return this._transport.downloadInfoCapability.promise;
  }
  cleanup(keepLoadedFonts = false) {
    return this._transport.startCleanup(keepLoadedFonts || this.isPureXfa);
  }
  cachedPageNumber(ref) {
    return this._transport.cachedPageNumber(ref);
  }
  get loadingParams() {
    return this._transport.loadingParams;
  }
  get loadingTask() {
    return this._transport.loadingTask;
  }
  getFieldObjects() {
    return this._transport.getFieldObjects();
  }
  getSignatures() {
    return this._transport.getSignatures();
  }
  getSignatureData(id) {
    return this._transport.getSignatureData(id);
  }
  hasJSActions() {
    return this._transport.hasJSActions();
  }
  getCalculationOrderIds() {
    return this._transport.getCalculationOrderIds();
  }
}
class PDFPageProxy {
  #pendingCleanup = false;
  #pagesMapper = null;
  static #idCounter = 0;
  constructor(pageIndex, pageInfo, transport, pagesMapper, pdfBug = false) {
    this._pageIndex = pageIndex;
    this._id = PDFPageProxy.#idCounter++;
    this._pageInfo = pageInfo;
    this._transport = transport;
    this._stats = pdfBug ? new StatTimer() : null;
    this._pdfBug = pdfBug;
    this.commonObjs = transport.commonObjs;
    this.objs = new PDFObjects();
    this._intentStates = new Map();
    this.destroyed = false;
    this.recordedBBoxes = null;
    this.#pagesMapper = pagesMapper;
    this.imageCoordinates = null;
  }
  clone(id) {
    const clone = new PDFPageProxy(id, this._pageInfo, this._transport, this.#pagesMapper, this._pdfBug);
    clone.clonedFromIndex = this.clonedFromIndex ?? this._pageIndex;
    this._transport.updatePage(clone);
    return clone;
  }
  get pageNumber() {
    return this._pageIndex + 1;
  }
  set pageNumber(value) {
    this._pageIndex = value - 1;
    this._transport.updatePage(this);
  }
  get rotate() {
    return this._pageInfo.rotate;
  }
  get ref() {
    return this._pageInfo.ref;
  }
  get userUnit() {
    return this._pageInfo.userUnit;
  }
  get view() {
    return this._pageInfo.view;
  }
  getViewport({
    scale,
    rotation = this.rotate,
    offsetX = 0,
    offsetY = 0,
    dontFlip = false
  } = {}) {
    return new PageViewport({
      viewBox: this.view,
      userUnit: this.userUnit,
      scale,
      rotation,
      offsetX,
      offsetY,
      dontFlip
    });
  }
  getAnnotations({
    intent = "display"
  } = {}) {
    const {
      renderingIntent
    } = this._transport.getRenderingIntent(intent);
    return this._transport.getAnnotations(this._pageIndex, renderingIntent);
  }
  getJSActions() {
    return this._transport.getPageJSActions(this._pageIndex);
  }
  get filterFactory() {
    return this._transport.filterFactory;
  }
  get isPureXfa() {
    return shadow(this, "isPureXfa", !!this._transport._htmlForXfa);
  }
  async getXfa() {
    return this._transport._htmlForXfa?.children[this._pageIndex] || null;
  }
  render({
    canvasContext,
    canvas = canvasContext.canvas,
    viewport,
    intent = "display",
    annotationMode = AnnotationMode.ENABLE,
    transform = null,
    background = null,
    optionalContentConfigPromise = null,
    annotationCanvasMap = null,
    pageColors = null,
    printAnnotationStorage = null,
    isEditing = false,
    recordImages = false,
    recordOperations = false,
    partialFrames = false,
    operationsFilter = null
  }) {
    this._stats?.time("Overall");
    const intentArgs = this._transport.getRenderingIntent(intent, annotationMode, printAnnotationStorage, isEditing);
    const {
      renderingIntent,
      cacheKey
    } = intentArgs;
    this.#pendingCleanup = false;
    optionalContentConfigPromise ||= this._transport.getOptionalContentConfig(renderingIntent);
    const intentState = this._intentStates.getOrInsertComputed(cacheKey, makeObj);
    if (intentState.streamReaderCancelTimeout) {
      clearTimeout(intentState.streamReaderCancelTimeout);
      intentState.streamReaderCancelTimeout = null;
    }
    const intentPrint = !!(renderingIntent & RenderingIntentFlag.PRINT);
    if (!intentState.displayReadyCapability) {
      intentState.displayReadyCapability = Promise.withResolvers();
      intentState.operatorList = {
        fnArray: [],
        argsArray: [],
        lastChunk: false,
        separateAnnots: null
      };
      this._stats?.time("Page Request");
      this._pumpOperatorList(intentArgs);
    }
    const recordForDebugger = !!(this._pdfBug && globalThis.StepperManager?.enabled);
    const shouldRecordOperations = !!canvas && !this.recordedBBoxes && (recordOperations || recordForDebugger);
    const shouldRecordImages = !!canvas && !this.imageCoordinates && recordImages;
    const complete = error => {
      intentState.renderTasks.delete(internalRenderTask);
      if (shouldRecordOperations) {
        const {
          recordedBBoxes
        } = internalRenderTask;
        if (recordedBBoxes) {
          internalRenderTask.stepper?.setOperatorBBoxes(recordedBBoxes, internalRenderTask.debugMetadata);
          if (recordOperations) {
            this.recordedBBoxes = recordedBBoxes;
          }
        }
      }
      if (shouldRecordImages && !error) {
        this.imageCoordinates = internalRenderTask.imageCoordinates;
      }
      if (intentPrint) {
        this.#pendingCleanup = true;
      }
      this.#tryCleanup();
      if (error) {
        internalRenderTask.capability.reject(error);
        this._abortOperatorList({
          intentState,
          reason: error instanceof Error ? error : new Error(error)
        });
      } else {
        internalRenderTask.capability.resolve();
      }
      if (this._stats) {
        this._stats.timeEnd("Rendering");
        this._stats.timeEnd("Overall");
        if (globalThis.Stats?.enabled) {
          globalThis.Stats.add(this.pageNumber, this._stats);
        }
      }
    };
    const internalRenderTask = new InternalRenderTask({
      callback: complete,
      params: {
        canvas,
        canvasContext,
        viewport,
        transform,
        background,
        recordOperations: shouldRecordOperations,
        recordImages: shouldRecordImages,
        partialFrames,
        recordForDebugger
      },
      objs: this.objs,
      commonObjs: this.commonObjs,
      annotationCanvasMap,
      operatorList: intentState.operatorList,
      pageIndex: this._pageIndex,
      pageProxyId: this._id,
      canvasFactory: this._transport.canvasFactory,
      filterFactory: this._transport.filterFactory,
      useRequestAnimationFrame: !intentPrint,
      pdfBug: this._pdfBug,
      pageColors,
      operationsFilter,
      rendererWorker: this._transport.rendererWorker,
      waitForGPU: () => this._transport.waitForGPU()
    });
    (intentState.renderTasks ||= new Set()).add(internalRenderTask);
    const renderTask = internalRenderTask.task;
    Promise.all([intentState.displayReadyCapability.promise, optionalContentConfigPromise]).then(async ([transparency, optionalContentConfig]) => {
      if (this.destroyed) {
        complete();
        return;
      }
      this._stats?.time("Rendering");
      if (!(optionalContentConfig.renderingIntent & renderingIntent)) {
        throw new Error("Must use the same `intent`-argument when calling the `PDFPageProxy.render` " + "and `PDFDocumentProxy.getOptionalContentConfig` methods.");
      }
      await internalRenderTask.initializeGraphics({
        transparency,
        optionalContentConfig
      });
      internalRenderTask.operatorListChanged();
    }).catch(complete);
    return renderTask;
  }
  getOperatorList({
    intent = "display",
    annotationMode = AnnotationMode.ENABLE,
    printAnnotationStorage = null,
    isEditing = false
  } = {}) {
    function operatorListChanged() {
      if (intentState.operatorList.lastChunk) {
        intentState.opListReadCapability.resolve(intentState.operatorList);
        intentState.renderTasks.delete(opListTask);
      }
    }
    const intentArgs = this._transport.getRenderingIntent(intent, annotationMode, printAnnotationStorage, isEditing, true);
    const intentState = this._intentStates.getOrInsertComputed(intentArgs.cacheKey, makeObj);
    let opListTask;
    if (!intentState.opListReadCapability) {
      opListTask = Object.create(null);
      opListTask.operatorListChanged = operatorListChanged;
      intentState.opListReadCapability = Promise.withResolvers();
      (intentState.renderTasks ||= new Set()).add(opListTask);
      intentState.operatorList = {
        fnArray: [],
        argsArray: [],
        lastChunk: false,
        separateAnnots: null
      };
      this._stats?.time("Page Request");
      this._pumpOperatorList(intentArgs);
    }
    return intentState.opListReadCapability.promise;
  }
  streamTextContent({
    includeMarkedContent = false,
    disableNormalization = false
  } = {}) {
    const TEXT_CONTENT_CHUNK_SIZE = 100;
    return this._transport.messageHandler.sendWithStream("GetTextContent", {
      pageId: this.#pagesMapper.getPageId(this._pageIndex + 1) - 1,
      pageIndex: this._pageIndex,
      includeMarkedContent: includeMarkedContent === true,
      disableNormalization: disableNormalization === true
    }, {
      highWaterMark: TEXT_CONTENT_CHUNK_SIZE,
      size: textContent => textContent.items.length
    });
  }
  async getTextContent(params = {}) {
    if (this._transport._htmlForXfa) {
      return this.getXfa().then(xfa => XfaText.textContent(xfa));
    }
    const readableStream = this.streamTextContent(params);
    const reader = readableStream.getReader();
    const textContent = {
      items: [],
      styles: Object.create(null),
      lang: null
    };
    while (true) {
      const {
        value,
        done
      } = await reader.read();
      if (done) {
        break;
      }
      textContent.lang ??= value.lang;
      Object.assign(textContent.styles, value.styles);
      textContent.items.push(...value.items);
    }
    return textContent;
  }
  getStructTree() {
    return this._transport.getStructTree(this._pageIndex);
  }
  _destroy() {
    this.destroyed = true;
    const waitOn = [];
    for (const intentState of this._intentStates.values()) {
      this._abortOperatorList({
        intentState,
        reason: new Error("Page was destroyed."),
        force: true
      });
      if (intentState.opListReadCapability) {
        continue;
      }
      for (const internalRenderTask of intentState.renderTasks) {
        waitOn.push(internalRenderTask.completed);
        internalRenderTask.cancel();
      }
    }
    this.objs.clear();
    this._transport.cleanupPage(this._id);
    this.#pendingCleanup = false;
    return Promise.all(waitOn);
  }
  cleanup(resetStats = false) {
    this.#pendingCleanup = true;
    const success = this.#tryCleanup();
    if (resetStats && success) {
      this._stats &&= new StatTimer();
    }
    return success;
  }
  #tryCleanup() {
    if (!this.#pendingCleanup || this.destroyed) {
      return false;
    }
    for (const {
      renderTasks,
      operatorList
    } of this._intentStates.values()) {
      if (renderTasks.size > 0 || !operatorList.lastChunk) {
        return false;
      }
    }
    this._intentStates.clear();
    this.objs.clear();
    this._transport.cleanupPage(this._id);
    this.#pendingCleanup = false;
    return true;
  }
  _startRenderPage(transparency, cacheKey) {
    const intentState = this._intentStates.get(cacheKey);
    if (!intentState) {
      return;
    }
    this._stats?.timeEnd("Page Request");
    intentState.displayReadyCapability?.resolve(transparency);
  }
  _renderPageChunk(operatorListChunk, intentState) {
    for (let i = 0, ii = operatorListChunk.length; i < ii; i++) {
      intentState.operatorList.fnArray.push(operatorListChunk.fnArray[i]);
      intentState.operatorList.argsArray.push(operatorListChunk.argsArray[i]);
    }
    intentState.operatorList.lastChunk = operatorListChunk.lastChunk;
    intentState.operatorList.separateAnnots = operatorListChunk.separateAnnots;
    for (const internalRenderTask of intentState.renderTasks) {
      internalRenderTask.operatorListChanged();
    }
    if (operatorListChunk.lastChunk) {
      this.#tryCleanup();
    }
  }
  _pumpOperatorList({
    renderingIntent,
    cacheKey,
    annotationStorageSerializable,
    modifiedIds
  }) {
    const {
      map,
      transfer
    } = annotationStorageSerializable;
    const readableStream = this._transport.messageHandler.sendWithStream("GetOperatorList", {
      pageId: this.#pagesMapper.getPageId(this._pageIndex + 1) - 1,
      pageIndex: this._pageIndex,
      pageProxyId: this._id,
      intent: renderingIntent,
      cacheKey,
      annotationStorage: map,
      modifiedIds
    }, undefined, transfer);
    const reader = readableStream.getReader();
    const intentState = this._intentStates.get(cacheKey);
    intentState.streamReader = reader;
    const pump = () => {
      reader.read().then(({
        value,
        done
      }) => {
        if (done) {
          intentState.streamReader = null;
          return;
        }
        if (this._transport.destroyed) {
          return;
        }
        this._renderPageChunk(value, intentState);
        pump();
      }, reason => {
        intentState.streamReader = null;
        if (this._transport.destroyed) {
          return;
        }
        if (intentState.operatorList) {
          intentState.operatorList.lastChunk = true;
          for (const internalRenderTask of intentState.renderTasks) {
            internalRenderTask.operatorListChanged();
          }
          this.#tryCleanup();
        }
        if (intentState.displayReadyCapability) {
          intentState.displayReadyCapability.reject(reason);
        } else if (intentState.opListReadCapability) {
          intentState.opListReadCapability.reject(reason);
        } else {
          throw reason;
        }
      });
    };
    pump();
  }
  _abortOperatorList({
    intentState,
    reason,
    force = false
  }) {
    if (!intentState.streamReader) {
      return;
    }
    if (intentState.streamReaderCancelTimeout) {
      clearTimeout(intentState.streamReaderCancelTimeout);
      intentState.streamReaderCancelTimeout = null;
    }
    if (!force) {
      if (intentState.renderTasks.size > 0) {
        return;
      }
      if (reason instanceof RenderingCancelledException) {
        let delay = RENDERING_CANCELLED_TIMEOUT;
        if (reason.extraDelay > 0 && reason.extraDelay < 1000) {
          delay += reason.extraDelay;
        }
        intentState.streamReaderCancelTimeout = setTimeout(() => {
          intentState.streamReaderCancelTimeout = null;
          this._abortOperatorList({
            intentState,
            reason,
            force: true
          });
        }, delay);
        return;
      }
    }
    intentState.streamReader.cancel(new AbortException(reason.message)).catch(() => {});
    intentState.streamReader = null;
    if (this._transport.destroyed) {
      return;
    }
    for (const [curCacheKey, curIntentState] of this._intentStates) {
      if (curIntentState === intentState) {
        this._intentStates.delete(curCacheKey);
        break;
      }
    }
    this.cleanup();
  }
  get stats() {
    return this._stats;
  }
}
class PDFWorker {
  #capability = Promise.withResolvers();
  #messageHandler = null;
  #port = null;
  #webWorker = null;
  static #fakeWorkerId = 0;
  static #isWorkerDisabled = false;
  static #workerPorts = new WeakMap();
  static {
    if (isNodeJS) {
      this.#isWorkerDisabled = true;
      GlobalWorkerOptions.workerSrc ||= "../pdf.worker.js";
    }
  }
  constructor({
    name = null,
    port = null,
    verbosity = getVerbosityLevel()
  } = {}) {
    this.name = name;
    this.destroyed = false;
    this.verbosity = verbosity;
    if (port) {
      if (PDFWorker.#workerPorts.has(port)) {
        throw new Error("Cannot use more than one PDFWorker per port.");
      }
      PDFWorker.#workerPorts.set(port, this);
      this.#initializeFromPort(port);
    } else {
      this.#initialize();
    }
  }
  get promise() {
    return this.#capability.promise;
  }
  #resolve() {
    this.#capability.resolve();
    this.#messageHandler.send("configure", {
      verbosity: this.verbosity
    });
  }
  get port() {
    return this.#port;
  }
  get messageHandler() {
    return this.#messageHandler;
  }
  #initializeFromPort(port) {
    this.#port = port;
    this.#messageHandler = new MessageHandler("main", "worker", port);
    this.#messageHandler.on("ready", () => {});
    this.#resolve();
  }
  #initialize() {
    if (PDFWorker.#isWorkerDisabled || PDFWorker.#mainThreadWorkerMessageHandler) {
      this.#setupFakeWorker();
      return;
    }
    const {
      workerSrc
    } = PDFWorker;
    try {
      const worker = new Worker(getWorkerSrc(workerSrc), {
        type: "module"
      });
      const messageHandler = new MessageHandler("main", "worker", worker);
      const terminateEarly = () => {
        ac.abort();
        messageHandler.destroy();
        worker.terminate();
        if (this.destroyed) {
          this.#capability.reject(new Error("Worker was destroyed"));
        } else {
          this.#setupFakeWorker();
        }
      };
      const ac = new AbortController();
      worker.addEventListener("error", () => {
        if (!this.#webWorker) {
          terminateEarly();
        }
      }, {
        signal: ac.signal
      });
      messageHandler.on("ready", data => {
        ac.abort();
        if (this.destroyed || !(data instanceof Uint8Array)) {
          terminateEarly();
          return;
        }
        this.#messageHandler = messageHandler;
        this.#port = worker;
        this.#webWorker = worker;
        this.#resolve();
      });
    } catch {
      info("The worker has been disabled.");
      this.#setupFakeWorker();
    }
  }
  #setupFakeWorker() {
    if (!PDFWorker.#isWorkerDisabled) {
      warn("Setting up fake worker.");
      PDFWorker.#isWorkerDisabled = true;
    }
    PDFWorker._setupFakeWorkerGlobal.then(WorkerMessageHandler => {
      if (this.destroyed) {
        this.#capability.reject(new Error("Worker was destroyed"));
        return;
      }
      const port = new LoopbackPort();
      this.#port = port;
      const id = `fake${PDFWorker.#fakeWorkerId++}`;
      const workerHandler = new MessageHandler(id + "_worker", id, port);
      WorkerMessageHandler.setup(workerHandler, port);
      this.#messageHandler = new MessageHandler(id, id + "_worker", port);
      this.#resolve();
    }).catch(reason => {
      this.#capability.reject(new Error(`Setting up fake worker failed: "${reason.message}".`));
    });
  }
  destroy() {
    this.destroyed = true;
    this.#webWorker?.terminate();
    this.#webWorker = null;
    PDFWorker.#workerPorts.delete(this.#port);
    this.#port = null;
    this.#messageHandler?.destroy();
    this.#messageHandler = null;
  }
  static create(params) {
    const cachedPort = this.#workerPorts.get(params?.port);
    if (cachedPort) {
      if (cachedPort._pendingDestroy) {
        throw new Error("PDFWorker.create - the worker is being destroyed.\n" + "Please remember to await `PDFDocumentLoadingTask.destroy()`-calls.");
      }
      return cachedPort;
    }
    return new PDFWorker(params);
  }
  static get workerSrc() {
    if (GlobalWorkerOptions.workerSrc) {
      return GlobalWorkerOptions.workerSrc;
    }
    throw new Error('No "GlobalWorkerOptions.workerSrc" specified.');
  }
  static get #mainThreadWorkerMessageHandler() {
    try {
      return globalThis.pdfjsWorker?.WorkerMessageHandler || null;
    } catch {
      return null;
    }
  }
  static get _setupFakeWorkerGlobal() {
    const loader = async () => {
      if (this.#mainThreadWorkerMessageHandler) {
        return this.#mainThreadWorkerMessageHandler;
      }
      const worker = await import(
      /*webpackIgnore: true*/
      /*@vite-ignore*/
      this.workerSrc);
      return worker.WorkerMessageHandler;
    };
    return shadow(this, "_setupFakeWorkerGlobal", loader());
  }
}
class WorkerTransport {
  downloadInfoCapability = Promise.withResolvers();
  #fullReader = null;
  #hasMeshPattern = false;
  #methodPromises = new Map();
  #networkStream = null;
  #pageCache = new Map();
  #pagePromises = new Map();
  #pageRefCache = new Map();
  #passwordCapability = null;
  #printToPDF = null;
  constructor(messageHandler, loadingTask, networkStream, params, factory, pagesMapper) {
    this.messageHandler = messageHandler;
    this.loadingTask = loadingTask;
    this.#networkStream = networkStream;
    this.commonObjs = new PDFObjects();
    this.fontLoader = new FontLoader({
      ownerDocument: params.ownerDocument,
      styleElement: params.styleElement
    });
    this.rendererWorker = params.rendererWorker;
    this.loadingParams = params.loadingParams;
    this._params = params;
    this.canvasFactory = factory.canvasFactory;
    this.filterFactory = factory.filterFactory;
    this.binaryDataFactory = factory.binaryDataFactory;
    this.pagesMapper = pagesMapper;
    this.destroyed = false;
    this.destroyCapability = null;
    this.setupMessageHandler();
  }
  updatePage(page) {
    this.#pageCache.set(page._id, page);
    this.#pagePromises.set(page._pageIndex, Promise.resolve(page));
  }
  #cacheSimpleMethod(name, data = null) {
    return this.#methodPromises.getOrInsertComputed(name, () => this.messageHandler.sendWithPromise(name, data));
  }
  #onProgress({
    loaded,
    total
  }) {
    this.loadingTask.onProgress?.({
      loaded,
      total,
      percent: total ? MathClamp(Math.round(loaded / total * 100), 0, 100) : NaN
    });
  }
  get annotationStorage() {
    return shadow(this, "annotationStorage", new AnnotationStorage());
  }
  getRenderingIntent(intent, annotationMode = AnnotationMode.ENABLE, printAnnotationStorage = null, isEditing = false, isOpList = false) {
    let renderingIntent = RenderingIntentFlag.DISPLAY;
    let annotationStorageSerializable = SerializableEmpty;
    switch (intent) {
      case "any":
        renderingIntent = RenderingIntentFlag.ANY;
        break;
      case "display":
        break;
      case "print":
        renderingIntent = RenderingIntentFlag.PRINT;
        break;
      default:
        warn(`getRenderingIntent - invalid intent: ${intent}`);
    }
    const annotationStorage = renderingIntent & RenderingIntentFlag.PRINT && printAnnotationStorage instanceof PrintAnnotationStorage ? printAnnotationStorage : this.annotationStorage;
    switch (annotationMode) {
      case AnnotationMode.DISABLE:
        renderingIntent += RenderingIntentFlag.ANNOTATIONS_DISABLE;
        break;
      case AnnotationMode.ENABLE:
        break;
      case AnnotationMode.ENABLE_FORMS:
        renderingIntent += RenderingIntentFlag.ANNOTATIONS_FORMS;
        break;
      case AnnotationMode.ENABLE_STORAGE:
        renderingIntent += RenderingIntentFlag.ANNOTATIONS_STORAGE;
        annotationStorageSerializable = annotationStorage.serializable;
        break;
      default:
        warn(`getRenderingIntent - invalid annotationMode: ${annotationMode}`);
    }
    if (isEditing) {
      renderingIntent += RenderingIntentFlag.IS_EDITING;
    }
    if (isOpList) {
      renderingIntent += RenderingIntentFlag.OPLIST;
    }
    const {
      ids: modifiedIds,
      hash: modifiedIdsHash
    } = annotationStorage.modifiedIds;
    const cacheKeyBuf = [renderingIntent, annotationStorageSerializable.hash, modifiedIdsHash];
    return {
      renderingIntent,
      cacheKey: cacheKeyBuf.join("_"),
      annotationStorageSerializable,
      modifiedIds
    };
  }
  destroy() {
    if (this.destroyCapability) {
      return this.destroyCapability.promise;
    }
    this.destroyed = true;
    this.destroyCapability = Promise.withResolvers();
    this.#passwordCapability?.reject(new Error("Worker was destroyed during onPassword callback"));
    const waitOn = [];
    for (const page of this.#pageCache.values()) {
      waitOn.push(page._destroy());
    }
    this.#pageCache.clear();
    this.#pagePromises.clear();
    this.#pageRefCache.clear();
    if (Object.hasOwn(this, "annotationStorage")) {
      this.annotationStorage.resetModified();
    }
    const terminated = this.messageHandler.sendWithPromise("Terminate", null);
    waitOn.push(terminated);
    Promise.all(waitOn).then(() => {
      this.commonObjs.clear();
      this.fontLoader.clear();
      this.#methodPromises.clear();
      this.filterFactory.destroy();
      TextLayer.cleanup();
      this.#networkStream?.cancelAllRequests(new AbortException("Worker was terminated."));
      this.messageHandler?.destroy();
      this.messageHandler = null;
      this.rendererWorker = null;
      this.destroyCapability.resolve();
    }, this.destroyCapability.reject);
    return this.destroyCapability.promise;
  }
  setupMessageHandler() {
    const {
      messageHandler,
      loadingTask
    } = this;
    messageHandler.on("GetReader", (data, sink) => {
      assert(this.#networkStream, "GetReader - no `BasePDFStream` instance available.");
      this.#fullReader = this.#networkStream.getFullReader();
      this.#fullReader.onProgress = evt => this.#onProgress(evt);
      sink.onPull = () => {
        this.#fullReader.read().then(function ({
          value,
          done
        }) {
          if (done) {
            sink.close();
            return;
          }
          assert(value instanceof ArrayBuffer, "GetReader - expected an ArrayBuffer.");
          sink.enqueue(new Uint8Array(value), 1, [value]);
        }).catch(reason => {
          sink.error(reason);
        });
      };
      sink.onCancel = reason => {
        this.#fullReader.cancel(reason);
        sink.ready.catch(readyReason => {
          if (this.destroyed) {
            return;
          }
          throw readyReason;
        });
      };
    });
    messageHandler.on("ReaderHeadersReady", async data => {
      await this.#fullReader.headersReady;
      const {
        isStreamingSupported,
        isRangeSupported,
        contentLength
      } = this.#fullReader;
      if (isStreamingSupported && isRangeSupported) {
        this.#fullReader.onProgress = null;
      }
      return {
        isStreamingSupported,
        isRangeSupported,
        contentLength
      };
    });
    messageHandler.on("GetRangeReader", (data, sink) => {
      assert(this.#networkStream, "GetRangeReader - no `BasePDFStream` instance available.");
      const rangeReader = this.#networkStream.getRangeReader(data.begin, data.end);
      if (!rangeReader) {
        sink.close();
        return;
      }
      sink.onPull = () => {
        rangeReader.read().then(function ({
          value,
          done
        }) {
          if (done) {
            sink.close();
            return;
          }
          assert(value instanceof ArrayBuffer, "GetRangeReader - expected an ArrayBuffer.");
          sink.enqueue(new Uint8Array(value), 1, [value]);
        }).catch(reason => {
          sink.error(reason);
        });
      };
      sink.onCancel = reason => {
        rangeReader.cancel(reason);
        sink.ready.catch(readyReason => {
          if (this.destroyed) {
            return;
          }
          throw readyReason;
        });
      };
    });
    messageHandler.on("GetDoc", ({
      pdfInfo
    }) => {
      this.pagesMapper.pagesNumber = pdfInfo.numPages;
      this._numPages = pdfInfo.numPages;
      this._htmlForXfa = pdfInfo.htmlForXfa;
      delete pdfInfo.htmlForXfa;
      loadingTask._capability.resolve(new PDFDocumentProxy(pdfInfo, this));
    });
    messageHandler.on("DocException", ex => {
      loadingTask._capability.reject(wrapReason(ex));
    });
    messageHandler.on("PasswordRequest", ex => {
      this.#passwordCapability = Promise.withResolvers();
      try {
        if (!loadingTask.onPassword) {
          throw wrapReason(ex);
        }
        const updatePassword = password => {
          if (password instanceof Error) {
            this.#passwordCapability.reject(password);
          } else {
            this.#passwordCapability.resolve({
              password
            });
          }
        };
        loadingTask.onPassword(updatePassword, ex.code);
      } catch (err) {
        this.#passwordCapability.reject(err);
      }
      return this.#passwordCapability.promise;
    });
    messageHandler.on("DataLoaded", data => {
      this.#onProgress({
        loaded: data.length,
        total: data.length
      });
      this.downloadInfoCapability.resolve(data);
    });
    messageHandler.on("StartRenderPage", data => {
      if (this.destroyed) {
        return;
      }
      const page = this.#pageCache.get(data.pageProxyId);
      page._startRenderPage(data.transparency, data.cacheKey);
    });
    const objectHandler = new ObjectHandler({
      messageHandler,
      commonObjs: this.commonObjs,
      fontLoader: this.fontLoader,
      pageCache: this.#pageCache,
      pdfBug: this._params.pdfBug
    });
    this.rendererWorker?.promise.then(() => {
      this.rendererWorker?.messageHandler?.on("FontFallback", data => this.destroyed ? null : messageHandler.sendWithPromise("FontFallback", data));
    }, () => {});
    messageHandler.on("commonobj", ([id, type, exportedData]) => {
      if (this.destroyed) {
        return null;
      }
      const {
        rendererWorker
      } = this;
      if (type === "CopyLocalImage") {
        if (this.commonObjs.has(id)) {
          return null;
        }
        const dataLen = objectHandler.resolveCommonObject(id, type, exportedData);
        if (dataLen) {
          rendererWorker?.sendCommonObj(id, "Image", this.commonObjs.get(id));
        }
        return dataLen;
      }
      rendererWorker?.sendCommonObj(id, type, exportedData);
      if (!this.commonObjs.has(id)) {
        objectHandler.resolveCommonObject(id, type, exportedData);
        if (type === "Pattern" && this.commonObjs.get(id)[0] === "Mesh") {
          this.#hasMeshPattern = true;
        }
      }
      return null;
    });
    messageHandler.on("obj", ([id, pageProxyId, type, imageData]) => {
      if (this.destroyed) {
        return;
      }
      if (type === "Pattern" && imageData[0] === "Mesh") {
        this.#hasMeshPattern = true;
      }
      if (objectHandler.resolveObject(id, pageProxyId, type, imageData)) {
        this.rendererWorker?.sendObj(id, pageProxyId, type, imageData);
      }
    });
    messageHandler.on("DocProgress", data => {
      if (this.destroyed) {
        return;
      }
      this.#onProgress(data);
    });
    messageHandler.on("FetchBinaryData", async data => {
      if (this.destroyed) {
        throw new Error("Worker was destroyed.");
      }
      if (!this.binaryDataFactory) {
        throw new Error("`BinaryDataFactory` not initialized, see the `useWorkerFetch` parameter.");
      }
      return this.binaryDataFactory.fetch(data);
    });
  }
  getData() {
    return this.messageHandler.sendWithPromise("GetData", null);
  }
  saveDocument(printToPDF = null) {
    if (this.annotationStorage.size <= 0) {
      warn("saveDocument called while `annotationStorage` is empty, " + "please use the getData-method instead.");
    }
    const {
      map,
      transfer
    } = this.annotationStorage.serializable;
    return this.messageHandler.sendWithPromise("SaveDocument", {
      isPureXfa: !!this._htmlForXfa,
      numPages: this._numPages,
      annotationStorage: map,
      supportsPrintToPDF: this.#printToPDF !== null,
      filename: this.#fullReader?.filename ?? null
    }, transfer).finally(() => {
      this.#printToPDF = null;
      this.annotationStorage.resetModified();
    });
  }
  extractPages(pageInfos, copyLevels = null) {
    const params = {
      pageInfos
    };
    let transfer;
    const ImageBitmapCtor = globalThis.ImageBitmap;
    if (typeof ImageBitmapCtor === "function") {
      const infos = Array.isArray(pageInfos) ? pageInfos : [pageInfos];
      for (const pageInfo of infos) {
        if (pageInfo?.image instanceof ImageBitmapCtor) {
          (transfer ||= []).push(pageInfo.image);
        }
      }
    }
    if (this.annotationStorage.size > 0) {
      const serialized = this.annotationStorage.serializable;
      let {
        map
      } = serialized;
      if (serialized.transfer?.length) {
        if (transfer) {
          transfer.push(...serialized.transfer);
        } else {
          transfer = serialized.transfer;
        }
      }
      const mapping = this.pagesMapper.getMapping();
      if (mapping) {
        const remapped = new Map();
        for (const [k, v] of map) {
          if (v?.pageIndex !== undefined && v.pageIndex >= 0 && v.pageIndex < mapping.length) {
            const copyLevel = copyLevels?.[v.pageIndex] ?? 0;
            const sourceIdx = mapping[v.pageIndex] - 1;
            if (sourceIdx !== v.pageIndex || copyLevel !== 0) {
              remapped.set(k, {
                ...v,
                pageIndex: sourceIdx,
                copyLevel
              });
              continue;
            }
          }
          remapped.set(k, v);
        }
        map = remapped;
      }
      params.annotationStorage = map;
    }
    return this.messageHandler.sendWithPromise("ExtractPages", params, transfer).finally(() => {
      this.annotationStorage.resetModified();
    });
  }
  waitForGPU() {
    return this._params.enableWebGPU && this.#hasMeshPattern && !isGPUReady() ? initGPU() : null;
  }
  getPage(pageNumber) {
    if (!Number.isInteger(pageNumber) || pageNumber <= 0 || pageNumber > this.pagesMapper.pagesNumber) {
      return Promise.reject(new Error("Invalid page request."));
    }
    const pageIndex = pageNumber - 1;
    const newPageIndex = this.pagesMapper.getPageId(pageNumber) - 1;
    const cachedPromise = this.#pagePromises.get(pageIndex);
    if (cachedPromise) {
      return cachedPromise;
    }
    const promise = this.messageHandler.sendWithPromise("GetPage", {
      pageIndex: newPageIndex
    }).then(pageInfo => {
      if (this.destroyed) {
        throw new Error("Transport destroyed");
      }
      if (pageInfo.refStr) {
        this.#pageRefCache.set(pageInfo.refStr, newPageIndex);
      }
      const page = new PDFPageProxy(pageIndex, pageInfo, this, this.pagesMapper, this._params.pdfBug);
      this.#pageCache.set(page._id, page);
      return page;
    });
    this.#pagePromises.set(pageIndex, promise);
    return promise;
  }
  async getPageIndex(ref) {
    if (!isRefProxy(ref)) {
      throw new Error("Invalid pageIndex request.");
    }
    const index = await this.messageHandler.sendWithPromise("GetPageIndex", {
      num: ref.num,
      gen: ref.gen
    });
    const pageNumber = this.pagesMapper.getPageNumber(index + 1);
    if (pageNumber === 0) {
      throw new Error("GetPageIndex: page has been removed.");
    }
    return pageNumber - 1;
  }
  getAnnotations(pageIndex, intent) {
    return this.messageHandler.sendWithPromise("GetAnnotations", {
      pageIndex: this.pagesMapper.getPageId(pageIndex + 1) - 1,
      intent
    });
  }
  getFieldObjects() {
    return this.#cacheSimpleMethod("GetFieldObjects");
  }
  getSignatures() {
    return this.#cacheSimpleMethod("GetSignatures");
  }
  getSignatureData(id) {
    return this.messageHandler.sendWithPromise("GetSignatureData", id);
  }
  hasJSActions() {
    return this.#cacheSimpleMethod("HasJSActions");
  }
  getCalculationOrderIds() {
    return this.messageHandler.sendWithPromise("GetCalculationOrderIds", null);
  }
  getDestinations() {
    return this.messageHandler.sendWithPromise("GetDestinations", null);
  }
  getDestination(id) {
    return typeof id !== "string" ? Promise.reject(new Error("Invalid destination request.")) : this.messageHandler.sendWithPromise("GetDestination", {
      id
    });
  }
  getPageLabels() {
    return this.messageHandler.sendWithPromise("GetPageLabels", null);
  }
  getPageLayout() {
    return this.messageHandler.sendWithPromise("GetPageLayout", null);
  }
  getPageMode() {
    return this.messageHandler.sendWithPromise("GetPageMode", null);
  }
  getViewerPreferences() {
    return this.messageHandler.sendWithPromise("GetViewerPreferences", null);
  }
  getOpenAction() {
    return this.messageHandler.sendWithPromise("GetOpenAction", null);
  }
  getAttachments() {
    return this.messageHandler.sendWithPromise("GetAttachments", null);
  }
  getAttachmentContent(id) {
    return this.messageHandler.sendWithPromise("GetAttachmentContent", id);
  }
  getAnnotationsByType(types, pageIndexesToSkip) {
    return this.messageHandler.sendWithPromise("GetAnnotationsByType", {
      types,
      pageIndexesToSkip
    });
  }
  getDocJSActions() {
    return this.#cacheSimpleMethod("GetDocJSActions");
  }
  getPageJSActions(pageIndex) {
    return this.messageHandler.sendWithPromise("GetPageJSActions", {
      pageIndex: this.pagesMapper.getPageId(pageIndex + 1) - 1
    });
  }
  getStructTree(pageIndex) {
    return this.messageHandler.sendWithPromise("GetStructTree", {
      pageIndex: this.pagesMapper.getPageId(pageIndex + 1) - 1
    });
  }
  getOutline() {
    return this.messageHandler.sendWithPromise("GetOutline", null);
  }
  getOptionalContentConfig(renderingIntent) {
    const name = "GetOptionalContentConfig";
    return this.#methodPromises.getOrInsertComputed(name, () => this.messageHandler.sendWithPromise(name, null).catch(reason => {
      warn(`${name}: "${reason}".`);
      return null;
    })).then(data => new OptionalContentConfig(data, renderingIntent));
  }
  getPermissions() {
    return this.messageHandler.sendWithPromise("GetPermissions", null);
  }
  getMetadata() {
    const name = "GetMetadata";
    return this.#methodPromises.getOrInsertComputed(name, () => this.messageHandler.sendWithPromise(name, null).then(results => ({
      info: results[0],
      metadata: results[1] ? new Metadata(results[1]) : null,
      contentDispositionFilename: this.#fullReader?.filename ?? null,
      contentLength: this.#fullReader?.contentLength ?? null,
      hasStructTree: results[2]
    })));
  }
  getMarkInfo() {
    return this.messageHandler.sendWithPromise("GetMarkInfo", null);
  }
  async startCleanup(keepLoadedFonts = false) {
    if (this.destroyed) {
      return;
    }
    await this.messageHandler.sendWithPromise("Cleanup", null);
    for (const page of this.#pageCache.values()) {
      const cleanupSuccessful = page.cleanup();
      if (!cleanupSuccessful) {
        throw new Error(`startCleanup: Page ${page.pageNumber} is currently rendering.`);
      }
    }
    this.commonObjs.clear();
    if (!keepLoadedFonts) {
      this.fontLoader.clear();
    }
    this.rendererWorker?.cleanup(keepLoadedFonts);
    this.#methodPromises.clear();
    this.filterFactory.destroy(true);
    TextLayer.cleanup();
  }
  cleanupPage(pageProxyId) {
    if (!this.destroyed) {
      this.messageHandler.send("CleanupPage", {
        pageProxyId
      });
    }
    this.rendererWorker?.cleanupPage(pageProxyId);
  }
  cachedPageNumber(ref) {
    if (!isRefProxy(ref)) {
      return null;
    }
    const refStr = ref.gen === 0 ? `${ref.num}R` : `${ref.num}R${ref.gen}`;
    const pageIndex = this.#pageRefCache.get(refStr);
    if (pageIndex >= 0) {
      const pageNumber = this.pagesMapper.getPageNumber(pageIndex + 1);
      if (pageNumber !== 0) {
        return pageNumber;
      }
    }
    return null;
  }
}
class RenderTask {
  _internalRenderTask = null;
  onContinue = null;
  onError = null;
  onFrame = null;
  constructor(internalRenderTask) {
    this._internalRenderTask = internalRenderTask;
  }
  get promise() {
    return this._internalRenderTask.capability.promise;
  }
  cancel(extraDelay = 0) {
    this._internalRenderTask.cancel(null, extraDelay);
  }
  get separateAnnots() {
    const {
      separateAnnots
    } = this._internalRenderTask.operatorList;
    if (!separateAnnots) {
      return false;
    }
    const {
      annotationCanvasMap
    } = this._internalRenderTask;
    return separateAnnots.form || separateAnnots.canvas && annotationCanvasMap?.size > 0;
  }
  get imageCoordinates() {
    return this._internalRenderTask.imageCoordinates || null;
  }
  get isWorkerRendering() {
    return this._internalRenderTask.isWorkerRendering;
  }
}
class InternalRenderTask {
  #dependencyTracker = null;
  #imagesTracker = null;
  #rAF = null;
  #rendererTask = null;
  #waitForGPU = null;
  static #canvasInUse = new WeakSet();
  constructor({
    callback,
    params,
    objs,
    commonObjs,
    annotationCanvasMap,
    operatorList,
    pageIndex,
    pageProxyId,
    canvasFactory,
    filterFactory,
    useRequestAnimationFrame = false,
    pdfBug = false,
    pageColors = null,
    operationsFilter = null,
    rendererWorker = null,
    waitForGPU = null
  }) {
    this.callback = callback;
    this.params = params;
    this.objs = objs;
    this.commonObjs = commonObjs;
    this.annotationCanvasMap = annotationCanvasMap;
    this.operatorListIdx = null;
    this.operatorList = operatorList;
    this._pageIndex = pageIndex;
    this.canvasFactory = canvasFactory;
    this.filterFactory = filterFactory;
    this._pdfBug = pdfBug;
    this.pageColors = pageColors;
    this.running = false;
    this.graphicsReadyCallback = null;
    this.graphicsReady = false;
    this._useRequestAnimationFrame = useRequestAnimationFrame === true && typeof window !== "undefined";
    this.cancelled = false;
    this.capability = Promise.withResolvers();
    this.task = new RenderTask(this);
    this._cancelBound = this.cancel.bind(this);
    this._continueBound = this._continue.bind(this);
    this._scheduleNextBound = this._scheduleNext.bind(this);
    this._nextBound = this._next.bind(this);
    this._canvas = params.canvas;
    this._canvasContext = params.canvas ? null : params.canvasContext;
    this._operationsFilter = operationsFilter;
    this.#waitForGPU = waitForGPU;
    this.#rendererTask = rendererWorker?.createRenderTask({
      pageProxyId,
      operatorList,
      params,
      pageColors,
      canvasFactory,
      annotationCanvasMap,
      onFrame: () => this.task.onFrame?.(),
      onError: reason => this.cancel(reason)
    }) ?? null;
  }
  get completed() {
    return this.capability.promise.catch(() => {});
  }
  get isWorkerRendering() {
    return !!this.#rendererTask;
  }
  get imageCoordinates() {
    return this.#rendererTask ? this.#rendererTask.imageCoordinates : this.#imagesTracker?.take();
  }
  get recordedBBoxes() {
    return this.#rendererTask ? this.#rendererTask.recordedBBoxes : this.#dependencyTracker?.take();
  }
  get debugMetadata() {
    return this.#dependencyTracker?.takeDebugMetadata() ?? null;
  }
  async initializeGraphics({
    transparency = false,
    optionalContentConfig
  }) {
    if (this.cancelled) {
      return;
    }
    if (this._canvas) {
      if (InternalRenderTask.#canvasInUse.has(this._canvas)) {
        throw new Error("Cannot use the same canvas during multiple render() operations. " + "Use different canvas or ensure previous operations were " + "cancelled or completed.");
      }
      InternalRenderTask.#canvasInUse.add(this._canvas);
    }
    if (this._pdfBug && globalThis.StepperManager?.enabled) {
      this.stepper = globalThis.StepperManager.create(this._pageIndex);
      this.stepper.init(this.operatorList);
      this.stepper.nextBreakPoint = this.stepper.getNextBreakPoint();
    }
    if (this.#rendererTask) {
      const initialized = await this.#rendererTask.initialize(transparency, optionalContentConfig);
      if (this.cancelled) {
        return;
      }
      if (!initialized) {
        this.#rendererTask = null;
      }
    }
    if (!this.#rendererTask) {
      const {
        viewport,
        transform,
        background,
        recordOperations,
        recordImages,
        recordForDebugger
      } = this.params;
      const canvasContext = this._canvasContext || this.canvasFactory.getNoAlphaContext(this._canvas);
      const {
        dependencyTracker,
        imagesTracker
      } = createCanvasTrackers(this._canvas, this.operatorList.fnArray.length, {
        recordOperations,
        recordImages,
        recordDebugMetadata: recordForDebugger
      });
      this.#dependencyTracker = dependencyTracker;
      this.#imagesTracker = imagesTracker;
      this.gfx = new CanvasGraphics(canvasContext, this.commonObjs, this.objs, this.canvasFactory, this.filterFactory, {
        optionalContentConfig
      }, this.annotationCanvasMap, this.pageColors, dependencyTracker, imagesTracker);
      this.gfx.beginDrawing({
        transform,
        viewport,
        transparency,
        background
      });
    }
    this.operatorListIdx = 0;
    this.graphicsReady = true;
    this.graphicsReadyCallback?.();
  }
  cancel(error = null, extraDelay = 0) {
    this.running = false;
    this.cancelled = true;
    this.#rendererTask?.cancel();
    this.gfx?.endDrawing();
    if (this.#rAF) {
      window.cancelAnimationFrame(this.#rAF);
      this.#rAF = null;
    }
    InternalRenderTask.#canvasInUse.delete(this._canvas);
    error ||= new RenderingCancelledException(`Rendering cancelled, page ${this._pageIndex + 1}`, extraDelay);
    this.callback(error);
    this.task.onError?.(error);
  }
  operatorListChanged() {
    if (!this.graphicsReady) {
      this.graphicsReadyCallback ||= this._continueBound;
      return;
    }
    this.#dependencyTracker?.growOperationsCount(this.operatorList.fnArray.length);
    this.stepper?.updateOperatorList(this.operatorList);
    if (this.running) {
      return;
    }
    this._continue();
  }
  _continue() {
    this.running = true;
    if (this.cancelled) {
      return;
    }
    if (this.task.onContinue) {
      this.task.onContinue(this._scheduleNextBound);
    } else {
      this._scheduleNext();
    }
  }
  _scheduleNext() {
    if (this._useRequestAnimationFrame) {
      this.#rAF = window.requestAnimationFrame(() => {
        this.#rAF = null;
        this._nextBound().catch(this._cancelBound);
      });
    } else {
      Promise.resolve().then(this._nextBound).catch(this._cancelBound);
    }
  }
  async _next() {
    if (this.cancelled) {
      return;
    }
    if (!this.#rendererTask) {
      const gpuPromise = this.#waitForGPU?.();
      if (gpuPromise) {
        await gpuPromise;
        if (this.cancelled) {
          return;
        }
      }
    }
    const {
      operatorList
    } = this;
    const {
      lastChunk
    } = operatorList;
    if (this.#rendererTask) {
      this.operatorListIdx = await this.#rendererTask.executeOperatorList(operatorList, this.operatorListIdx, this._operationsFilter);
      if (this.cancelled) {
        return;
      }
      if (this.operatorListIdx !== operatorList.argsArray.length || lastChunk !== operatorList.lastChunk) {
        this._continue();
        return;
      }
    } else {
      this.operatorListIdx = this.gfx.executeOperatorList(operatorList, this.operatorListIdx, this._continueBound, null, this.stepper, this._operationsFilter);
    }
    if (this.operatorListIdx === operatorList.argsArray.length) {
      this.running = false;
      if (lastChunk) {
        this.gfx?.endDrawing();
        InternalRenderTask.#canvasInUse.delete(this._canvas);
        this.callback();
      }
    }
  }
}
const version = "6.5.0";
const build = "0a41533";
export { build, getDocument, PDFDataRangeTransport, PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, PDFWorker, RenderTask, version };