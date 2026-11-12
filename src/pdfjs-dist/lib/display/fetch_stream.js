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
import { AbortException, assert } from "../shared/util.js";
import { BasePDFStream, BasePDFStreamRangeReader, BasePDFStreamReader } from "../shared/base_pdf_stream.js";
import { createHeaders, createResponseError, ensureResponseOrigin, extractFilenameFromHeader, getResponseOrigin, validateRangeRequestCapabilities } from "./network_utils.js";
function fetchUrl(url, headers, withCredentials, abortController) {
  return fetch(url, {
    method: "GET",
    headers,
    signal: abortController.signal,
    mode: "cors",
    credentials: withCredentials ? "include" : "same-origin",
    redirect: "follow"
  });
}
function ensureResponseStatus(status, url) {
  if (status !== 200 && status !== 206) {
    throw createResponseError(status, url);
  }
}
function getArrayBuffer(val) {
  if (val instanceof Uint8Array) {
    return val.buffer;
  }
  if (val instanceof ArrayBuffer) {
    return val;
  }
  throw new Error(`getArrayBuffer - unexpected data: ${val}`);
}
class PDFFetchStream extends BasePDFStream {
  _responseOrigin = null;
  constructor(source) {
    super(source, PDFFetchStreamReader, PDFFetchStreamRangeReader);
    const {
      httpHeaders,
      url
    } = source;
    assert(/https?:/.test(url.protocol), "PDFFetchStream only supports http(s):// URLs.");
    this.headers = createHeaders(true, httpHeaders);
  }
}
class PDFFetchStreamReader extends BasePDFStreamReader {
  _abortController = new AbortController();
  _reader = null;
  constructor(stream) {
    super(stream);
    const {
      disableRange,
      disableStream,
      rangeChunkSize,
      url,
      withCredentials
    } = stream._source;
    this._isStreamingSupported = !disableStream;
    const headers = new Headers(stream.headers);
    fetchUrl(url, headers, withCredentials, this._abortController).then(response => {
      stream._responseOrigin = getResponseOrigin(response.url);
      ensureResponseStatus(response.status, url);
      this._reader = response.body.getReader();
      const responseHeaders = response.headers;
      const {
        contentLength,
        isRangeSupported
      } = validateRangeRequestCapabilities({
        responseHeaders,
        isHttp: true,
        rangeChunkSize,
        disableRange
      });
      this._contentLength = contentLength;
      this._isRangeSupported = isRangeSupported;
      this._filename = extractFilenameFromHeader(responseHeaders);
      if (!this._isStreamingSupported && this._isRangeSupported) {
        this.cancel(new AbortException("Streaming is disabled."));
      }
      this._headersCapability.resolve();
    }).catch(this._headersCapability.reject);
  }
  async read() {
    await this._headersCapability.promise;
    const {
      value,
      done
    } = await this._reader.read();
    if (done) {
      return {
        value,
        done
      };
    }
    this._loaded += value.byteLength;
    this._callOnProgress();
    return {
      value: getArrayBuffer(value),
      done: false
    };
  }
  cancel(reason) {
    this._reader?.cancel(reason).catch(() => {});
    this._abortController.abort();
  }
}
class PDFFetchStreamRangeReader extends BasePDFStreamRangeReader {
  _abortController = new AbortController();
  _readCapability = Promise.withResolvers();
  _reader = null;
  constructor(stream, begin, end) {
    super(stream, begin, end);
    const {
      url,
      withCredentials
    } = stream._source;
    const headers = new Headers(stream.headers);
    headers.append("Range", `bytes=${begin}-${end - 1}`);
    fetchUrl(url, headers, withCredentials, this._abortController).then(response => {
      const responseOrigin = getResponseOrigin(response.url);
      ensureResponseOrigin(responseOrigin, stream._responseOrigin);
      ensureResponseStatus(response.status, url);
      this._reader = response.body.getReader();
      this._readCapability.resolve();
    }).catch(this._readCapability.reject);
    this._readCapability.promise.catch(() => {});
  }
  async read() {
    await this._readCapability.promise;
    const {
      value,
      done
    } = await this._reader.read();
    return done ? {
      value,
      done
    } : {
      value: getArrayBuffer(value),
      done: false
    };
  }
  cancel(reason) {
    this._reader?.cancel(reason).catch(() => {});
    this._abortController.abort();
  }
}
export { getArrayBuffer, PDFFetchStream };