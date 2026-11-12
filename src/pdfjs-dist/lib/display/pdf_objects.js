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
const INITIAL_DATA = Symbol("INITIAL_DATA");
const dataObj = () => ({
  ...Promise.withResolvers(),
  data: INITIAL_DATA
});
class PDFObjects {
  #objs = new Map();
  get(objId, callback = null, errorCallback = null) {
    if (callback) {
      const obj = this.#objs.getOrInsertComputed(objId, dataObj);
      obj.promise.then(() => callback(obj.data), errorCallback);
      return null;
    }
    const obj = this.#objs.get(objId);
    if (!obj || obj.data === INITIAL_DATA) {
      throw new Error(`Requesting object that isn't resolved yet ${objId}.`);
    }
    return obj.data;
  }
  has(objId) {
    const obj = this.#objs.get(objId);
    return !!obj && obj.data !== INITIAL_DATA;
  }
  delete(objId) {
    const obj = this.#objs.get(objId);
    if (!obj || obj.data === INITIAL_DATA) {
      return false;
    }
    this.#objs.delete(objId);
    return true;
  }
  resolve(objId, data = null) {
    const obj = this.#objs.getOrInsertComputed(objId, dataObj);
    if (obj.data !== INITIAL_DATA) {
      throw new Error(`Object already resolved ${objId}.`);
    }
    obj.data = data;
    obj.resolve();
  }
  reject(objId, reason) {
    const obj = this.#objs.getOrInsertComputed(objId, dataObj);
    if (obj.data !== INITIAL_DATA) {
      return;
    }
    obj.promise.catch(() => {});
    obj.reject(reason);
  }
  clear() {
    for (const {
      data
    } of this.#objs.values()) {
      data?.bitmap?.close();
    }
    this.#objs.clear();
  }
  *[Symbol.iterator]() {
    for (const [objId, {
      data
    }] of this.#objs) {
      if (data !== INITIAL_DATA) {
        yield [objId, data];
      }
    }
  }
}
export { PDFObjects };