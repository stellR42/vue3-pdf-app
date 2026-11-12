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
import "core-js/modules/es.iterator.filter.js";
import "core-js/modules/es.typed-array.with.js";
import "core-js/modules/es.uint8-array.set-from-base64.js";
import "core-js/modules/es.uint8-array.set-from-hex.js";
import "core-js/modules/es.uint8-array.to-base64.js";
import "core-js/modules/es.uint8-array.to-hex.js";
import { BaseStream } from "./base_stream.js";
import { Stream } from "./stream.js";
import { unreachable } from "../shared/util.js";
const emptyBuffer = new Uint8Array(0);
class DecodeStream extends BaseStream {
  buffer = emptyBuffer;
  bufferLength = 0;
  eof = false;
  minBufferLength = 512;
  pos = 0;
  constructor(maybeMinBufferLength) {
    super();
    this._rawMinBufferLength = maybeMinBufferLength || 0;
    if (maybeMinBufferLength) {
      while (this.minBufferLength < maybeMinBufferLength) {
        this.minBufferLength *= 2;
      }
    }
  }
  readBlock() {
    unreachable("Abstract method `readBlock` called");
  }
  get isEmpty() {
    while (!this.eof && this.bufferLength === 0) {
      this.readBlock();
    }
    return this.bufferLength === 0;
  }
  ensureBuffer(requested) {
    const buffer = this.buffer;
    if (requested <= buffer.byteLength) {
      return buffer;
    }
    let size = this.minBufferLength;
    while (size < requested) {
      size *= 2;
    }
    const buffer2 = new Uint8Array(size);
    buffer2.set(buffer);
    return this.buffer = buffer2;
  }
  getByte() {
    const pos = this.pos;
    while (this.bufferLength <= pos) {
      if (this.eof) {
        return -1;
      }
      this.readBlock();
    }
    return this.buffer[this.pos++];
  }
  getBytes(length, decoderOptions = null) {
    const pos = this.pos;
    let end;
    if (length) {
      this.ensureBuffer(pos + length);
      end = pos + length;
      while (!this.eof && this.bufferLength < end) {
        this.readBlock(decoderOptions);
      }
      const bufEnd = this.bufferLength;
      if (end > bufEnd) {
        end = bufEnd;
      }
    } else {
      while (!this.eof) {
        this.readBlock(decoderOptions);
      }
      end = this.bufferLength;
    }
    this.pos = end;
    return this.buffer.subarray(pos, end);
  }
  async getImageData(length, decoderOptions) {
    if (!this.canAsyncDecodeImageFromBuffer) {
      return this.isAsyncDecoder ? this.decodeImage(null, length, decoderOptions) : this.getBytes(length, decoderOptions);
    }
    const data = await this.stream.asyncGetBytes();
    return this.decodeImage(data, length, decoderOptions);
  }
  async asyncGetBytesFromDecompressionStream(name) {
    this.stream.reset();
    const bytes = this.stream.isAsync && (await this.stream.asyncGetBytes()) || this.stream.getBytes();
    try {
      const {
        readable,
        writable
      } = new DecompressionStream(name);
      const writer = writable.getWriter();
      writer.write(bytes).catch(() => {});
      writer.close().catch(() => {});
      const chunks = [];
      let totalLength = 0;
      const reader = readable.getReader();
      while (true) {
        const {
          value: chunk,
          done
        } = await reader.read();
        if (done) {
          break;
        }
        chunks.push(chunk);
        totalLength += chunk.byteLength;
      }
      if (chunks.length === 1) {
        return {
          decompressed: chunks[0],
          compressed: bytes
        };
      }
      const data = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return {
        decompressed: data,
        compressed: bytes
      };
    } catch {
      return {
        decompressed: null,
        compressed: bytes
      };
    }
  }
  reset() {
    this.pos = 0;
  }
  makeSubStream(start, length, dict = null) {
    if (length === undefined) {
      while (!this.eof) {
        this.readBlock();
      }
    } else {
      const end = start + length;
      while (this.bufferLength <= end && !this.eof) {
        this.readBlock();
      }
    }
    return new Stream(this.buffer, start, length, dict);
  }
  clone() {
    while (!this.eof) {
      this.readBlock();
    }
    return new Stream(this.buffer, 0, this.bufferLength, this.dict?.clone());
  }
  getBaseStreams() {
    return this.stream ? this.stream.getBaseStreams() : null;
  }
}
class StreamsSequenceStream extends DecodeStream {
  constructor(streams, onError = null) {
    streams = streams.filter(s => s instanceof BaseStream && !s.isImageStream);
    let maybeLength = 0;
    for (const stream of streams) {
      maybeLength += stream instanceof DecodeStream ? stream._rawMinBufferLength : stream.length;
    }
    super(maybeLength);
    this.streams = streams;
    this._onError = onError;
  }
  readBlock() {
    const streams = this.streams;
    if (streams.length === 0) {
      this.eof = true;
      return;
    }
    const stream = streams.shift();
    let chunk;
    try {
      chunk = stream.getBytes();
    } catch (reason) {
      if (this._onError) {
        this._onError(reason, stream.dict?.objId);
        return;
      }
      throw reason;
    }
    const bufferLength = this.bufferLength;
    const newLength = bufferLength + chunk.length + 1;
    const buffer = this.ensureBuffer(newLength);
    buffer.set(chunk, bufferLength);
    buffer[newLength - 1] = 0x0a;
    this.bufferLength = newLength;
  }
  getBaseStreams() {
    const baseStreamsBuf = [];
    for (const stream of this.streams) {
      const baseStreams = stream.getBaseStreams();
      if (baseStreams) {
        baseStreamsBuf.push(...baseStreams);
      }
    }
    return baseStreamsBuf.length > 0 ? baseStreamsBuf : null;
  }
}
export { DecodeStream, StreamsSequenceStream };