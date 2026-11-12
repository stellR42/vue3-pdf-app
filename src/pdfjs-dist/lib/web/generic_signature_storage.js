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
import "core-js/modules/es.json.parse.js";
import "core-js/modules/es.json.stringify.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import { getUuid } from "../pdf.js";
const KEY_STORAGE = "pdfjs.signature";
class SignatureStorage {
  #eventBus;
  #signatures = null;
  #signal = null;
  constructor(eventBus, signal) {
    this.#eventBus = eventBus;
    this.#signal = signal;
  }
  #save() {
    localStorage.setItem(KEY_STORAGE, JSON.stringify(Object.fromEntries(this.#signatures)));
  }
  async getAll() {
    if (this.#signal) {
      window.addEventListener("storage", ({
        key
      }) => {
        if (key === KEY_STORAGE) {
          this.#signatures = null;
          this.#eventBus?.dispatch("storedsignatureschanged", {
            source: this
          });
        }
      }, {
        signal: this.#signal
      });
      this.#signal = null;
    }
    if (!this.#signatures) {
      this.#signatures = new Map();
      const data = localStorage.getItem(KEY_STORAGE);
      if (data) {
        for (const [key, value] of Object.entries(JSON.parse(data))) {
          this.#signatures.set(key, value);
        }
      }
    }
    return this.#signatures;
  }
  async isFull() {
    return (await this.size()) === 5;
  }
  async size() {
    return (await this.getAll()).size;
  }
  async create(data) {
    if (await this.isFull()) {
      return null;
    }
    const uuid = getUuid();
    this.#signatures.set(uuid, data);
    this.#save();
    return uuid;
  }
  async delete(uuid) {
    const signatures = await this.getAll();
    if (!signatures.has(uuid)) {
      return false;
    }
    signatures.delete(uuid);
    this.#save();
    return true;
  }
}
export { SignatureStorage };