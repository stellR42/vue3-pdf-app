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
import "core-js/modules/es.array.includes.js";
import "core-js/modules/web.url.parse.js";
import { assert, ResponseException } from "../shared/util.js";
import { getFilenameFromContentDispositionHeader } from "./content_disposition.js";
import { isPdfFile } from "./dom_utils.js";
function createHeaders(isHttp, httpHeaders) {
  const headers = new Headers();
  if (!isHttp || !httpHeaders || typeof httpHeaders !== "object") {
    return headers;
  }
  for (const key in httpHeaders) {
    const val = httpHeaders[key];
    if (val !== undefined) {
      headers.append(key, val);
    }
  }
  return headers;
}
function trimHeadersEnd(str) {
  let end = str.length;
  while (end > 0 && str[end - 1] !== " " && /\s/.test(str[end - 1])) {
    end--;
  }
  return str.slice(0, end);
}
function getResponseOrigin(url) {
  return URL.parse(url)?.origin ?? null;
}
function validateRangeRequestCapabilities({
  responseHeaders,
  isHttp,
  rangeChunkSize,
  disableRange
}) {
  const rv = {
    contentLength: 0,
    isRangeSupported: false
  };
  const length = parseInt(responseHeaders.get("Content-Length"), 10);
  if (!Number.isInteger(length)) {
    return rv;
  }
  rv.contentLength = length;
  if (length <= 2 * rangeChunkSize) {
    return rv;
  }
  if (disableRange || !isHttp || responseHeaders.get("Accept-Ranges") !== "bytes") {
    return rv;
  }
  const contentEncoding = responseHeaders.get("Content-Encoding") || "identity";
  if (contentEncoding === "identity") {
    rv.isRangeSupported = true;
  }
  return rv;
}
function extractFilenameFromHeader(responseHeaders) {
  const contentDisposition = responseHeaders.get("Content-Disposition");
  if (contentDisposition) {
    let filename = getFilenameFromContentDispositionHeader(contentDisposition);
    if (filename.includes("%")) {
      try {
        filename = decodeURIComponent(filename);
      } catch {}
    }
    if (isPdfFile(filename)) {
      return filename;
    }
  }
  return null;
}
function createResponseError(status, url) {
  return new ResponseException(`Unexpected server response (${status}) while retrieving PDF "${url.href}".`, status, status === 404 || status === 0 && url.protocol === "file:");
}
function ensureResponseOrigin(rangeOrigin, origin) {
  if (rangeOrigin !== origin) {
    throw new Error(`Expected range response-origin "${rangeOrigin}" to match "${origin}".`);
  }
}
export { createHeaders, createResponseError, ensureResponseOrigin, extractFilenameFromHeader, getResponseOrigin, trimHeadersEnd, validateRangeRequestCapabilities };