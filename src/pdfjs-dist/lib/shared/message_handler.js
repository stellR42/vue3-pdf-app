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
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import "core-js/modules/es.promise.try.js";
import { AbortException, assert, InvalidPDFException, PasswordException, ResponseException, UnknownErrorException } from "./util.js";
const CallbackKind = {
  DATA: 1,
  ERROR: 2
};
const StreamKind = {
  CANCEL: 1,
  CANCEL_COMPLETE: 2,
  CLOSE: 3,
  ENQUEUE: 4,
  ERROR: 5,
  PULL: 6,
  PULL_COMPLETE: 7,
  START_COMPLETE: 8
};
function onFn() {}
function wrapReason(ex) {
  if (ex instanceof AbortException || ex instanceof InvalidPDFException || ex instanceof PasswordException || ex instanceof ResponseException || ex instanceof UnknownErrorException) {
    return ex;
  }
  if (typeof ex !== "object" || ex === null) {
    return new UnknownErrorException(String(ex), String(ex));
  }
  switch (ex.name) {
    case "AbortException":
      return new AbortException(ex.message);
    case "InvalidPDFException":
      return new InvalidPDFException(ex.message);
    case "PasswordException":
      return new PasswordException(ex.message, ex.code);
    case "ResponseException":
      return new ResponseException(ex.message, ex.status, ex.missing);
    case "UnknownErrorException":
      return new UnknownErrorException(ex.message, ex.details);
  }
  return new UnknownErrorException(ex.message, ex.toString());
}
class MessageHandler {
  #actions = new Map();
  #callbackCapabilities = new Map();
  #callbackId = 1;
  #comObj;
  #messageAC = new AbortController();
  #sourceName;
  #streamControllers = new Map();
  #streamId = 1;
  #streamSinks = new Map();
  #targetName;
  constructor(sourceName, targetName, comObj) {
    this.#sourceName = sourceName;
    this.#targetName = targetName;
    this.#comObj = comObj;
    comObj.addEventListener("message", this.#onMessage.bind(this), {
      signal: this.#messageAC.signal
    });
  }
  #onMessage({
    data
  }) {
    if (data.targetName !== this.#sourceName) {
      return;
    }
    if (data.stream) {
      this.#processStreamMessage(data);
      return;
    }
    if (data.callback) {
      const {
        callbackId,
        callback
      } = data;
      const capability = this.#callbackCapabilities.get(callbackId);
      if (!capability) {
        throw new Error(`Cannot resolve callback ${callbackId}`);
      }
      this.#callbackCapabilities.delete(callbackId);
      if (callback === CallbackKind.DATA) {
        capability.resolve(data.data);
      } else if (callback === CallbackKind.ERROR) {
        capability.reject(wrapReason(data.reason));
      } else {
        throw new Error("Unexpected callback case");
      }
      return;
    }
    const action = this.#actions.get(data.action);
    if (!action) {
      throw new Error(`Unknown action from worker: ${data.action}`);
    }
    if (data.callbackId) {
      const sourceName = this.#sourceName,
        targetName = data.sourceName,
        comObj = this.#comObj;
      Promise.try(action, data.data).then(result => {
        comObj.postMessage({
          sourceName,
          targetName,
          callback: CallbackKind.DATA,
          callbackId: data.callbackId,
          data: result
        });
      }).catch(reason => {
        comObj.postMessage({
          sourceName,
          targetName,
          callback: CallbackKind.ERROR,
          callbackId: data.callbackId,
          reason: wrapReason(reason)
        });
      });
      return;
    }
    if (data.streamId) {
      this.#createStreamSink(data);
      return;
    }
    action(data.data);
  }
  on(actionName, handler) {
    const ah = this.#actions;
    if (ah.has(actionName)) {
      throw new Error(`There is already a "${actionName}" handler.`);
    }
    ah.set(actionName, handler);
  }
  send(actionName, data, transfers) {
    this.#comObj.postMessage({
      sourceName: this.#sourceName,
      targetName: this.#targetName,
      action: actionName,
      data
    }, transfers);
  }
  sendWithPromise(actionName, data, transfers) {
    const callbackId = this.#callbackId++,
      capability = Promise.withResolvers();
    this.#callbackCapabilities.set(callbackId, capability);
    try {
      this.#comObj.postMessage({
        sourceName: this.#sourceName,
        targetName: this.#targetName,
        action: actionName,
        callbackId,
        data
      }, transfers);
    } catch (ex) {
      capability.reject(ex);
    }
    return capability.promise;
  }
  sendWithStream(actionName, data, queueingStrategy, transfers) {
    const streamId = this.#streamId++,
      sourceName = this.#sourceName,
      targetName = this.#targetName,
      comObj = this.#comObj;
    return new ReadableStream({
      start: controller => {
        const startCapability = Promise.withResolvers();
        this.#streamControllers.set(streamId, {
          controller,
          startCall: startCapability,
          pullCall: null,
          cancelCall: null,
          isClosed: false
        });
        comObj.postMessage({
          sourceName,
          targetName,
          action: actionName,
          streamId,
          data,
          desiredSize: controller.desiredSize
        }, transfers);
        return startCapability.promise;
      },
      pull: controller => {
        const pullCapability = Promise.withResolvers();
        this.#streamControllers.get(streamId).pullCall = pullCapability;
        comObj.postMessage({
          sourceName,
          targetName,
          stream: StreamKind.PULL,
          streamId,
          desiredSize: controller.desiredSize
        });
        return pullCapability.promise;
      },
      cancel: reason => {
        assert(reason instanceof Error, "cancel must have a valid reason");
        const cancelCapability = Promise.withResolvers();
        this.#streamControllers.get(streamId).cancelCall = cancelCapability;
        this.#streamControllers.get(streamId).isClosed = true;
        comObj.postMessage({
          sourceName,
          targetName,
          stream: StreamKind.CANCEL,
          streamId,
          reason: wrapReason(reason)
        });
        return cancelCapability.promise;
      }
    }, queueingStrategy);
  }
  #createStreamSink(data) {
    const streamId = data.streamId,
      sourceName = this.#sourceName,
      targetName = data.sourceName,
      comObj = this.#comObj;
    const streamSinks = this.#streamSinks,
      action = this.#actions.get(data.action);
    const streamSink = {
      enqueue(chunk, size = 1, transfers) {
        if (this.isCancelled) {
          return;
        }
        const lastDesiredSize = this.desiredSize;
        this.desiredSize -= size;
        if (lastDesiredSize > 0 && this.desiredSize <= 0) {
          this.sinkCapability = Promise.withResolvers();
          this.ready = this.sinkCapability.promise;
        }
        comObj.postMessage({
          sourceName,
          targetName,
          stream: StreamKind.ENQUEUE,
          streamId,
          chunk
        }, transfers);
      },
      close() {
        if (this.isCancelled) {
          return;
        }
        this.isCancelled = true;
        comObj.postMessage({
          sourceName,
          targetName,
          stream: StreamKind.CLOSE,
          streamId
        });
        streamSinks.delete(streamId);
      },
      error(reason) {
        if (this.isCancelled) {
          return;
        }
        this.isCancelled = true;
        comObj.postMessage({
          sourceName,
          targetName,
          stream: StreamKind.ERROR,
          streamId,
          reason: wrapReason(reason)
        });
      },
      sinkCapability: Promise.withResolvers(),
      onPull: null,
      onCancel: null,
      isCancelled: false,
      desiredSize: data.desiredSize,
      ready: null
    };
    streamSink.sinkCapability.resolve();
    streamSink.ready = streamSink.sinkCapability.promise;
    streamSinks.set(streamId, streamSink);
    Promise.try(action, data.data, streamSink).then(() => {
      comObj.postMessage({
        sourceName,
        targetName,
        stream: StreamKind.START_COMPLETE,
        streamId,
        success: true
      });
    }, reason => {
      comObj.postMessage({
        sourceName,
        targetName,
        stream: StreamKind.START_COMPLETE,
        streamId,
        reason: wrapReason(reason)
      });
    });
  }
  #processStreamMessage(data) {
    const streamId = data.streamId,
      sourceName = this.#sourceName,
      targetName = data.sourceName,
      comObj = this.#comObj;
    const streamController = this.#streamControllers.get(streamId),
      streamSink = this.#streamSinks.get(streamId);
    switch (data.stream) {
      case StreamKind.START_COMPLETE:
        if (data.success) {
          streamController.startCall.resolve();
        } else {
          streamController.startCall.reject(wrapReason(data.reason));
        }
        break;
      case StreamKind.PULL_COMPLETE:
        if (data.success) {
          streamController.pullCall.resolve();
        } else {
          streamController.pullCall.reject(wrapReason(data.reason));
        }
        break;
      case StreamKind.PULL:
        if (!streamSink) {
          comObj.postMessage({
            sourceName,
            targetName,
            stream: StreamKind.PULL_COMPLETE,
            streamId,
            success: true
          });
          break;
        }
        if (streamSink.desiredSize <= 0 && data.desiredSize > 0) {
          streamSink.sinkCapability.resolve();
        }
        streamSink.desiredSize = data.desiredSize;
        Promise.try(streamSink.onPull || onFn).then(() => {
          comObj.postMessage({
            sourceName,
            targetName,
            stream: StreamKind.PULL_COMPLETE,
            streamId,
            success: true
          });
        }, reason => {
          comObj.postMessage({
            sourceName,
            targetName,
            stream: StreamKind.PULL_COMPLETE,
            streamId,
            reason: wrapReason(reason)
          });
        });
        break;
      case StreamKind.ENQUEUE:
        assert(streamController, "enqueue should have stream controller");
        if (streamController.isClosed) {
          break;
        }
        streamController.controller.enqueue(data.chunk);
        break;
      case StreamKind.CLOSE:
        assert(streamController, "close should have stream controller");
        if (streamController.isClosed) {
          break;
        }
        streamController.isClosed = true;
        streamController.controller.close();
        this.#deleteStreamController(streamController, streamId);
        break;
      case StreamKind.ERROR:
        assert(streamController, "error should have stream controller");
        streamController.controller.error(wrapReason(data.reason));
        this.#deleteStreamController(streamController, streamId);
        break;
      case StreamKind.CANCEL_COMPLETE:
        if (data.success) {
          streamController.cancelCall.resolve();
        } else {
          streamController.cancelCall.reject(wrapReason(data.reason));
        }
        this.#deleteStreamController(streamController, streamId);
        break;
      case StreamKind.CANCEL:
        if (!streamSink) {
          break;
        }
        const dataReason = wrapReason(data.reason);
        Promise.try(streamSink.onCancel || onFn, dataReason).then(() => {
          comObj.postMessage({
            sourceName,
            targetName,
            stream: StreamKind.CANCEL_COMPLETE,
            streamId,
            success: true
          });
        }, reason => {
          comObj.postMessage({
            sourceName,
            targetName,
            stream: StreamKind.CANCEL_COMPLETE,
            streamId,
            reason: wrapReason(reason)
          });
        });
        streamSink.sinkCapability.reject(dataReason);
        streamSink.isCancelled = true;
        this.#streamSinks.delete(streamId);
        break;
      default:
        throw new Error("Unexpected stream case");
    }
  }
  async #deleteStreamController(streamController, streamId) {
    await Promise.allSettled([streamController.startCall?.promise, streamController.pullCall?.promise, streamController.cancelCall?.promise]);
    this.#streamControllers.delete(streamId);
  }
  destroy() {
    this.#messageAC?.abort();
    this.#messageAC = null;
  }
  get destroyed() {
    return !this.#messageAC;
  }
}
export { MessageHandler, wrapReason };