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
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import { assert, unreachable } from "./util.js";
class BasePDFStream {
  #PDFStreamReader = null;
  #PDFStreamRangeReader = null;
  _fullReader = null;
  _rangeReaders = new Set();
  _source = null;
  constructor(source, PDFStreamReader, PDFStreamRangeReader) {
    this._source = source;
    this.#PDFStreamReader = PDFStreamReader;
    this.#PDFStreamRangeReader = PDFStreamRangeReader;
  }
  get _progressiveDataLength() {
    return this._fullReader?._loaded ?? 0;
  }
  getFullReader() {
    assert(!this._fullReader, "BasePDFStream.getFullReader can only be called once.");
    return this._fullReader = new this.#PDFStreamReader(this);
  }
  getRangeReader(begin, end) {
    if (end <= this._progressiveDataLength) {
      return null;
    }
    const reader = new this.#PDFStreamRangeReader(this, begin, end);
    this._rangeReaders.add(reader);
    return reader;
  }
  cancelAllRequests(reason) {
    this._fullReader?.cancel(reason);
    for (const reader of new Set(this._rangeReaders)) {
      reader.cancel(reason);
    }
  }
}
class BasePDFStreamReader {
  onProgress = null;
  _contentLength = 0;
  _filename = null;
  _headersCapability = Promise.withResolvers();
  _isRangeSupported = false;
  _isStreamingSupported = false;
  _loaded = 0;
  _stream = null;
  constructor(stream) {
    this._stream = stream;
  }
  _callOnProgress() {
    this.onProgress?.({
      loaded: this._loaded,
      total: this._contentLength
    });
  }
  get headersReady() {
    return this._headersCapability.promise;
  }
  get filename() {
    return this._filename;
  }
  get contentLength() {
    return this._contentLength;
  }
  get isRangeSupported() {
    return this._isRangeSupported;
  }
  get isStreamingSupported() {
    return this._isStreamingSupported;
  }
  async read() {
    unreachable("Abstract method `read` called");
  }
  cancel(reason) {
    unreachable("Abstract method `cancel` called");
  }
}
class BasePDFStreamRangeReader {
  _stream = null;
  constructor(stream, begin, end) {
    this._stream = stream;
  }
  async read() {
    unreachable("Abstract method `read` called");
  }
  cancel(reason) {
    unreachable("Abstract method `cancel` called");
  }
}
export { BasePDFStream, BasePDFStreamRangeReader, BasePDFStreamReader };