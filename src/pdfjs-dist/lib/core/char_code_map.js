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
import "core-js/modules/es.iterator.for-each.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
const REVERSE_MAP_FACTOR = 32;
class CharCodeMap {
  #codes = [];
  #dense = [];
  #reverse = null;
  #sparse = null;
  #visited = 0;
  get size() {
    return this.#codes.length;
  }
  get(code) {
    return (code & 0xffff) === code ? this.#dense[code] : this.#sparse?.get(code);
  }
  has(code) {
    return this.get(code) !== undefined;
  }
  set(code, value) {
    this.#reverse = null;
    if ((code & 0xffff) === code) {
      if (this.#dense[code] === undefined) {
        this.#codes.push(code);
      }
      this.#dense[code] = value;
      return;
    }
    this.#sparse ??= new Map();
    if (!this.#sparse.has(code)) {
      this.#codes.push(code);
    }
    this.#sparse.set(code, value);
  }
  forEach(callback) {
    const codes = this.#codes,
      dense = this.#dense,
      sparse = this.#sparse;
    for (let i = 0, ii = codes.length; i < ii; i++) {
      const code = codes[i];
      callback(code, (code & 0xffff) === code ? dense[code] : sparse.get(code));
    }
  }
  charCodeOf(value) {
    if (!this.#reverse && this.#visited > REVERSE_MAP_FACTOR * this.size) {
      const reverse = this.#reverse = new Map();
      this.forEach((code, entry) => {
        if (!reverse.has(entry)) {
          reverse.set(entry, code);
        }
      });
    }
    if (this.#reverse) {
      return this.#reverse.get(value) ?? -1;
    }
    const codes = this.#codes;
    for (let i = 0, ii = codes.length; i < ii; i++) {
      if (this.get(codes[i]) === value) {
        this.#visited += i + 1;
        return codes[i];
      }
    }
    this.#visited += codes.length;
    return -1;
  }
  clone() {
    const map = new CharCodeMap();
    map.#codes = this.#codes.slice();
    map.#dense = this.#dense.slice();
    map.#sparse = this.#sparse && new Map(this.#sparse);
    return map;
  }
}
export { CharCodeMap };