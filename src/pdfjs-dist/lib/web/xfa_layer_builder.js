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
import { XfaLayer } from "../pdf.js";
class XfaLayerBuilder {
  #cancelled = false;
  div = null;
  constructor({
    pdfPage,
    annotationStorage = null,
    linkService,
    xfaHtml = null
  }) {
    this.pdfPage = pdfPage;
    this.annotationStorage = annotationStorage;
    this.linkService = linkService;
    this.xfaHtml = xfaHtml;
  }
  async render({
    viewport,
    intent = "display"
  }) {
    let xfaHtml;
    if (intent === "print") {
      xfaHtml = this.xfaHtml;
    } else {
      xfaHtml = await this.pdfPage.getXfa();
      if (this.#cancelled || !xfaHtml) {
        return {
          textDivs: []
        };
      }
    }
    const hasDiv = !!this.div;
    const params = {
      viewport: viewport.clone({
        dontFlip: true
      }),
      div: this.div ??= document.createElement("div"),
      xfaHtml,
      annotationStorage: this.annotationStorage,
      linkService: this.linkService,
      intent
    };
    return hasDiv ? XfaLayer.update(params) : XfaLayer.render(params);
  }
  cancel() {
    this.#cancelled = true;
  }
  hide() {
    if (!this.div) {
      return;
    }
    this.div.hidden = true;
  }
}
export { XfaLayerBuilder };