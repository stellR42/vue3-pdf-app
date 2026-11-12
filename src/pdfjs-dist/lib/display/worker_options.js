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
import "core-js/modules/es.iterator.every.js";
class GlobalWorkerOptions {
  static #port = null;
  static #rendererPorts = [];
  static #rendererSrc = "";
  static #src = "";
  static get rendererPorts() {
    return this.#rendererPorts;
  }
  static set rendererPorts(val) {
    if (!Array.isArray(val) || !val.every(port => typeof Worker !== "undefined" && port instanceof Worker)) {
      throw new Error("Invalid `rendererPorts` type.");
    }
    this.#rendererPorts = val;
  }
  static get rendererSrc() {
    return this.#rendererSrc;
  }
  static set rendererSrc(val) {
    if (typeof val !== "string") {
      throw new Error("Invalid `rendererSrc` type.");
    }
    this.#rendererSrc = val;
  }
  static get workerPort() {
    return this.#port;
  }
  static set workerPort(val) {
    if (!(typeof Worker !== "undefined" && val instanceof Worker) && val !== null) {
      throw new Error("Invalid `workerPort` type.");
    }
    this.#port = val;
  }
  static get workerSrc() {
    return this.#src;
  }
  static set workerSrc(val) {
    if (typeof val !== "string") {
      throw new Error("Invalid `workerSrc` type.");
    }
    this.#src = val;
  }
}
export { GlobalWorkerOptions };