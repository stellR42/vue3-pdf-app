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
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import "core-js/modules/es.typed-array.with.js";
import "core-js/modules/es.uint8-array.set-from-base64.js";
import "core-js/modules/es.uint8-array.set-from-hex.js";
import "core-js/modules/es.uint8-array.to-base64.js";
import "core-js/modules/es.uint8-array.to-hex.js";
import { Cmd, Dict, EOF, Ref, RefMap } from "../primitives.js";
import { stringToBytes, warn } from "../../shared/util.js";
import { BaseStream } from "../base_stream.js";
import { EvaluatorPreprocessor } from "../evaluator.js";
import { Lexer } from "../parser.js";
import { LocalPdfManager } from "../pdf_manager.js";
import { Stream } from "../stream.js";
const MARKED_CONTENT_OPS = new Set(["BDC", "BMC", "DP", "EMC", "MP"]);
class ChangesXRefWrapper {
  #changes;
  #xref;
  constructor(changes, xref) {
    this.#changes = changes;
    this.#xref = xref;
  }
  getNewTemporaryRef() {
    return this.#xref.getNewTemporaryRef();
  }
  fetch(ref) {
    return this.#changes.has(ref) ? this.#changes.get(ref).data : this.#xref.fetch(ref);
  }
  fetchIfRef(obj) {
    return obj instanceof Ref ? this.fetch(obj) : obj;
  }
  async fetchAsync(ref) {
    return this.fetch(ref);
  }
  async fetchIfRefAsync(obj) {
    return this.fetchIfRef(obj);
  }
}
async function copyObject(obj, sourceXref, target) {
  const {
    changes,
    refs,
    xref,
    xrefWrapper
  } = target;
  if (obj instanceof Ref) {
    let newRef = refs.get(obj);
    if (!newRef) {
      refs.put(obj, newRef = xref.getNewTemporaryRef());
      const value = await sourceXref.fetchAsync(obj);
      changes.put(newRef, {
        data: await copyObject(value, sourceXref, target)
      });
    }
    return newRef;
  }
  if (Array.isArray(obj)) {
    return Promise.all(obj.map(value => copyObject(value, sourceXref, target)));
  }
  let dict, stream;
  if (obj instanceof BaseStream) {
    ({
      dict
    } = stream = obj.getOriginalStream().clone());
  } else if (obj instanceof Dict) {
    dict = obj.clone();
  } else {
    return obj;
  }
  dict.xref = xrefWrapper;
  const promises = [];
  for (const [key, value] of dict.getRawEntries()) {
    promises.push(copyObject(value, sourceXref, target).then(newValue => dict.set(key, newValue)));
  }
  await Promise.all(promises);
  return stream ?? dict;
}
function filterContentStream(bytes, isWidget) {
  const lexer = new Lexer(new Stream(bytes), EvaluatorPreprocessor.opMap);
  const parts = isWidget ? [stringToBytes("/Tx BMC\n")] : [];
  let start = 0;
  let end = 0;
  try {
    while (true) {
      const obj = lexer.getObj();
      if (obj === EOF) {
        break;
      }
      if (!(obj instanceof Cmd) || !EvaluatorPreprocessor.opMap[obj.cmd]) {
        continue;
      }
      if (obj.cmd === "BI") {
        warn("filterContentStream: inline images aren't supported.");
        return null;
      }
      const cmdEnd = lexer.currentChar < 0 ? bytes.length : lexer.stream.pos - 1;
      if (MARKED_CONTENT_OPS.has(obj.cmd)) {
        parts.push(bytes.subarray(start, end));
        start = cmdEnd;
      }
      end = cmdEnd;
    }
  } catch (reason) {
    warn(`filterContentStream: "${reason}".`);
    return null;
  }
  parts.push(bytes.subarray(start));
  if (isWidget) {
    parts.push(stringToBytes("\nEMC"));
  }
  const data = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }
  return data;
}
async function importPrintedAppearances({
  buffer,
  changes,
  docId,
  entries,
  evaluatorOptions,
  handler,
  xref
}) {
  const pdfManager = new LocalPdfManager({
    source: buffer,
    docId: `${docId}_printToPDF`,
    handler,
    evaluatorOptions
  });
  await pdfManager.initDocument(false);
  const {
    pdfDocument
  } = pdfManager;
  if (pdfDocument.numPages !== entries.length) {
    throw new Error("The generated PDF must have one page per appearance.");
  }
  const appearances = new Map();
  const target = {
    changes,
    refs: new RefMap(),
    xref,
    xrefWrapper: new ChangesXRefWrapper(changes, xref)
  };
  for (let i = 0, ii = entries.length; i < ii; i++) {
    const {
      key,
      isWidget,
      matrix,
      data
    } = entries[i];
    const page = await pdfDocument.getPage(i);
    const contentStream = await page.getContentStream();
    contentStream.reset();
    const bytes = filterContentStream(contentStream.getBytes(), isWidget);
    if (!bytes) {
      continue;
    }
    const dict = new Dict(xref);
    dict.setIfName("Type", "XObject");
    dict.setIfName("Subtype", "Form");
    dict.set("FormType", 1);
    dict.set("BBox", [0, 0, data.width, data.height]);
    dict.setIfArray("Matrix", matrix);
    dict.set("Resources", await copyObject(page.resources, pdfDocument.xref, target));
    const ref = xref.getNewTemporaryRef();
    changes.put(ref, {
      data: new Stream(bytes, 0, bytes.length, dict)
    });
    appearances.set(key, ref);
  }
  return appearances;
}
export { importPrintedAppearances };