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
import "core-js/modules/es.iterator.map.js";
import "core-js/modules/web.url.parse.js";
import { AnnotationType, createValidAbsoluteUrl, Util } from "../pdf.js";
import { getOriginalIndex, normalize } from "./pdf_find_controller.js";
function DOMRectToPDF({
  width,
  height,
  left,
  top
}, pdfPageView) {
  if (width === 0 || height === 0) {
    return null;
  }
  const pageBox = pdfPageView.textLayer.div.getBoundingClientRect();
  const bottomLeft = pdfPageView.getPagePoint(left - pageBox.left, top - pageBox.top);
  const topRight = pdfPageView.getPagePoint(left - pageBox.left + width, top - pageBox.top + height);
  return Util.normalizeRect([bottomLeft[0], bottomLeft[1], topRight[0], topRight[1]]);
}
function calculateLinkPosition(range, pdfPageView) {
  const rangeRects = range.getClientRects();
  if (rangeRects.length === 1) {
    return {
      rect: DOMRectToPDF(rangeRects[0], pdfPageView)
    };
  }
  const rect = [Infinity, Infinity, -Infinity, -Infinity];
  const quadPoints = [];
  let i = 0;
  for (const domRect of rangeRects) {
    const normalized = DOMRectToPDF(domRect, pdfPageView);
    if (normalized === null) {
      continue;
    }
    quadPoints[i] = quadPoints[i + 4] = normalized[0];
    quadPoints[i + 1] = quadPoints[i + 3] = normalized[3];
    quadPoints[i + 2] = quadPoints[i + 6] = normalized[2];
    quadPoints[i + 5] = quadPoints[i + 7] = normalized[1];
    Util.rectBoundingBox(...normalized, rect);
    i += 8;
  }
  return {
    quadPoints,
    rect
  };
}
function textPosition(container, offset) {
  let currentContainer = container;
  do {
    if (currentContainer.nodeType === Node.TEXT_NODE) {
      const currentLength = currentContainer.textContent.length;
      if (offset <= currentLength) {
        return [currentContainer, offset];
      }
      offset -= currentLength;
    } else if (currentContainer.firstChild) {
      currentContainer = currentContainer.firstChild;
      continue;
    }
    while (!currentContainer.nextSibling && currentContainer !== container) {
      currentContainer = currentContainer.parentNode;
    }
    if (currentContainer !== container) {
      currentContainer = currentContainer.nextSibling;
    }
  } while (currentContainer !== container);
  throw new Error("Offset is bigger than container's contents length.");
}
class Autolinker {
  static #index = 0;
  static #regex;
  static #numericTLDRegex;
  static findLinks(text) {
    this.#regex ??= /\b(?:https?:\/\/|mailto:|www\.)(?:[\S--[\p{P}<>]]|\/|[\S--[\[\]]]+[\S--[\p{P}<>]])+|(?=\p{L})[\S--[@\p{Ps}\p{Pe}<>]]{1,64}@([\S--[[\p{P}--\-]<>]]{1,63}(?:\.[\S--[[\p{P}--\-]<>]]{1,63})+)/gv;
    const [normalizedText, diffs] = normalize(text, {
      ignoreDashEOL: true
    });
    const matches = normalizedText.matchAll(this.#regex);
    const links = [];
    for (const match of matches) {
      const [url, emailDomain] = match;
      let raw;
      if (url.startsWith("www.") || url.startsWith("http://") || url.startsWith("https://")) {
        raw = url;
      } else if (emailDomain) {
        const hostname = URL.parse(`http://${emailDomain}`)?.hostname;
        if (!hostname) {
          continue;
        }
        this.#numericTLDRegex ??= /\.\d+$/;
        if (this.#numericTLDRegex.test(hostname)) {
          continue;
        }
      }
      raw ??= url.startsWith("mailto:") ? url : `mailto:${url}`;
      const absoluteURL = createValidAbsoluteUrl(raw, null, {
        addDefaultProtocol: true
      });
      if (absoluteURL) {
        const [index, length] = getOriginalIndex(diffs, match.index, url.length);
        links.push({
          url: absoluteURL.href,
          index,
          length
        });
      }
    }
    return links;
  }
  static processLinks(pdfPageView) {
    const highlighter = pdfPageView._textHighlighter;
    const textContent = highlighter.textContentItemsStr.join("\n");
    if (!textContent) {
      return [];
    }
    const links = this.findLinks(textContent);
    if (!links.length) {
      return [];
    }
    const matches = highlighter._convertMatches(links.map(({
      index
    }) => index), links.map(({
      length
    }) => length));
    const {
      textDivs
    } = highlighter;
    const range = new Range();
    return links.map(({
      url
    }, i) => {
      const {
        begin,
        end
      } = matches[i];
      range.setStart(...textPosition(textDivs[begin.divIdx], begin.offset));
      range.setEnd(...textPosition(textDivs[end.divIdx], end.offset));
      return {
        id: `inferred_link_${this.#index++}`,
        unsafeUrl: url,
        url,
        annotationType: AnnotationType.LINK,
        rotation: 0,
        ...calculateLinkPosition(range, pdfPageView),
        borderStyle: null
      };
    });
  }
}
export { Autolinker };