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
const ALPHA_MASK = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 0xff000000 : 0x000000ff;
const RGB_MASK = ~ALPHA_MASK;
class QCMS {
  static #memoryArray = null;
  static _memory = null;
  static _destBuffer = null;
  static _destOffset = 0;
  static _keepAlpha = false;
  static get _memoryArray() {
    const array = this.#memoryArray;
    if (array?.byteLength) {
      return array;
    }
    return this.#memoryArray = new Uint8Array(this._memory.buffer);
  }
}
function copy_result(ptr, len) {
  const {
    _destBuffer,
    _destOffset,
    _keepAlpha,
    _memoryArray
  } = QCMS;
  if (!_keepAlpha) {
    _destBuffer.set(_memoryArray.subarray(ptr, ptr + len), _destOffset);
    return;
  }
  const count = len >> 2;
  const destStart = _destBuffer.byteOffset + _destOffset;
  if (((destStart | ptr) & 3) === 0) {
    const dest32 = new Uint32Array(_destBuffer.buffer, destStart, count);
    const src32 = new Uint32Array(QCMS._memory.buffer, ptr, count);
    for (let i = 0; i < count; i++) {
      dest32[i] = dest32[i] & ALPHA_MASK | src32[i] & RGB_MASK;
    }
    return;
  }
  for (let i = ptr, ii = ptr + len, j = _destOffset; i < ii; i += 4, j += 4) {
    _destBuffer[j] = _memoryArray[i];
    _destBuffer[j + 1] = _memoryArray[i + 1];
    _destBuffer[j + 2] = _memoryArray[i + 2];
  }
}
export { copy_result, QCMS };