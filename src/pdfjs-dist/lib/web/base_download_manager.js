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
import "core-js/modules/es.weak-map.get-or-insert.js";
import "core-js/modules/es.weak-map.get-or-insert-computed.js";
import { isPdfFile } from "../pdf.js";
class BaseDownloadManager {
  #openBlobUrls = new WeakMap();
  _triggerDownload(blobUrl, originalUrl, filename, isAttachment = false, isModified = false) {
    throw new Error("Not implemented: _triggerDownload");
  }
  _getOpenDataUrl(blobUrl, filename, dest = null) {
    throw new Error("Not implemented: _getOpenDataUrl");
  }
  downloadData(data, filename, contentType) {
    const blobUrl = URL.createObjectURL(new Blob([data], {
      type: contentType
    }));
    this._triggerDownload(blobUrl, blobUrl, filename, true);
  }
  openOrDownloadData(data, filename, dest = null) {
    const isPdfData = isPdfFile(filename);
    const contentType = isPdfData ? "application/pdf" : "";
    if (isPdfData) {
      const blobUrl = this.#openBlobUrls.getOrInsertComputed(data, () => URL.createObjectURL(new Blob([data], {
        type: contentType
      })));
      try {
        const viewerUrl = this._getOpenDataUrl(blobUrl, filename, dest);
        window.open(viewerUrl);
        return true;
      } catch (ex) {
        console.error("openOrDownloadData:", ex);
        URL.revokeObjectURL(blobUrl);
        this.#openBlobUrls.delete(data);
      }
    }
    this.downloadData(data, filename, contentType);
    return false;
  }
  download(data, url, filename, isModified = false) {
    const blobUrl = data ? URL.createObjectURL(new Blob([data], {
      type: "application/pdf"
    })) : null;
    this._triggerDownload(blobUrl, url, filename, false, isModified);
  }
}
export { BaseDownloadManager };