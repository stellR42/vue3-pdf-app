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
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import { BaseTreeViewer } from "./base_tree_viewer.js";
import { internalOpt } from "./internal_evt.js";
import { waitOnEventOrTimeout } from "./event_utils.js";
class PDFAttachmentViewer extends BaseTreeViewer {
  constructor(options) {
    super(options);
    this.downloadManager = options.downloadManager;
    this.linkService = options.linkService;
    this.eventBus.on("fileattachmentannotation", this.#appendAttachment.bind(this), internalOpt);
  }
  reset(keepRenderedCapability = false) {
    super.reset();
    this._attachments = null;
    if (!keepRenderedCapability) {
      this._renderedCapability = Promise.withResolvers();
    }
    this._pendingDispatchEvent = false;
  }
  async _dispatchEvent(attachmentsCount) {
    this._renderedCapability.resolve();
    if (attachmentsCount === 0 && !this._pendingDispatchEvent) {
      this._pendingDispatchEvent = true;
      await waitOnEventOrTimeout({
        target: this.eventBus,
        name: "annotationlayerrendered",
        delay: 1000
      });
      if (!this._pendingDispatchEvent) {
        return;
      }
    }
    this._pendingDispatchEvent = false;
    this.eventBus.dispatch("attachmentsloaded", {
      source: this,
      attachmentsCount
    });
  }
  _bindLink(element, {
    attachmentId,
    content: fallbackContent,
    description,
    filename
  }) {
    if (description) {
      element.title = description;
    }
    const openAttachment = async () => {
      const content = attachmentId ? await this.linkService.getAttachmentContent(attachmentId) : fallbackContent;
      if (content) {
        this.downloadManager?.openOrDownloadData(content, filename);
      }
    };
    element.onclick = () => {
      openAttachment();
      return false;
    };
  }
  render({
    attachments,
    keepRenderedCapability = false
  }) {
    if (this._attachments) {
      this.reset(keepRenderedCapability);
    }
    this._attachments = attachments || null;
    if (!attachments) {
      this._dispatchEvent(0);
      return;
    }
    const fragment = document.createDocumentFragment();
    const ul = document.createElement("ul");
    fragment.append(ul);
    let attachmentsCount = 0;
    for (const [name, item] of attachments) {
      const li = document.createElement("li");
      ul.append(li);
      const element = document.createElement("a");
      li.append(element);
      this._bindLink(element, {
        ...item,
        attachmentId: item.attachmentId ?? name
      });
      element.textContent = this._normalizeTextContent(item.filename);
      attachmentsCount++;
    }
    this._finishRendering(fragment, attachmentsCount);
  }
  #appendAttachment(item) {
    const renderedPromise = this._renderedCapability.promise;
    renderedPromise.then(() => {
      if (renderedPromise !== this._renderedCapability.promise) {
        return;
      }
      const attachments = new Map(this._attachments);
      if (attachments.has(item.filename)) {
        return;
      }
      attachments.set(item.filename, item);
      this.render({
        attachments,
        keepRenderedCapability: true
      });
    });
  }
}
export { PDFAttachmentViewer };