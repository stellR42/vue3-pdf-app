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
import "core-js/modules/es.iterator.find.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import { INTERNAL_EVT, internalOpt } from "./internal_evt.js";
import { makeSet } from "../pdf.js";
const WaitOnType = {
  EVENT: "event",
  TIMEOUT: "timeout"
};
async function waitOnEventOrTimeout({
  target,
  name,
  delay = 0
}) {
  if (typeof target !== "object" || !(name && typeof name === "string") || !(Number.isInteger(delay) && delay >= 0)) {
    throw new Error("waitOnEventOrTimeout - invalid parameters.");
  }
  const {
    promise,
    resolve
  } = Promise.withResolvers();
  const ac = new AbortController();
  function handler(type) {
    ac.abort();
    clearTimeout(timeout);
    resolve(type);
  }
  const evtMethod = target instanceof EventBus ? "on" : "addEventListener";
  const evtOpts = target instanceof EventBus ? {
    signal: ac.signal,
    ...internalOpt
  } : {
    signal: ac.signal
  };
  target[evtMethod](name, handler.bind(null, WaitOnType.EVENT), evtOpts);
  const timeout = setTimeout(handler.bind(null, WaitOnType.TIMEOUT), delay);
  return promise;
}
class EventBus {
  #listeners = new Map();
  constructor() {
    Object.seal(this);
  }
  on(eventName, listener, options = null) {
    let rmAbort = null;
    if (options?.signal instanceof AbortSignal) {
      const {
        signal
      } = options;
      if (signal.aborted) {
        console.error("Cannot use an `aborted` signal.");
        return;
      }
      const onAbort = () => this.off(eventName, listener);
      rmAbort = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort);
    }
    this.#listeners.getOrInsertComputed(eventName, makeSet).add({
      listener,
      internal: options?.internal === INTERNAL_EVT,
      once: options?.once === true,
      rmAbort
    });
  }
  off(eventName, listener, options = null) {
    const eventListeners = this.#listeners.get(eventName);
    const evt = eventListeners?.keys().find(e => e.listener === listener);
    if (evt) {
      evt.rmAbort?.();
      eventListeners.delete(evt);
    }
  }
  dispatch(eventName, data) {
    const eventListeners = this.#listeners.get(eventName);
    if (!eventListeners?.size) {
      return;
    }
    let extListeners;
    for (const {
      listener,
      internal,
      once
    } of new Set(eventListeners)) {
      if (once) {
        this.off(eventName, listener);
      }
      if (!internal) {
        (extListeners ??= []).push(listener);
        continue;
      }
      listener(data);
    }
    if (extListeners) {
      for (const listener of extListeners) {
        listener(data);
      }
    }
  }
}
class FirefoxEventBus extends EventBus {
  #externalServices;
  #globalEventNames;
  #isInAutomation;
  constructor(globalEventNames, externalServices, isInAutomation) {
    super();
    this.#globalEventNames = globalEventNames;
    this.#externalServices = externalServices;
    this.#isInAutomation = isInAutomation;
  }
  dispatch(eventName, data) {
    throw new Error("Not implemented: FirefoxEventBus.dispatch");
  }
}
export { EventBus, FirefoxEventBus, waitOnEventOrTimeout, WaitOnType };