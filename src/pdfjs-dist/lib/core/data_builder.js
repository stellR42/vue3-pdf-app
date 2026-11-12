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
import "core-js/modules/es.typed-array.with.js";
import "core-js/modules/es.uint8-array.set-from-base64.js";
import "core-js/modules/es.uint8-array.set-from-hex.js";
import "core-js/modules/es.uint8-array.to-base64.js";
import "core-js/modules/es.uint8-array.to-hex.js";
import { assert } from "../shared/util.js";
import { MathClamp } from "../shared/math_clamp.js";
class DataBuilder {
  #buf;
  #bufLength = 1024;
  #hasExactLength = false;
  #pos = 0;
  #view;
  constructor({
    exactLength = 0,
    minLength = 0
  }) {
    this.#hasExactLength = !!exactLength;
    this.#initBuf(exactLength || minLength);
  }
  #initBuf(minLength) {
    if (this.#hasExactLength) {
      this.#bufLength = minLength;
    } else {
      while (this.#bufLength < minLength) {
        this.#bufLength *= 2;
      }
    }
    const newBuf = new Uint8Array(this.#bufLength);
    if (this.#buf) {
      newBuf.set(this.#buf, 0);
    }
    this.#buf = newBuf;
    this.#view = new DataView(newBuf.buffer);
  }
  get data() {
    return this.#buf.subarray(0, this.#pos);
  }
  get length() {
    return this.#pos;
  }
  skip(n) {
    this.#pos += n;
  }
  setArray(arr) {
    const newPos = this.#pos + arr.length;
    if (!this.#hasExactLength && newPos > this.#bufLength) {
      this.#initBuf(newPos);
    }
    this.#buf.set(arr, this.#pos);
    this.#pos = newPos;
  }
  setInt16(val) {
    const newPos = this.#pos + 2;
    if (!this.#hasExactLength && newPos > this.#bufLength) {
      this.#initBuf(newPos);
    }
    this.#view.setInt16(this.#pos, val);
    this.#pos = newPos;
  }
  setSafeInt16(val) {
    const newPos = this.#pos + 2;
    if (!this.#hasExactLength && newPos > this.#bufLength) {
      this.#initBuf(newPos);
    }
    this.#view.setInt16(this.#pos, MathClamp(val, -0x8000, 0x7fff));
    this.#pos = newPos;
  }
  setInt32(val) {
    const newPos = this.#pos + 4;
    if (!this.#hasExactLength && newPos > this.#bufLength) {
      this.#initBuf(newPos);
    }
    this.#view.setInt32(this.#pos, val);
    this.#pos = newPos;
  }
}
export { DataBuilder };