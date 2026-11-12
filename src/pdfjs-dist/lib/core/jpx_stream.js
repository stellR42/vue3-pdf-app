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
import { DecodeStream } from "./decode_stream.js";
import { JpxImage } from "./jpx.js";
import { shadow } from "../shared/util.js";
class JpxStream extends DecodeStream {
  constructor(stream, maybeLength) {
    super(maybeLength);
    this.stream = stream;
    this.dict = stream.dict;
    this.maybeLength = maybeLength;
  }
  get bytes() {
    return shadow(this, "bytes", this.stream.getBytes(this.maybeLength));
  }
  ensureBuffer(requested) {}
  get isAsyncDecoder() {
    return true;
  }
  async decodeImage(bytes, _length, decoderOptions) {
    if (this.eof) {
      return this.buffer;
    }
    bytes ||= this.bytes;
    this.buffer = await JpxImage.instance.decode(bytes, decoderOptions);
    this.bufferLength = this.buffer.length;
    this.eof = true;
    return this.buffer;
  }
  get canAsyncDecodeImageFromBuffer() {
    return this.stream.isAsync;
  }
  get isImageStream() {
    return true;
  }
}
export { JpxStream };