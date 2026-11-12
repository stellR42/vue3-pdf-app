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
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import { FeatureTest, getUuid, makeMap, shadow } from "../pdf.js";
import { removeNullCharacters } from "./ui_utils.js";
const PDF_ROLE_TO_HTML_ROLE = {
  Document: null,
  DocumentFragment: null,
  Part: "group",
  Art: "article",
  Sect: "group",
  Div: "group",
  BlockQuote: "blockquote",
  Aside: "note",
  NonStruct: "none",
  P: "paragraph",
  H: "heading",
  Title: null,
  FENote: "note",
  Sub: "group",
  Lbl: null,
  Span: null,
  Em: "emphasis",
  Strong: "strong",
  Note: "note",
  Code: "code",
  Link: "link",
  Annot: "note",
  Form: "form",
  Ruby: null,
  RB: null,
  RT: null,
  RP: null,
  Warichu: null,
  WT: null,
  WP: null,
  L: "list",
  LI: "listitem",
  LBody: null,
  Table: "table",
  TR: "row",
  TH: "columnheader",
  TD: "cell",
  THead: "rowgroup",
  TBody: "rowgroup",
  TFoot: "rowgroup",
  Caption: "caption",
  Figure: "figure",
  Formula: null,
  Artifact: null
};
const ARIA_ROLES_WITH_PROHIBITED_NAMES = new Set(["caption", "code", "emphasis", "generic", "none", "paragraph", "strong"]);
const MathMLElements = new Set(["math", "merror", "mfrac", "mi", "mmultiscripts", "mn", "mo", "mover", "mpadded", "mprescripts", "mroot", "mrow", "ms", "mspace", "msqrt", "mstyle", "msub", "msubsup", "msup", "mtable", "mtd", "mtext", "mtr", "munder", "munderover", "semantics"]);
const MathMLNamespace = "http://www.w3.org/1998/Math/MathML";
class MathMLSanitizer {
  static get sanitizer() {
    return shadow(this, "sanitizer", FeatureTest.isSanitizerSupported ? new Sanitizer({
      elements: Array.from(MathMLElements.keys(), name => ({
        name,
        namespace: MathMLNamespace
      })),
      replaceWithChildrenElements: [{
        name: "maction",
        namespace: MathMLNamespace
      }],
      attributes: ["dir", "displaystyle", "mathbackground", "mathcolor", "mathsize", "scriptlevel", "encoding", "display", "linethickness", "intent", "arg", "form", "fence", "separator", "lspace", "rspace", "stretchy", "symmetric", "maxsize", "minsize", "largeop", "movablelimits", "width", "height", "depth", "voffset", "accent", "accentunder", "columnspan", "rowspan"],
      comments: false
    }) : null);
  }
}
const HEADING_PATTERN = /^H(\d+)$/;
class StructTreeLayerBuilder {
  #promise;
  #treeDom = null;
  #treePromise;
  #annotationIds = new Set();
  #elementAttributes = new Map();
  #pendingLinkOwnership = new Map();
  #linkTextId = 0;
  #structElementIdPrefix = `pdfjs_internal_struct_${getUuid()}_`;
  #structElementIds = new Map();
  #structElements = new Map();
  #rawDims;
  #elementsToAddToTextLayer = null;
  #elementsToHideInTextLayer = null;
  #elementsToStealFromTextLayer = null;
  constructor(pdfPage, rawDims) {
    this.#promise = pdfPage.getStructTree();
    this.#rawDims = rawDims;
  }
  async render() {
    if (this.#treePromise) {
      return this.#treePromise;
    }
    const {
      promise,
      resolve,
      reject
    } = Promise.withResolvers();
    this.#treePromise = promise;
    try {
      const tree = await this.#promise;
      this.#collectStructElements(tree);
      this.#collectAnnotations(tree);
      this.#treeDom = this.#walk(tree);
    } catch (ex) {
      reject(ex);
    }
    this.#promise = null;
    this.#treeDom?.classList.add("structTree");
    resolve(this.#treeDom);
    return promise;
  }
  async getAriaAttributes(annotationId, {
    enableLinkOwnership = false
  } = {}) {
    try {
      await this.render();
      const ownership = this.#pendingLinkOwnership.get(annotationId);
      if (ownership && enableLinkOwnership) {
        const {
          element,
          ids
        } = ownership;
        element.removeAttribute("role");
        if (ids.length > 0) {
          this.#elementAttributes.getOrInsertComputed(annotationId, makeMap).set("aria-owns", ids.join(" "));
        }
        this.#pendingLinkOwnership.delete(annotationId);
      }
      return this.#elementAttributes.get(annotationId);
    } catch {}
    return null;
  }
  async getAnnotationIds() {
    try {
      await this.render();
      return this.#annotationIds;
    } catch {}
    return null;
  }
  hide() {
    if (this.#treeDom && !this.#treeDom.hidden) {
      this.#treeDom.hidden = true;
    }
  }
  show() {
    if (this.#treeDom?.hidden) {
      this.#treeDom.hidden = false;
    }
  }
  #collectStructElements(node) {
    if (!node) {
      return;
    }
    if (node.structId) {
      this.#structElements.getOrInsert(node.structId, node);
    }
    for (const child of node.children || []) {
      this.#collectStructElements(child);
    }
  }
  #collectAnnotations(node) {
    if (!node) {
      return;
    }
    if (node.type === "annotation") {
      this.#annotationIds.add(node.id);
      return;
    }
    for (const child of node.children || []) {
      this.#collectAnnotations(child);
    }
  }
  #getStructElementId(structId) {
    return this.#structElementIds.getOrInsertComputed(structId, () => `${this.#structElementIdPrefix}${this.#structElementIds.size}`);
  }
  #getHeaderIds(headers) {
    const result = [],
      visited = new Set(),
      pending = headers.toReversed();
    while (pending.length > 0) {
      const structId = pending.pop();
      if (visited.has(structId)) {
        continue;
      }
      visited.add(structId);
      const header = this.#structElements.get(structId);
      if (header?.role !== "TH") {
        continue;
      }
      result.push(this.#getStructElementId(structId));
      if (header.headers) {
        for (let i = header.headers.length - 1; i >= 0; i--) {
          pending.push(header.headers[i]);
        }
      }
    }
    return result;
  }
  #setAttributes(structElement, htmlElement) {
    const {
      alt,
      colSpan,
      headers,
      id,
      lang,
      rowSpan,
      short,
      structId,
      summary
    } = structElement;
    if (alt !== undefined) {
      let added = false;
      const label = removeNullCharacters(alt);
      for (const child of structElement.children) {
        if (child.type === "annotation") {
          this.#elementAttributes.getOrInsertComputed(child.id, makeMap).set("aria-label", label);
          added = true;
        }
      }
      const role = htmlElement.getAttribute("role") || (htmlElement.localName === "span" ? "generic" : null);
      if (!added && role !== "none") {
        htmlElement.setAttribute(ARIA_ROLES_WITH_PROHIBITED_NAMES.has(role) ? "aria-description" : "aria-label", label);
      }
    }
    if (id !== undefined) {
      htmlElement.setAttribute("aria-owns", id);
    }
    if (structId !== undefined && this.#structElements.get(structId) === structElement) {
      const elementId = this.#getStructElementId(structId);
      if (short !== undefined) {
        const abbreviation = document.createElement("span");
        abbreviation.setAttribute("id", elementId);
        abbreviation.setAttribute("aria-hidden", "true");
        abbreviation.textContent = removeNullCharacters(short);
        htmlElement.append(abbreviation);
      } else {
        htmlElement.setAttribute("id", elementId);
      }
    }
    if (lang !== undefined) {
      htmlElement.setAttribute("lang", removeNullCharacters(lang, true));
    }
    if (rowSpan !== undefined) {
      htmlElement.setAttribute("aria-rowspan", rowSpan);
    }
    if (colSpan !== undefined) {
      htmlElement.setAttribute("aria-colspan", colSpan);
    }
    if (headers?.length > 0) {
      const headerIds = this.#getHeaderIds(headers);
      if (headerIds.length > 0) {
        htmlElement.setAttribute("aria-describedby", headerIds.join(" "));
      }
    }
    if (summary !== undefined) {
      htmlElement.setAttribute("aria-description", removeNullCharacters(summary));
    }
  }
  #addImageInTextLayer(node, element) {
    const {
      alt,
      bbox,
      children
    } = node;
    const child = children?.[0];
    if (!this.#rawDims || !alt || !bbox || child?.type !== "content") {
      return false;
    }
    const {
      id
    } = child;
    if (!id) {
      return false;
    }
    element.setAttribute("aria-owns", id);
    const img = document.createElement("span");
    (this.#elementsToAddToTextLayer ||= new Map()).set(id, img);
    img.setAttribute("role", "img");
    img.setAttribute("aria-label", removeNullCharacters(alt));
    const {
      pageHeight,
      pageX,
      pageY
    } = this.#rawDims;
    const calc = "calc(var(--total-scale-factor) *";
    const {
      style
    } = img;
    style.width = `${calc}${bbox[2] - bbox[0]}px)`;
    style.height = `${calc}${bbox[3] - bbox[1]}px)`;
    style.left = `${calc}${bbox[0] - pageX}px)`;
    style.top = `${calc}${pageHeight - bbox[3] + pageY}px)`;
    return true;
  }
  updateTextLayer() {
    if (this.#elementsToAddToTextLayer) {
      for (const [id, img] of this.#elementsToAddToTextLayer) {
        document.getElementById(id)?.append(img);
      }
      this.#elementsToAddToTextLayer.clear();
      this.#elementsToAddToTextLayer = null;
    }
    if (this.#elementsToHideInTextLayer) {
      for (const id of this.#elementsToHideInTextLayer) {
        const elem = document.getElementById(id);
        if (elem) {
          elem.ariaHidden = true;
        }
      }
      this.#elementsToHideInTextLayer.length = 0;
      this.#elementsToHideInTextLayer = null;
    }
    if (this.#elementsToStealFromTextLayer) {
      for (let i = 0, ii = this.#elementsToStealFromTextLayer.length; i < ii; i += 2) {
        const element = this.#elementsToStealFromTextLayer[i];
        const ids = this.#elementsToStealFromTextLayer[i + 1];
        let textContent = "";
        for (const id of ids) {
          const elem = document.getElementById(id);
          if (elem) {
            textContent += elem.textContent.trim() || "";
            elem.ariaHidden = "true";
          }
        }
        if (textContent) {
          element.textContent = textContent;
        }
      }
      this.#elementsToStealFromTextLayer.length = 0;
      this.#elementsToStealFromTextLayer = null;
    }
  }
  #collectIds(node, ids) {
    if (!node) {
      return;
    }
    if ("id" in node) {
      ids.push(node.id);
    }
    for (const kid of node.children || []) {
      this.#collectIds(kid, ids);
    }
  }
  #walk(node, parentNodes = []) {
    if (!node) {
      return null;
    }
    let element;
    let visitChildren = true;
    if ("role" in node) {
      const {
        role
      } = node;
      if (MathMLElements.has(role)) {
        element = document.createElementNS(MathMLNamespace, role);
        const ids = [];
        (this.#elementsToStealFromTextLayer ||= []).push(element, ids);
        for (const {
          type,
          id
        } of node.children || []) {
          if (type === "content" && id) {
            ids.push(id);
          }
        }
      } else {
        element = document.createElement("span");
      }
      const match = role.match(HEADING_PATTERN);
      if (match) {
        element.setAttribute("role", "heading");
        element.setAttribute("aria-level", match[1]);
      } else if (PDF_ROLE_TO_HTML_ROLE[role]) {
        let htmlRole = PDF_ROLE_TO_HTML_ROLE[role];
        if (role === "TH") {
          if (node.scope === "Row") {
            htmlRole = "rowheader";
          } else if (node.scope === "Column") {
            htmlRole = "columnheader";
          } else if (parentNodes.at(-1)?.role === "TR" && parentNodes.at(-2)?.role === "TBody") {
            htmlRole = "rowheader";
          }
        } else if (role === "Caption") {
          const parentRole = parentNodes.at(-1)?.role;
          if (parentRole !== "Table" && parentRole !== "Figure") {
            htmlRole = null;
          }
        }
        if (htmlRole) {
          element.setAttribute("role", htmlRole);
        }
      }
      if (role === "Figure" && this.#addImageInTextLayer(node, element)) {
        return element;
      }
      if (role === "Formula") {
        if (node.mathML && MathMLSanitizer.sanitizer) {
          visitChildren = false;
          element.setHTML(node.mathML, {
            sanitizer: MathMLSanitizer.sanitizer
          });
          this.#collectIds(node, this.#elementsToHideInTextLayer ||= []);
          delete node.alt;
        }
        if (!node.mathML && node.children.length === 1 && node.children[0].role !== "math") {
          element = document.createElementNS(MathMLNamespace, "math");
          delete node.alt;
        }
      }
    }
    element ||= document.createElement("span");
    this.#setAttributes(node, element);
    if (node.children) {
      if (node.children.length === 1 && !("role" in node.children[0]) && "id" in node.children[0] && element.getAttribute("role") !== "none") {
        this.#setAttributes(node.children[0], element);
      } else if (visitChildren) {
        parentNodes.push(node);
        for (const kid of node.children) {
          element.append(this.#walk(kid, parentNodes));
        }
        parentNodes.pop();
      }
    }
    if (node.role === "Link") {
      const annotations = node.children?.filter(child => child.type === "annotation");
      if (annotations?.length === 1) {
        const annotation = annotations[0];
        const ids = [];
        for (const child of element.children) {
          if (child.getAttribute("aria-owns") === annotation.id) {
            continue;
          }
          child.id ||= `${this.#structElementIdPrefix}link_${this.#linkTextId++}`;
          ids.push(child.id);
        }
        this.#pendingLinkOwnership.set(annotation.id, {
          element,
          ids
        });
      }
    }
    return element;
  }
}
export { StructTreeLayerBuilder };