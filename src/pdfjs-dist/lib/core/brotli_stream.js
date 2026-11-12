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
import { BrotliDecode } from "../../external/brotli/decode.js";
import { DecodeStream } from "./decode_stream.js";
import { Stream } from "./stream.js";
class BrotliStream extends DecodeStream {
  #isAsync = true;
  constructor(stream, maybeLength) {
    super(maybeLength);
    this.stream = stream;
    this.dict = stream.dict;
  }
  readBlock() {
    const bytes = this.stream.getBytes();
    const decodedData = BrotliDecode(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length));
    this.buffer = new Uint8Array(decodedData.buffer, decodedData.byteOffset, decodedData.length);
    this.bufferLength = this.buffer.length;
    this.eof = true;
  }
  async getImageData(length, _decoderOptions) {
    const data = await this.asyncGetBytes();
    if (!data) {
      return this.getBytes(length);
    }
    return data.length <= length ? data : data.subarray(0, length);
  }
  async asyncGetBytes() {
    const {
      decompressed,
      compressed
    } = await this.asyncGetBytesFromDecompressionStream("brotli");
    if (decompressed) {
      return decompressed;
    }
    this.#isAsync = false;
    this.stream = new Stream(compressed, 0, compressed.length, this.stream.dict);
    this.reset();
    return null;
  }
  get isAsync() {
    return this.#isAsync;
  }
}
export { BrotliStream };