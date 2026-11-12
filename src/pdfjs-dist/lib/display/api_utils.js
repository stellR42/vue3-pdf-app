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
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import "core-js/modules/es.typed-array.with.js";
import "core-js/modules/es.uint8-array.set-from-base64.js";
import "core-js/modules/es.uint8-array.set-from-hex.js";
import "core-js/modules/es.uint8-array.to-base64.js";
import "core-js/modules/es.uint8-array.to-hex.js";
import "core-js/modules/web.dom-exception.stack.js";
import "core-js/modules/web.url.parse.js";
import { _isValidExplicitDest, isNodeJS, stringToBytes, warn } from "../shared/util.js";
function deprecated(details) {
  console.log("Deprecated API usage: " + details);
}
function getUrlProp(val) {
  if (val instanceof URL) {
    return val;
  }
  if (typeof val === "string") {
    if (isNodeJS) {
      if (/^[a-z][a-z0-9\-+.]+:/i.test(val)) {
        return new URL(val);
      }
      const url = process.getBuiltinModule("url");
      return new URL(url.pathToFileURL(val));
    }
    const url = URL.parse(val, window.location);
    if (url) {
      return url;
    }
  }
  throw new Error("Invalid PDF url data: " + "either string or URL-object is expected in the url property.");
}
function getDataProp(val) {
  if (isNodeJS && typeof Buffer !== "undefined" && val instanceof Buffer) {
    throw new Error("Please provide binary data as `Uint8Array`, rather than `Buffer`.");
  }
  if (val instanceof Uint8Array && val.byteLength === val.buffer.byteLength) {
    return val;
  }
  if (typeof val === "string") {
    return stringToBytes(val);
  }
  if (val instanceof ArrayBuffer || ArrayBuffer.isView(val) || typeof val === "object" && !isNaN(val?.length)) {
    return new Uint8Array(val);
  }
  throw new Error("Invalid PDF binary data: either TypedArray, " + "string, or array-like object is expected in the data property.");
}
function getFactoryUrlProp(val) {
  if (typeof val !== "string") {
    return null;
  }
  if (val.endsWith("/")) {
    return val;
  }
  throw new Error(`Invalid factory url: "${val}" must include trailing slash.`);
}
const isRefProxy = v => typeof v === "object" && Number.isInteger(v?.num) && v.num >= 0 && Number.isInteger(v?.gen) && v.gen >= 0;
const isNameProxy = v => typeof v === "object" && typeof v?.name === "string";
const isValidExplicitDest = _isValidExplicitDest.bind(null, isRefProxy, isNameProxy);
function isSameOrigin(baseUrl, otherUrl) {
  const base = URL.parse(baseUrl);
  if (!base?.origin || base.origin === "null") {
    return false;
  }
  const other = new URL(otherUrl, base);
  return base.origin === other.origin;
}
function getWorkerSrc(src) {
  if (!isSameOrigin(window.location, src)) {
    const wrapper = `await import("${new URL(src, window.location).href}");`;
    return URL.createObjectURL(new Blob([wrapper], {
      type: "text/javascript"
    }));
  }
  return src;
}
class LoopbackPort {
  #listeners = new Map();
  #deferred = Promise.resolve();
  postMessage(obj, transfer) {
    const event = {
      data: structuredClone(obj, transfer ? {
        transfer
      } : null)
    };
    this.#deferred.then(() => {
      for (const [listener] of this.#listeners) {
        listener.call(this, event);
      }
    });
  }
  addEventListener(name, listener, options = null) {
    let rmAbort = null;
    if (options?.signal instanceof AbortSignal) {
      const {
        signal
      } = options;
      if (signal.aborted) {
        warn("LoopbackPort - cannot use an `aborted` signal.");
        return;
      }
      const onAbort = () => this.removeEventListener(name, listener);
      rmAbort = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort);
    }
    this.#listeners.set(listener, rmAbort);
  }
  removeEventListener(name, listener) {
    const rmAbort = this.#listeners.get(listener);
    rmAbort?.();
    this.#listeners.delete(listener);
  }
  terminate() {
    for (const [, rmAbort] of this.#listeners) {
      rmAbort?.();
    }
    this.#listeners.clear();
  }
}
class StatTimer {
  #started = new Map();
  times = [];
  time(name) {
    if (this.#started.has(name)) {
      warn(`Timer is already running for ${name}`);
    }
    this.#started.set(name, Date.now());
  }
  timeEnd(name) {
    if (!this.#started.has(name)) {
      warn(`Timer has not been started for ${name}`);
    }
    this.times.push({
      name,
      start: this.#started.get(name),
      end: Date.now()
    });
    this.#started.delete(name);
  }
  toString() {
    const longest = Math.max(...this.times.map(t => t.name.length));
    return this.times.map(t => `${t.name.padEnd(longest)} ${t.end - t.start}ms\n`).join("");
  }
}
export { deprecated, getDataProp, getFactoryUrlProp, getUrlProp, getWorkerSrc, isNameProxy, isRefProxy, isSameOrigin, isValidExplicitDest, LoopbackPort, StatTimer };