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
import "core-js/modules/es.iterator.take.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import "core-js/modules/es.typed-array.with.js";
import "core-js/modules/es.uint8-array.set-from-base64.js";
import "core-js/modules/es.uint8-array.set-from-hex.js";
import "core-js/modules/es.uint8-array.to-base64.js";
import "core-js/modules/es.uint8-array.to-hex.js";
import "core-js/modules/web.self.js";
import { CanvasGraphics, getAnnotationCanvasName } from "./canvas.js";
import { initGPU, isGPUReady } from "./webgpu.js";
import { isNodeJS, makeMap, setVerbosityLevel, warn } from "../shared/util.js";
import { createCanvasTrackers } from "./canvas_dependency_tracker.js";
import { FontLoader } from "./font_loader.js";
import { MessageHandler } from "../shared/message_handler.js";
import { ObjectHandler } from "./object_handler.js";
import { OffscreenCanvasFactory } from "./offscreen_canvas_factory.js";
import { OptionalContentConfig } from "./optional_content_config.js";
import { PDFObjects } from "./pdf_objects.js";
import { WorkerFilterFactory } from "./worker_filter_factory.js";
const PARTIAL_FRAME_TIME = 500;
class RendererMessageHandler {
  static #canvasFactory;
  static #commonObjs = new PDFObjects();
  static #connection = null;
  static #enableHWA = false;
  static #enableWebGPU = false;
  static #filterFactory;
  static #fontLoader = new FontLoader({
    ownerDocument: globalThis
  });
  static #hasMeshPattern = false;
  static #objsMap = new Map();
  static #operatorLists = new Map();
  static #renderTaskStates = new Map();
  static #yieldChannel = null;
  static #yieldResolvers = [];
  static {
    if (typeof window === "undefined" && !isNodeJS && typeof self !== "undefined" && typeof self.postMessage === "function" && "onmessage" in self) {
      this.#initializeFromPort(self);
    }
  }
  static #getPageObjs(pageProxyId) {
    return this.#objsMap.getOrInsertComputed(pageProxyId, () => new PDFObjects());
  }
  static #getOperatorList(pageProxyId, operatorListId) {
    return this.#operatorLists.getOrInsertComputed(pageProxyId, makeMap).getOrInsertComputed(operatorListId, () => ({
      fnArray: [],
      argsArray: [],
      pathCache: new Map()
    }));
  }
  static #collectAnnotationBitmaps(renderTaskState, transfers) {
    const map = renderTaskState.gfx?.annotationCanvasMap;
    if (!map?.size) {
      return null;
    }
    const tuples = [];
    for (const [id, value] of map) {
      for (const canvas of Array.isArray(value) ? value : [value]) {
        const bitmap = canvas.transferToImageBitmap();
        tuples.push([id, getAnnotationCanvasName(canvas), bitmap]);
        transfers.push(bitmap);
      }
    }
    return tuples;
  }
  static async #sendFrame(handler, renderTaskState, isFinal) {
    const {
      canvas,
      renderTaskId
    } = renderTaskState;
    let bitmap = null;
    if (canvas.width === 0 || canvas.height === 0) {
      if (!isFinal) {
        return;
      }
    } else if (isFinal) {
      bitmap = canvas.transferToImageBitmap();
    } else {
      const {
        transparentCanvas
      } = renderTaskState.gfx;
      if (transparentCanvas) {
        const composite = new OffscreenCanvas(canvas.width, canvas.height);
        const ctx = composite.getContext("2d");
        ctx.drawImage(canvas, 0, 0);
        ctx.drawImage(transparentCanvas, 0, 0);
        bitmap = composite.transferToImageBitmap();
        composite.width = composite.height = 0;
      } else {
        bitmap = await createImageBitmap(canvas);
        if (renderTaskState.aborted) {
          bitmap.close();
          return;
        }
      }
    }
    const transfers = bitmap ? [bitmap] : [];
    const annotationBitmaps = isFinal ? this.#collectAnnotationBitmaps(renderTaskState, transfers) : null;
    handler.send("RenderFrame", {
      renderTaskId,
      bitmap,
      annotationBitmaps
    }, transfers);
  }
  static async #maybeSendInterimFrame(handler, renderTaskState) {
    if (!renderTaskState.partialFrames || renderTaskState.aborted || Date.now() - renderTaskState.lastFrameTime < PARTIAL_FRAME_TIME || renderTaskState.operatorListIdx === renderTaskState.lastFrameIdx) {
      return;
    }
    try {
      await this.#sendFrame(handler, renderTaskState, false);
    } catch (ex) {
      warn(`Failed to send an interim frame: ${ex.message}`);
    }
    renderTaskState.lastFrameTime = Date.now();
    renderTaskState.lastFrameIdx = renderTaskState.operatorListIdx;
  }
  static #cleanupPage(pageProxyId) {
    this.#objsMap.get(pageProxyId)?.clear();
    this.#objsMap.delete(pageProxyId);
    this.#operatorLists.delete(pageProxyId);
    for (const [renderTaskId, renderTaskState] of this.#renderTaskStates) {
      if (renderTaskState.pageProxyId === pageProxyId) {
        this.#cleanupRenderTask(renderTaskId);
      }
    }
  }
  static #cleanupRenderTask(renderTaskId, keepCanvas = false) {
    const renderTaskState = this.#renderTaskStates.get(renderTaskId);
    if (!renderTaskState) {
      return;
    }
    renderTaskState.aborted = true;
    renderTaskState.continueResolve?.();
    renderTaskState.gfx?.endDrawing();
    if (!keepCanvas) {
      this.#releaseCanvases(renderTaskState);
    }
    this.#renderTaskStates.delete(renderTaskId);
  }
  static #releaseCanvases({
    canvas,
    gfx
  }) {
    canvas.width = canvas.height = 0;
    const map = gfx?.annotationCanvasMap;
    if (!map) {
      return;
    }
    for (const value of map.values()) {
      for (const annotationCanvas of Array.isArray(value) ? value : [value]) {
        annotationCanvas.width = annotationCanvas.height = 0;
      }
    }
    map.clear();
  }
  static #appendFromSharedOperatorList(renderTaskState, length, operationsFilterMask, lastChunk) {
    const {
      operatorList,
      sharedOperatorList
    } = renderTaskState;
    const {
      fnArray,
      argsArray
    } = sharedOperatorList;
    for (let i = operatorList.fnArray.length; i < length; i++) {
      operatorList.fnArray.push(fnArray[i]);
      operatorList.argsArray.push(argsArray[i]);
    }
    if (operationsFilterMask) {
      const mask = renderTaskState.operationsFilterMask ||= [];
      for (let i = 0, ii = operationsFilterMask.length; i < ii; i++) {
        mask.push(operationsFilterMask[i]);
      }
    }
    operatorList.lastChunk = lastChunk;
    renderTaskState.dependencyTracker?.growOperationsCount(operatorList.fnArray.length);
  }
  static async #executeOperatorList(handler, renderTaskState) {
    const {
      operatorList,
      gfx,
      operationsFilterMask
    } = renderTaskState;
    const operationsFilter = operationsFilterMask ? i => operationsFilterMask[i] : null;
    while (!renderTaskState.aborted) {
      const {
        promise,
        resolve,
        reject
      } = Promise.withResolvers();
      renderTaskState.continueResolve = resolve;
      renderTaskState.operatorListIdx = gfx.executeOperatorList(operatorList, renderTaskState.operatorListIdx, resolve, reject, undefined, operationsFilter);
      if (renderTaskState.operatorListIdx === operatorList.argsArray.length) {
        return renderTaskState.operatorListIdx;
      }
      await this.#maybeSendInterimFrame(handler, renderTaskState);
      await promise;
      if (renderTaskState.aborted) {
        break;
      }
      await this.#yield();
    }
    return renderTaskState.operatorListIdx;
  }
  static #yield() {
    if (!this.#yieldChannel) {
      this.#yieldChannel = new MessageChannel();
      this.#yieldChannel.port1.onmessage = () => {
        this.#yieldResolvers.shift()();
      };
    }
    const {
      promise,
      resolve
    } = Promise.withResolvers();
    this.#yieldResolvers.push(resolve);
    this.#yieldChannel.port2.postMessage(null);
    return promise;
  }
  static #setupObjectHandler(handler) {
    const objectHandler = new ObjectHandler({
      messageHandler: handler,
      commonObjs: this.#commonObjs,
      fontLoader: this.#fontLoader,
      pageCache: this.#objsMap,
      shouldCreatePageObjs: true
    });
    handler.on("commonobj", ([id, type, exportedData]) => {
      if (this.#commonObjs.has(id)) {
        return;
      }
      objectHandler.resolveCommonObject(id, type, exportedData);
      if (type === "Pattern" && this.#commonObjs.get(id)[0] === "Mesh") {
        this.#hasMeshPattern = true;
      }
    });
    handler.on("obj", ([id, pageProxyId, type, imageData]) => {
      if (type === "Pattern" && imageData[0] === "Mesh") {
        this.#hasMeshPattern = true;
      }
      objectHandler.resolveObject(id, pageProxyId, type, imageData);
    });
    handler.on("objFailed", ({
      id,
      pageProxyId,
      reason
    }) => {
      const error = new Error(reason);
      if (pageProxyId === null) {
        this.#commonObjs.reject(id, error);
        return;
      }
      this.#getPageObjs(pageProxyId).reject(id, error);
    });
  }
  static #setup(handler) {
    handler.on("configure", data => {
      setVerbosityLevel(data.verbosity);
      this.#enableHWA = data.enableHWA;
      this.#enableWebGPU = data.enableWebGPU;
      if (this.#enableWebGPU) {
        initGPU();
      }
    });
    this.#setupObjectHandler(handler);
    handler.on("cleanupPage", ({
      pageProxyId
    }) => {
      this.#cleanupPage(pageProxyId);
    });
    handler.on("Cleanup", ({
      keepLoadedFonts
    }) => {
      this.#commonObjs.clear();
      if (!keepLoadedFonts) {
        this.#fontLoader.clear();
      }
      this.#filterFactory?.destroy(true);
    });
    handler.on("CleanupRenderTask", ({
      renderTaskId
    }) => {
      this.#cleanupRenderTask(renderTaskId);
    });
    handler.on("AppendOperatorList", ({
      pageProxyId,
      operatorListId,
      fnArray,
      argsArray
    }) => {
      const operatorList = this.#getOperatorList(pageProxyId, operatorListId);
      for (let i = 0, ii = fnArray.length; i < ii; i++) {
        operatorList.fnArray.push(fnArray[i]);
        operatorList.argsArray.push(argsArray[i]);
      }
    });
    handler.on("InitializeGraphics", async data => {
      const {
        width,
        height,
        pageProxyId,
        operatorListId,
        renderTaskId,
        hasAnnotationCanvasMap = false,
        transform,
        viewport,
        transparency,
        background,
        pixelRatio,
        recordOperations = false,
        recordImages = false,
        partialFrames = false
      } = data;
      const canvas = new OffscreenCanvas(width, height);
      const sharedOperatorList = this.#getOperatorList(pageProxyId, operatorListId);
      const renderTaskState = {
        pageProxyId,
        renderTaskId,
        canvas,
        partialFrames,
        lastFrameTime: Date.now(),
        gfx: null,
        sharedOperatorList,
        dependencyTracker: null,
        imagesTracker: null,
        operatorList: {
          fnArray: [],
          argsArray: [],
          lastChunk: false,
          pathCache: sharedOperatorList.pathCache
        },
        operatorListIdx: 0,
        lastFrameIdx: 0,
        operationsFilterMask: null,
        continueResolve: null,
        aborted: false
      };
      this.#renderTaskStates.set(renderTaskId, renderTaskState);
      try {
        const objs = this.#getPageObjs(pageProxyId);
        const optionalContentConfig = OptionalContentConfig.fromSerializable(data.optionalContentConfig);
        const canvasFactory = this.#canvasFactory ??= new OffscreenCanvasFactory({
          enableHWA: this.#enableHWA
        });
        const filterFactory = this.#filterFactory ??= new WorkerFilterFactory();
        const annotationCanvases = hasAnnotationCanvasMap ? new Map() : null;
        const {
          dependencyTracker,
          imagesTracker
        } = createCanvasTrackers(canvas, 0, {
          recordOperations,
          recordImages
        });
        const gfx = new CanvasGraphics(canvasFactory.getNoAlphaContext(canvas), this.#commonObjs, objs, canvasFactory, filterFactory, {
          optionalContentConfig,
          pixelRatio
        }, annotationCanvases, null, dependencyTracker, imagesTracker);
        gfx.beginDrawing({
          transform,
          viewport,
          transparency,
          background
        });
        renderTaskState.gfx = gfx;
        renderTaskState.dependencyTracker = dependencyTracker;
        renderTaskState.imagesTracker = imagesTracker;
      } catch (ex) {
        this.#cleanupRenderTask(renderTaskId);
        throw ex;
      }
    });
    handler.on("ExecuteOperatorList", async data => {
      const {
        renderTaskId,
        operatorListIdx,
        operatorListLength,
        operationsFilterMask,
        lastChunk
      } = data;
      const renderTaskState = this.#renderTaskStates.get(renderTaskId);
      if (!renderTaskState) {
        return {
          operatorListIdx,
          aborted: true
        };
      }
      if (this.#hasMeshPattern && this.#enableWebGPU && !isGPUReady()) {
        await initGPU();
        if (renderTaskState.aborted) {
          return {
            operatorListIdx,
            aborted: true
          };
        }
      }
      renderTaskState.operatorListIdx = operatorListIdx;
      this.#appendFromSharedOperatorList(renderTaskState, operatorListLength, operationsFilterMask, lastChunk);
      const currentOperatorListIdx = await this.#executeOperatorList(handler, renderTaskState);
      let recordedBBoxesBuffer = null;
      let imageCoordinates = null;
      if (renderTaskState.operatorList.lastChunk && currentOperatorListIdx === renderTaskState.operatorList.argsArray.length) {
        recordedBBoxesBuffer = renderTaskState.dependencyTracker?.take().buffer ?? null;
        imageCoordinates = renderTaskState.imagesTracker?.take() ?? null;
        const aborted = renderTaskState.aborted;
        this.#cleanupRenderTask(renderTaskId, !aborted);
        if (!aborted) {
          try {
            await this.#sendFrame(handler, renderTaskState, true);
          } finally {
            this.#releaseCanvases(renderTaskState);
          }
        }
      } else {
        await this.#maybeSendInterimFrame(handler, renderTaskState);
      }
      return {
        operatorListIdx: currentOperatorListIdx,
        recordedBBoxesBuffer,
        imageCoordinates
      };
    });
  }
  static #initializeFromPort(port) {
    const handler = new MessageHandler("renderer", "main", port);
    this.#setup(handler);
    handler.on("Connect", ({
      sourceName,
      targetName
    }) => {
      this.#disconnect();
      const connection = new MessageHandler(sourceName, targetName, port);
      this.#connection = connection;
      this.#setup(connection);
      connection.on("Disconnect", () => {
        this.#disconnect();
      });
      this.#sendReady(connection);
    });
    this.#sendReady(handler);
  }
  static #disconnect() {
    if (!this.#connection) {
      return;
    }
    for (const renderTaskId of this.#renderTaskStates.keys()) {
      this.#cleanupRenderTask(renderTaskId);
    }
    for (const objs of this.#objsMap.values()) {
      objs.clear();
    }
    this.#objsMap.clear();
    this.#operatorLists.clear();
    this.#hasMeshPattern = false;
    this.#commonObjs.clear();
    this.#fontLoader.clear();
    this.#commonObjs = new PDFObjects();
    this.#fontLoader = new FontLoader({
      ownerDocument: globalThis
    });
    this.#canvasFactory = null;
    this.#filterFactory?.destroy();
    this.#filterFactory = null;
    this.#connection.send("Disconnected", null);
    this.#connection.destroy();
    this.#connection = null;
  }
  static #sendReady(handler) {
    const workerVersion = "6.5.0";
    const testObj = new Uint8Array();
    handler.send("ready", {
      testObj,
      workerVersion
    }, [testObj.buffer]);
  }
}
export { RendererMessageHandler };