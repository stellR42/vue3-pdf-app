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
import "core-js/modules/es.iterator.every.js";
import "core-js/modules/es.iterator.map.js";
import "core-js/modules/es.json.stringify.js";
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
import { _isValidExplicitDest, createValidAbsoluteUrl, DocumentActionEventType, FormatError, info, makeArr, PermissionFlag, shadow, stringToUTF8String, warn } from "../shared/util.js";
import { collectActions, isNumberArray, lookupRect, MissingDataException, PDF_VERSION_REGEXP, recoverJsURL, toRomanNumerals, XRefEntryException } from "./core_utils.js";
import { Dict, isDict, isName, isRefsEqual, Name, Ref, RefMap, RefSet } from "./primitives.js";
import { GlobalColorSpaceCache, GlobalImageCache } from "./image_utils.js";
import { NameTree, NumberTree } from "./name_number_tree.js";
import { BaseStream } from "./base_stream.js";
import { clearGlobalCaches } from "./cleanup_helper.js";
import { ColorSpaceUtils } from "./colorspace_utils.js";
import { FileSpec } from "./file_spec.js";
import { MetadataParser } from "./metadata_parser.js";
import { soundStreamToWav } from "./sound.js";
import { stringToPDFString } from "./string_utils.js";
import { StructTreeRoot } from "./struct_tree.js";
const isRef = v => v instanceof Ref;
const isValidExplicitDest = _isValidExplicitDest.bind(null, isRef, isName);
function fetchDest(dest) {
  if (dest instanceof Dict) {
    dest = dest.get("D");
  }
  return isValidExplicitDest(dest) ? dest : null;
}
function fetchRemoteDest(action) {
  let dest = action.get("D");
  if (dest) {
    if (dest instanceof Name) {
      dest = dest.name;
    }
    if (typeof dest === "string") {
      return stringToPDFString(dest, true);
    } else if (isValidExplicitDest(dest)) {
      return JSON.stringify(dest);
    }
  }
  return null;
}
class Catalog {
  #actualNumPages = null;
  #annotationAttachmentIdByRef = new RefMap();
  #annotationAttachmentRefById = new Map();
  #soundAttachmentIds = new Set();
  #catDict = null;
  builtInCMapCache = new Map();
  fontCache = new RefMap();
  globalColorSpaceCache = new GlobalColorSpaceCache();
  globalImageCache = new GlobalImageCache();
  nonBlendModesSet = new RefSet();
  pageDictCache = new RefMap();
  pageIndexCache = new RefMap();
  pageKidsCountCache = new RefMap();
  standardFontDataCache = new Map();
  systemFontCache = new Map();
  constructor(pdfManager, xref) {
    this.pdfManager = pdfManager;
    this.xref = xref;
    this.#catDict = xref.getCatalogObj();
    if (!(this.#catDict instanceof Dict)) {
      throw new FormatError("Catalog object is not a dictionary.");
    }
    this.toplevelPagesDict;
  }
  cloneDict() {
    return this.#catDict.clone();
  }
  getAttachmentIdForAnnotation(ref, isSound = false) {
    let id = this.#annotationAttachmentIdByRef.get(ref);
    if (!id) {
      const baseId = `attachmentRef:${ref.toString()}`;
      id = baseId;
      let i = 1;
      while (this.#annotationAttachmentRefById.has(id) || this.attachments?.has(id)) {
        id = `${baseId}-${i++}`;
      }
      this.#annotationAttachmentIdByRef.put(ref, id);
      this.#annotationAttachmentRefById.set(id, ref);
    }
    if (isSound) {
      this.#soundAttachmentIds.add(id);
    }
    return id;
  }
  get version() {
    const version = this.#catDict.get("Version");
    if (version instanceof Name) {
      if (PDF_VERSION_REGEXP.test(version.name)) {
        return shadow(this, "version", version.name);
      }
      warn(`Invalid PDF catalog version: ${version.name}`);
    }
    return shadow(this, "version", null);
  }
  get lang() {
    const lang = this.#catDict.get("Lang");
    return shadow(this, "lang", lang && typeof lang === "string" ? stringToPDFString(lang) : null);
  }
  get needsRendering() {
    const needsRendering = this.#catDict.get("NeedsRendering");
    return shadow(this, "needsRendering", needsRendering === true);
  }
  get collection() {
    let collection = null;
    try {
      const obj = this.#catDict.get("Collection");
      if (obj instanceof Dict && obj.size > 0) {
        collection = obj;
      }
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      info("Cannot fetch Collection entry; assuming no collection is present.");
    }
    return shadow(this, "collection", collection);
  }
  get acroForm() {
    let acroForm = null;
    try {
      const obj = this.#catDict.get("AcroForm");
      if (obj instanceof Dict && obj.size > 0) {
        acroForm = obj;
      }
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      info("Cannot fetch AcroForm entry; assuming no forms are present.");
    }
    return shadow(this, "acroForm", acroForm);
  }
  get acroFormRef() {
    const value = this.#catDict.getRaw("AcroForm");
    return shadow(this, "acroFormRef", value instanceof Ref ? value : null);
  }
  get metadata() {
    const streamRef = this.#catDict.getRaw("Metadata");
    if (!(streamRef instanceof Ref)) {
      return shadow(this, "metadata", null);
    }
    let metadata = null;
    try {
      const stream = this.xref.fetch(streamRef, !this.xref.encrypt?.encryptMetadata);
      if (stream instanceof BaseStream && isDict(stream.dict, "Metadata") && isName(stream.dict.get("Subtype"), "XML")) {
        const data = stringToUTF8String(stream.getString());
        if (data) {
          metadata = new MetadataParser(data).serializable;
        }
      }
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      info(`Skipping invalid Metadata: "${ex}".`);
    }
    return shadow(this, "metadata", metadata);
  }
  get markInfo() {
    let markInfo = null;
    try {
      markInfo = this.#readMarkInfo();
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn("Unable to read mark info.");
    }
    return shadow(this, "markInfo", markInfo);
  }
  #readMarkInfo() {
    const obj = this.#catDict.get("MarkInfo");
    if (!(obj instanceof Dict)) {
      return null;
    }
    const markInfo = new Map();
    for (const key of ["Marked", "UserProperties", "Suspects"]) {
      const val = obj.get(key);
      markInfo.set(key, val === true);
    }
    return markInfo;
  }
  get hasStructTree() {
    return this.#catDict.has("StructTreeRoot");
  }
  get structTreeRoot() {
    let structTree = null;
    try {
      structTree = this.#readStructTreeRoot();
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn("Unable read to structTreeRoot info.");
    }
    return shadow(this, "structTreeRoot", structTree);
  }
  #readStructTreeRoot() {
    const rawObj = this.#catDict.getRaw("StructTreeRoot"),
      obj = this.xref.fetchIfRef(rawObj);
    return obj instanceof Dict ? new StructTreeRoot(this.xref, obj, rawObj) : null;
  }
  get toplevelPagesDict() {
    const pagesObj = this.#catDict.get("Pages");
    if (!(pagesObj instanceof Dict)) {
      throw new FormatError("Invalid top-level pages dictionary.");
    }
    return shadow(this, "toplevelPagesDict", pagesObj);
  }
  get documentOutline() {
    let obj = null;
    try {
      obj = this.#readDocumentOutline();
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn("Unable to read document outline.");
    }
    return shadow(this, "documentOutline", obj);
  }
  #readDocumentOutline(options = {}) {
    let obj = this.#catDict.get("Outlines");
    if (!(obj instanceof Dict)) {
      return null;
    }
    obj = obj.getRaw("First");
    if (!(obj instanceof Ref)) {
      return null;
    }
    const root = {
      items: []
    };
    const queue = [{
      obj,
      parent: root
    }];
    const processed = new RefSet();
    processed.put(obj);
    const xref = this.xref,
      blackColor = new Uint8ClampedArray(3);
    while (queue.length > 0) {
      const i = queue.shift();
      const outlineDict = xref.fetchIfRef(i.obj);
      if (outlineDict === null) {
        continue;
      }
      if (!outlineDict.has("Title")) {
        warn("Invalid outline item encountered.");
      }
      const data = {
        url: null,
        dest: null,
        action: null
      };
      Catalog.parseDestDictionary({
        destDict: outlineDict,
        resultObj: data,
        docBaseUrl: this.baseUrl,
        docAttachments: this.attachments
      });
      const title = outlineDict.get("Title");
      const flags = outlineDict.get("F") || 0;
      const color = outlineDict.getArray("C");
      const count = outlineDict.get("Count");
      let rgbColor = blackColor;
      if (isNumberArray(color, 3) && (color[0] !== 0 || color[1] !== 0 || color[2] !== 0)) {
        rgbColor = ColorSpaceUtils.rgb.getRgb(color, 0);
      }
      const outlineItem = {
        action: data.action,
        attachmentId: data.attachmentId,
        attachment: data.attachment,
        dest: data.dest,
        url: data.url,
        unsafeUrl: data.unsafeUrl,
        newWindow: data.newWindow,
        setOCGState: data.setOCGState,
        title: typeof title === "string" ? stringToPDFString(title) : "",
        color: rgbColor,
        count: Number.isInteger(count) ? count : undefined,
        bold: !!(flags & 2),
        italic: !!(flags & 1),
        items: []
      };
      if (options.keepRawDict) {
        outlineItem.rawDict = outlineDict;
      }
      i.parent.items.push(outlineItem);
      obj = outlineDict.getRaw("First");
      if (obj instanceof Ref && !processed.has(obj)) {
        queue.push({
          obj,
          parent: outlineItem
        });
        processed.put(obj);
      }
      obj = outlineDict.getRaw("Next");
      if (obj instanceof Ref && !processed.has(obj)) {
        queue.push({
          obj,
          parent: i.parent
        });
        processed.put(obj);
      }
    }
    return root.items.length > 0 ? root.items : null;
  }
  get documentOutlineForEditor() {
    let obj = null;
    try {
      obj = this.#readDocumentOutline({
        keepRawDict: true
      });
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn("Unable to read document outline.");
    }
    return shadow(this, "documentOutlineForEditor", obj);
  }
  get permissions() {
    let permissions = null;
    try {
      permissions = this.#readPermissions();
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn("Unable to read permissions.");
    }
    return shadow(this, "permissions", permissions);
  }
  #readPermissions() {
    const encrypt = this.xref.trailer.get("Encrypt");
    if (!(encrypt instanceof Dict)) {
      return null;
    }
    let flags = encrypt.get("P");
    if (typeof flags !== "number") {
      return null;
    }
    flags += 2 ** 32;
    const permissions = new Set();
    for (const value of Object.values(PermissionFlag)) {
      if (flags & value) {
        permissions.add(value);
      }
    }
    return permissions;
  }
  get optionalContentConfig() {
    let config = null;
    try {
      const properties = this.#catDict.get("OCProperties");
      if (!properties) {
        return shadow(this, "optionalContentConfig", null);
      }
      const defaultConfig = properties.get("D");
      if (!defaultConfig) {
        return shadow(this, "optionalContentConfig", null);
      }
      const groupsData = properties.get("OCGs");
      if (!Array.isArray(groupsData)) {
        return shadow(this, "optionalContentConfig", null);
      }
      const groupRefCache = new RefMap();
      for (const groupRef of groupsData) {
        if (!(groupRef instanceof Ref) || groupRefCache.has(groupRef)) {
          continue;
        }
        groupRefCache.put(groupRef, this.#readOptionalContentGroup(groupRef));
      }
      config = this.#readOptionalContentConfig(defaultConfig, groupRefCache);
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn(`Unable to read optional content config: ${ex}`);
    }
    return shadow(this, "optionalContentConfig", config);
  }
  #readOptionalContentGroup(groupRef) {
    const group = this.xref.fetch(groupRef);
    const obj = {
      id: groupRef.toString(),
      name: null,
      intent: null,
      usage: {
        print: null,
        view: null
      },
      rbGroups: []
    };
    const name = group.get("Name");
    if (typeof name === "string") {
      obj.name = stringToPDFString(name);
    }
    let intent = group.getArray("Intent");
    if (!Array.isArray(intent)) {
      intent = [intent];
    }
    if (intent.every(i => i instanceof Name)) {
      obj.intent = intent.map(i => i.name);
    }
    const usage = group.get("Usage");
    if (!(usage instanceof Dict)) {
      return obj;
    }
    const usageObj = obj.usage;
    const print = usage.get("Print");
    if (print instanceof Dict) {
      const printState = print.get("PrintState");
      if (printState instanceof Name) {
        switch (printState.name) {
          case "ON":
          case "OFF":
            usageObj.print = {
              printState: printState.name
            };
        }
      }
    }
    const view = usage.get("View");
    if (view instanceof Dict) {
      const viewState = view.get("ViewState");
      if (viewState instanceof Name) {
        switch (viewState.name) {
          case "ON":
          case "OFF":
            usageObj.view = {
              viewState: viewState.name
            };
        }
      }
    }
    return obj;
  }
  #readOptionalContentConfig(config, groupRefCache) {
    function parseOnOff(refs) {
      const onParsed = [];
      if (Array.isArray(refs)) {
        for (const value of refs) {
          if (value instanceof Ref && groupRefCache.has(value)) {
            onParsed.push(value.toString());
          }
        }
      }
      return onParsed;
    }
    function parseOrder(refs, nestedLevels = 0) {
      if (!Array.isArray(refs)) {
        return null;
      }
      const order = [];
      for (const value of refs) {
        if (value instanceof Ref && groupRefCache.has(value)) {
          parsedOrderRefs.put(value);
          order.push(value.toString());
          continue;
        }
        const nestedOrder = parseNestedOrder(value, nestedLevels);
        if (nestedOrder) {
          order.push(nestedOrder);
        }
      }
      if (nestedLevels > 0) {
        return order;
      }
      const hiddenGroups = [];
      for (const [groupRef] of groupRefCache.items()) {
        if (parsedOrderRefs.has(groupRef)) {
          continue;
        }
        hiddenGroups.push(groupRef.toString());
      }
      if (hiddenGroups.length) {
        order.push({
          name: null,
          order: hiddenGroups
        });
      }
      return order;
    }
    function parseNestedOrder(ref, nestedLevels) {
      if (++nestedLevels > MAX_NESTED_LEVELS) {
        warn("parseNestedOrder - reached MAX_NESTED_LEVELS.");
        return null;
      }
      const value = xref.fetchIfRef(ref);
      if (!Array.isArray(value)) {
        return null;
      }
      const nestedName = xref.fetchIfRef(value[0]);
      if (typeof nestedName !== "string") {
        return null;
      }
      const nestedOrder = parseOrder(value.slice(1), nestedLevels);
      return !nestedOrder?.length ? null : {
        name: stringToPDFString(nestedName),
        order: nestedOrder
      };
    }
    function parseRBGroups(rbGroups) {
      if (!Array.isArray(rbGroups)) {
        return;
      }
      for (const value of rbGroups) {
        const rbGroup = xref.fetchIfRef(value);
        if (!Array.isArray(rbGroup) || !rbGroup.length) {
          continue;
        }
        const parsedRbGroup = new Set();
        for (const ref of rbGroup) {
          if (ref instanceof Ref && groupRefCache.has(ref) && !parsedRbGroup.has(ref.toString())) {
            parsedRbGroup.add(ref.toString());
            groupRefCache.get(ref).rbGroups.push(parsedRbGroup);
          }
        }
      }
    }
    const xref = this.xref,
      parsedOrderRefs = new RefSet(),
      MAX_NESTED_LEVELS = 10;
    parseRBGroups(config.get("RBGroups"));
    return {
      name: typeof config.get("Name") === "string" ? stringToPDFString(config.get("Name")) : null,
      creator: typeof config.get("Creator") === "string" ? stringToPDFString(config.get("Creator")) : null,
      baseState: config.get("BaseState") instanceof Name ? config.get("BaseState").name : null,
      on: parseOnOff(config.get("ON")),
      off: parseOnOff(config.get("OFF")),
      order: parseOrder(config.get("Order")),
      groups: [...groupRefCache]
    };
  }
  setActualNumPages(num = null) {
    this.#actualNumPages = num;
  }
  get hasActualNumPages() {
    return this.#actualNumPages !== null;
  }
  get _pagesCount() {
    const obj = this.toplevelPagesDict.get("Count");
    if (!Number.isInteger(obj)) {
      throw new FormatError("Page count in top-level pages dictionary is not an integer.");
    }
    return shadow(this, "_pagesCount", obj);
  }
  get numPages() {
    return this.#actualNumPages ?? this._pagesCount;
  }
  get destinations() {
    const dests = new Map();
    for (const obj of this.#readDests()) {
      if (obj instanceof NameTree) {
        for (const [key, value] of obj.getAll()) {
          const dest = fetchDest(value);
          if (dest) {
            dests.set(stringToPDFString(key, true), dest);
          }
        }
      } else if (obj instanceof Dict) {
        for (const [key, value] of obj) {
          const dest = fetchDest(value);
          if (dest) {
            dests.getOrInsert(stringToPDFString(key, true), dest);
          }
        }
      }
    }
    return shadow(this, "destinations", dests);
  }
  getDestination(id) {
    if (Object.hasOwn(this, "destinations")) {
      return this.destinations.get(id) ?? null;
    }
    for (const obj of this.#readDests()) {
      if (obj instanceof NameTree || obj instanceof Dict) {
        const dest = fetchDest(obj.get(id));
        if (dest) {
          return dest;
        }
      }
    }
    return this.destinations.get(id) ?? null;
  }
  #readDests() {
    const obj = this.#catDict.get("Names");
    const rawDests = [];
    if (obj?.has("Dests")) {
      rawDests.push(new NameTree(obj.getRaw("Dests"), this.xref));
    }
    if (this.#catDict.has("Dests")) {
      rawDests.push(this.#catDict.get("Dests"));
    }
    return rawDests;
  }
  get rawPageLabels() {
    const obj = this.#catDict.getRaw("PageLabels");
    if (!obj) {
      return null;
    }
    const numberTree = new NumberTree(obj, this.xref);
    return numberTree.getAll();
  }
  get pageLabels() {
    let obj = null;
    try {
      obj = this.#readPageLabels();
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn("Unable to read page labels.");
    }
    return shadow(this, "pageLabels", obj);
  }
  #readPageLabels() {
    const nums = this.rawPageLabels;
    if (!nums) {
      return null;
    }
    const pageLabels = new Array(this.numPages);
    let style = null,
      prefix = "";
    let currentLabel = "",
      currentIndex = 1;
    for (let i = 0, ii = this.numPages; i < ii; i++) {
      const labelDict = nums.get(i);
      if (labelDict !== undefined) {
        if (!(labelDict instanceof Dict)) {
          throw new FormatError("PageLabel is not a dictionary.");
        }
        if (labelDict.has("Type") && !isName(labelDict.get("Type"), "PageLabel")) {
          throw new FormatError("Invalid type in PageLabel dictionary.");
        }
        if (labelDict.has("S")) {
          const s = labelDict.get("S");
          if (!(s instanceof Name)) {
            throw new FormatError("Invalid style in PageLabel dictionary.");
          }
          style = s.name;
        } else {
          style = null;
        }
        if (labelDict.has("P")) {
          const p = labelDict.get("P");
          if (typeof p !== "string") {
            throw new FormatError("Invalid prefix in PageLabel dictionary.");
          }
          prefix = stringToPDFString(p);
        } else {
          prefix = "";
        }
        if (labelDict.has("St")) {
          const st = labelDict.get("St");
          if (!(Number.isInteger(st) && st >= 1)) {
            throw new FormatError("Invalid start in PageLabel dictionary.");
          }
          currentIndex = st;
        } else {
          currentIndex = 1;
        }
      }
      switch (style) {
        case "D":
          currentLabel = currentIndex;
          break;
        case "R":
        case "r":
          currentLabel = toRomanNumerals(currentIndex, style === "r");
          break;
        case "A":
        case "a":
          const LIMIT = 26;
          const letterIndex = currentIndex - 1;
          const character = String.fromCharCode(style.charCodeAt(0) + letterIndex % LIMIT);
          currentLabel = character.repeat(Math.floor(letterIndex / LIMIT) + 1);
          break;
        default:
          if (style) {
            throw new FormatError(`Invalid style "${style}" in PageLabel dictionary.`);
          }
          currentLabel = "";
      }
      pageLabels[i] = prefix + currentLabel;
      currentIndex++;
    }
    return pageLabels;
  }
  get pageLayout() {
    const obj = this.#catDict.get("PageLayout");
    let pageLayout = "";
    if (obj instanceof Name) {
      switch (obj.name) {
        case "SinglePage":
        case "OneColumn":
        case "TwoColumnLeft":
        case "TwoColumnRight":
        case "TwoPageLeft":
        case "TwoPageRight":
          pageLayout = obj.name;
      }
    }
    return shadow(this, "pageLayout", pageLayout);
  }
  get pageMode() {
    const obj = this.#catDict.get("PageMode");
    let pageMode = "UseNone";
    if (obj instanceof Name) {
      switch (obj.name) {
        case "UseNone":
        case "UseOutlines":
        case "UseThumbs":
        case "FullScreen":
        case "UseOC":
        case "UseAttachments":
          pageMode = obj.name;
      }
    }
    return shadow(this, "pageMode", pageMode);
  }
  get viewerPreferences() {
    const obj = this.#catDict.get("ViewerPreferences");
    if (!(obj instanceof Dict)) {
      return shadow(this, "viewerPreferences", null);
    }
    let prefs = null;
    for (const [key, value] of obj) {
      let prefValue;
      switch (key) {
        case "HideToolbar":
        case "HideMenubar":
        case "HideWindowUI":
        case "FitWindow":
        case "CenterWindow":
        case "DisplayDocTitle":
        case "PickTrayByPDFSize":
          if (typeof value === "boolean") {
            prefValue = value;
          }
          break;
        case "NonFullScreenPageMode":
          if (value instanceof Name) {
            switch (value.name) {
              case "UseNone":
              case "UseOutlines":
              case "UseThumbs":
              case "UseOC":
                prefValue = value.name;
                break;
              default:
                prefValue = "UseNone";
            }
          }
          break;
        case "Direction":
          if (value instanceof Name) {
            switch (value.name) {
              case "L2R":
              case "R2L":
                prefValue = value.name;
                break;
              default:
                prefValue = "L2R";
            }
          }
          break;
        case "ViewArea":
        case "ViewClip":
        case "PrintArea":
        case "PrintClip":
          if (value instanceof Name) {
            switch (value.name) {
              case "MediaBox":
              case "CropBox":
              case "BleedBox":
              case "TrimBox":
              case "ArtBox":
                prefValue = value.name;
                break;
              default:
                prefValue = "CropBox";
            }
          }
          break;
        case "PrintScaling":
          if (value instanceof Name) {
            switch (value.name) {
              case "None":
              case "AppDefault":
                prefValue = value.name;
                break;
              default:
                prefValue = "AppDefault";
            }
          }
          break;
        case "Duplex":
          if (value instanceof Name) {
            switch (value.name) {
              case "Simplex":
              case "DuplexFlipShortEdge":
              case "DuplexFlipLongEdge":
                prefValue = value.name;
                break;
              default:
                prefValue = "None";
            }
          }
          break;
        case "PrintPageRange":
          if (Array.isArray(value) && value.length % 2 === 0 && value.every((page, i, arr) => Number.isInteger(page) && page > 0 && (i === 0 || page >= arr[i - 1]) && page <= this.numPages)) {
            prefValue = value;
          }
          break;
        case "NumCopies":
          if (Number.isInteger(value) && value > 0) {
            prefValue = value;
          }
          break;
        default:
          warn(`Ignoring non-standard key in ViewerPreferences: ${key}.`);
          continue;
      }
      if (prefValue === undefined) {
        warn(`Bad value, for key "${key}", in ViewerPreferences: ${value}.`);
        continue;
      }
      (prefs ??= new Map()).set(key, prefValue);
    }
    return shadow(this, "viewerPreferences", prefs);
  }
  get openAction() {
    const obj = this.#catDict.get("OpenAction");
    const openAction = new Map();
    if (obj instanceof Dict) {
      const destDict = new Dict(this.xref);
      destDict.set("A", obj);
      const resultObj = {
        url: null,
        dest: null,
        action: null
      };
      Catalog.parseDestDictionary({
        destDict,
        resultObj
      });
      if (Array.isArray(resultObj.dest)) {
        openAction.set("dest", resultObj.dest);
      } else if (resultObj.action) {
        openAction.set("action", resultObj.action);
      }
    } else if (isValidExplicitDest(obj)) {
      openAction.set("dest", obj);
    }
    return shadow(this, "openAction", openAction.size ? openAction : null);
  }
  get attachments() {
    const obj = this.#catDict.get("Names");
    let attachments = null;
    if (obj instanceof Dict && obj.has("EmbeddedFiles")) {
      const nameTree = new NameTree(obj.getRaw("EmbeddedFiles"), this.xref);
      for (const [key, value] of nameTree.getAll()) {
        (attachments ??= new Map()).set(stringToPDFString(key, true), new FileSpec(value).serializable);
      }
    }
    return shadow(this, "attachments", attachments);
  }
  #attachmentContentByName(id) {
    const obj = this.#catDict.get("Names");
    if (obj instanceof Dict && obj.has("EmbeddedFiles")) {
      const nameTree = new NameTree(obj.getRaw("EmbeddedFiles"), this.xref);
      for (const [key, value] of nameTree.getAll()) {
        if (stringToPDFString(key, true) === id) {
          return FileSpec.readContent(value);
        }
      }
    }
    return undefined;
  }
  attachmentContent(id) {
    const namedContent = this.#attachmentContentByName(id);
    if (namedContent !== undefined) {
      return namedContent;
    }
    const ref = this.#annotationAttachmentRefById.get(id);
    if (ref) {
      const target = this.xref.fetch(ref);
      if (target instanceof BaseStream) {
        const content = FileSpec.readStreamContent(target);
        return this.#soundAttachmentIds.has(id) ? soundStreamToWav(target, content) ?? content : content;
      }
      return target instanceof Dict ? FileSpec.readContent(target) : null;
    }
    return null;
  }
  get rawEmbeddedFiles() {
    const obj = this.#catDict.get("Names");
    if (!(obj instanceof Dict) || !obj.has("EmbeddedFiles")) {
      return null;
    }
    const nameTree = new NameTree(obj.getRaw("EmbeddedFiles"), this.xref);
    return nameTree.getAll(true);
  }
  get xfaImages() {
    const obj = this.#catDict.get("Names");
    let xfaImages = null;
    if (obj instanceof Dict && obj.has("XFAImages")) {
      const nameTree = new NameTree(obj.getRaw("XFAImages"), this.xref);
      for (const [key, value] of nameTree.getAll()) {
        if (value instanceof BaseStream) {
          xfaImages ??= new Map();
          xfaImages.set(stringToPDFString(key, true), value.getBytes());
        }
      }
    }
    return shadow(this, "xfaImages", xfaImages);
  }
  #collectJavaScript() {
    const obj = this.#catDict.get("Names");
    let javaScript = null;
    function appendIfJavaScriptDict(name, jsDict) {
      if (!(jsDict instanceof Dict) || !isName(jsDict.get("S"), "JavaScript")) {
        return;
      }
      let js = jsDict.get("JS");
      if (js instanceof BaseStream) {
        js = js.getString();
      } else if (typeof js !== "string") {
        return;
      }
      js = stringToPDFString(js, true).replaceAll("\x00", "");
      if (js) {
        (javaScript ??= new Map()).set(name, js);
      }
    }
    if (obj instanceof Dict && obj.has("JavaScript")) {
      const nameTree = new NameTree(obj.getRaw("JavaScript"), this.xref);
      for (const [key, value] of nameTree.getAll()) {
        appendIfJavaScriptDict(stringToPDFString(key, true), value);
      }
    }
    const openAction = this.#catDict.get("OpenAction");
    if (openAction) {
      appendIfJavaScriptDict("OpenAction", openAction);
    }
    return javaScript;
  }
  get jsActions() {
    const javaScript = this.#collectJavaScript();
    let actions = collectActions(this.xref, this.#catDict, DocumentActionEventType);
    if (javaScript) {
      actions ??= new Map();
      for (const [key, val] of javaScript) {
        actions.getOrInsertComputed(key, makeArr).push(val);
      }
    }
    return shadow(this, "jsActions", actions);
  }
  async cleanup(manuallyTriggered = false) {
    clearGlobalCaches();
    this.globalColorSpaceCache.clear();
    this.globalImageCache.clear(manuallyTriggered);
    this.pageKidsCountCache.clear();
    this.pageIndexCache.clear();
    this.pageDictCache.clear();
    this.nonBlendModesSet.clear();
    for (const {
      dict
    } of await Promise.all(this.fontCache)) {
      delete dict.cacheKey;
    }
    this.fontCache.clear();
    this.builtInCMapCache.clear();
    this.standardFontDataCache.clear();
    this.systemFontCache.clear();
  }
  async getPageDict(pageIndex) {
    const nodesToVisit = [this.toplevelPagesDict];
    const visitedNodes = new RefSet();
    const pagesRef = this.#catDict.getRaw("Pages");
    if (pagesRef instanceof Ref) {
      visitedNodes.put(pagesRef);
    }
    const xref = this.xref,
      pageKidsCountCache = this.pageKidsCountCache,
      pageIndexCache = this.pageIndexCache,
      pageDictCache = this.pageDictCache;
    let currentPageIndex = 0;
    while (nodesToVisit.length) {
      const currentNode = nodesToVisit.pop();
      if (currentNode instanceof Ref) {
        const count = pageKidsCountCache.get(currentNode);
        if (count >= 0 && currentPageIndex + count <= pageIndex) {
          currentPageIndex += count;
          continue;
        }
        if (visitedNodes.has(currentNode)) {
          throw new FormatError("Pages tree contains circular reference.");
        }
        visitedNodes.put(currentNode);
        const obj = await (pageDictCache.get(currentNode) || xref.fetchAsync(currentNode));
        if (obj instanceof Dict) {
          let type = obj.getRaw("Type");
          if (type instanceof Ref) {
            type = await xref.fetchAsync(type);
          }
          if (isName(type, "Page") || !obj.has("Kids")) {
            if (!pageKidsCountCache.has(currentNode)) {
              pageKidsCountCache.put(currentNode, 1);
            }
            if (!pageIndexCache.has(currentNode)) {
              pageIndexCache.put(currentNode, currentPageIndex);
            }
            if (currentPageIndex === pageIndex) {
              return [obj, currentNode];
            }
            currentPageIndex++;
            continue;
          }
        }
        nodesToVisit.push(obj);
        continue;
      }
      if (!(currentNode instanceof Dict)) {
        throw new FormatError("Page dictionary kid reference points to wrong type of object.");
      }
      const {
        objId
      } = currentNode;
      let count = currentNode.getRaw("Count");
      if (count instanceof Ref) {
        count = await xref.fetchAsync(count);
      }
      if (Number.isInteger(count) && count >= 0) {
        if (objId && !pageKidsCountCache.has(objId)) {
          pageKidsCountCache.put(objId, count);
        }
        if (currentPageIndex + count <= pageIndex) {
          currentPageIndex += count;
          continue;
        }
      }
      let kids = currentNode.getRaw("Kids");
      if (kids instanceof Ref) {
        kids = await xref.fetchAsync(kids);
      }
      if (!Array.isArray(kids)) {
        let type = currentNode.getRaw("Type");
        if (type instanceof Ref) {
          type = await xref.fetchAsync(type);
        }
        if (isName(type, "Page") || !currentNode.has("Kids")) {
          if (currentPageIndex === pageIndex) {
            return [currentNode, null];
          }
          currentPageIndex++;
          continue;
        }
        throw new FormatError("Page dictionary kids object is not an array.");
      }
      for (let last = kids.length - 1; last >= 0; last--) {
        const lastKid = kids[last];
        nodesToVisit.push(lastKid);
        if (currentNode === this.toplevelPagesDict && lastKid instanceof Ref && !pageDictCache.has(lastKid)) {
          pageDictCache.put(lastKid, xref.fetchAsync(lastKid));
        }
      }
    }
    throw new Error(`Page index ${pageIndex} not found.`);
  }
  async getAllPageDicts(recoveryMode = false) {
    const {
      ignoreErrors
    } = this.pdfManager.evaluatorOptions;
    const queue = [{
      currentNode: this.toplevelPagesDict,
      posInKids: 0
    }];
    const visitedNodes = new RefSet();
    const pagesRef = this.#catDict.getRaw("Pages");
    if (pagesRef instanceof Ref) {
      visitedNodes.put(pagesRef);
    }
    const map = new Map(),
      xref = this.xref,
      pageIndexCache = this.pageIndexCache;
    let pageIndex = 0;
    function addPageDict(pageDict, pageRef) {
      if (pageRef && !pageIndexCache.has(pageRef)) {
        pageIndexCache.put(pageRef, pageIndex);
      }
      map.set(pageIndex++, [pageDict, pageRef]);
    }
    function addPageError(error) {
      if (error instanceof XRefEntryException && !recoveryMode) {
        throw error;
      }
      if (recoveryMode && ignoreErrors && pageIndex === 0) {
        warn(`getAllPageDicts - Skipping invalid first page: "${error}".`);
        error = Dict.empty;
      }
      map.set(pageIndex++, [error, null]);
    }
    while (queue.length > 0) {
      const queueItem = queue.at(-1);
      const {
        currentNode,
        posInKids
      } = queueItem;
      let kids = currentNode.getRaw("Kids");
      if (kids instanceof Ref) {
        try {
          kids = await xref.fetchAsync(kids);
        } catch (ex) {
          addPageError(ex);
          break;
        }
      }
      if (!Array.isArray(kids)) {
        let type = currentNode.getRaw("Type");
        if (type instanceof Ref) {
          try {
            type = await xref.fetchAsync(type);
          } catch (ex) {
            addPageError(ex);
            break;
          }
        }
        if (isName(type, "Page") || !currentNode.has("Kids")) {
          addPageDict(currentNode, null);
          break;
        }
        addPageError(new FormatError("Page dictionary kids object is not an array."));
        break;
      }
      if (posInKids >= kids.length) {
        queue.pop();
        continue;
      }
      const kidObj = kids[posInKids];
      let obj;
      if (kidObj instanceof Ref) {
        if (visitedNodes.has(kidObj)) {
          addPageError(new FormatError("Pages tree contains circular reference."));
          break;
        }
        visitedNodes.put(kidObj);
        try {
          obj = await xref.fetchAsync(kidObj);
        } catch (ex) {
          addPageError(ex);
          queueItem.posInKids++;
          continue;
        }
      } else {
        obj = kidObj;
      }
      if (!(obj instanceof Dict)) {
        addPageError(new FormatError("Page dictionary kid reference points to wrong type of object."));
        break;
      }
      let type = obj.getRaw("Type");
      if (type instanceof Ref) {
        try {
          type = await xref.fetchAsync(type);
        } catch (ex) {
          addPageError(ex);
          break;
        }
      }
      if (isName(type, "Page") || !obj.has("Kids")) {
        addPageDict(obj, kidObj instanceof Ref ? kidObj : null);
      } else {
        queue.push({
          currentNode: obj,
          posInKids: 0
        });
      }
      queueItem.posInKids++;
    }
    return map;
  }
  async getPageIndex(pageRef) {
    const cachedPageIndex = this.pageIndexCache.get(pageRef);
    if (cachedPageIndex !== undefined) {
      return cachedPageIndex;
    }
    const xref = this.xref;
    let total = 0,
      ref = pageRef;
    const visited = new RefSet();
    visited.put(pageRef);
    while (true) {
      const node = await xref.fetchAsync(ref);
      if (isRefsEqual(ref, pageRef) && !isDict(node, "Page") && !(node instanceof Dict && !node.has("Type") && node.has("Contents"))) {
        throw new FormatError("The reference does not point to a /Page dictionary.");
      }
      if (!node) {
        break;
      }
      if (!(node instanceof Dict)) {
        throw new FormatError("Node must be a dictionary.");
      }
      const parentRef = node.getRaw("Parent");
      if (parentRef instanceof Ref) {
        if (visited.has(parentRef)) {
          throw new FormatError("Pages tree contains circular reference.");
        }
        visited.put(parentRef);
      }
      const parent = await node.getAsync("Parent");
      if (!parent) {
        break;
      }
      if (!(parent instanceof Dict)) {
        throw new FormatError("Parent must be a dictionary.");
      }
      const kids = await parent.getAsync("Kids");
      if (!kids) {
        break;
      }
      if (!Array.isArray(kids)) {
        throw new FormatError("Kids must be an array.");
      }
      const kidPromises = [];
      let found = false;
      for (const kid of kids) {
        if (!(kid instanceof Ref)) {
          throw new FormatError("Kid must be a reference.");
        }
        if (isRefsEqual(kid, ref)) {
          found = true;
          break;
        }
        kidPromises.push(xref.fetchAsync(kid).then(obj => {
          if (!(obj instanceof Dict)) {
            throw new FormatError("Kid node must be a dictionary.");
          }
          if (obj.has("Count")) {
            const count = obj.get("Count");
            if (Number.isInteger(count) && count >= 0) {
              total += count;
              return;
            }
            throw new FormatError("Count must be a (positive) integer.");
          }
          total++;
        }));
      }
      if (!found) {
        throw new FormatError("Kid reference not found in parent's kids.");
      }
      await Promise.all(kidPromises);
      ref = parentRef;
    }
    this.pageIndexCache.put(pageRef, total);
    return total;
  }
  get baseUrl() {
    const uri = this.#catDict.get("URI");
    if (uri instanceof Dict) {
      const base = uri.get("Base");
      if (typeof base === "string") {
        const absoluteUrl = createValidAbsoluteUrl(base, null, {
          tryConvertEncoding: true
        });
        if (absoluteUrl) {
          return shadow(this, "baseUrl", absoluteUrl.href);
        }
      }
    }
    return shadow(this, "baseUrl", this.pdfManager.docBaseUrl);
  }
  static #getDestFromStructElement(xref, seRef) {
    const seDict = xref.fetchIfRef(seRef);
    if (!(seDict instanceof Dict)) {
      return null;
    }
    let pageRef = null;
    const directPg = seDict.getRaw("Pg");
    if (directPg instanceof Ref) {
      pageRef = directPg;
    }
    if (!pageRef) {
      const queue = [seDict];
      const visited = new RefSet();
      visited.put(seRef);
      while (queue.length > 0 && !pageRef) {
        const node = queue.shift();
        let kids = node.getRaw("K");
        if (kids instanceof Ref) {
          if (visited.has(kids)) {
            continue;
          }
          visited.put(kids);
          kids = xref.fetch(kids);
        }
        let kidsArr;
        if (Array.isArray(kids)) {
          kidsArr = kids;
        } else if (kids) {
          kidsArr = [kids];
        } else {
          continue;
        }
        for (const kid of kidsArr) {
          if (kid instanceof Ref) {
            if (visited.has(kid)) {
              continue;
            }
            visited.put(kid);
          }
          const kidObj = xref.fetchIfRef(kid);
          if (!(kidObj instanceof Dict)) {
            continue;
          }
          const pg = kidObj.getRaw("Pg");
          if (pg instanceof Ref) {
            pageRef = pg;
            break;
          }
          queue.push(kidObj);
        }
      }
    }
    if (!pageRef) {
      const MAX_DEPTH = 40;
      let current = seDict;
      for (let depth = 0; depth < MAX_DEPTH; depth++) {
        const parentRaw = current.getRaw("P");
        if (!(parentRaw instanceof Ref)) {
          break;
        }
        const parentDict = xref.fetch(parentRaw);
        if (!(parentDict instanceof Dict) || isName(parentDict.get("Type"), "StructTreeRoot")) {
          break;
        }
        const pg = parentDict.getRaw("Pg");
        if (pg instanceof Ref) {
          pageRef = pg;
          break;
        }
        current = parentDict;
      }
    }
    if (!pageRef) {
      return null;
    }
    let x = null,
      y = null;
    const attrs = seDict.get("A");
    if (attrs instanceof Dict) {
      const bbox = lookupRect(attrs.getArray("BBox"), null);
      if (bbox) {
        x = bbox[0];
        y = bbox[3];
      }
    }
    return [pageRef, {
      name: "XYZ"
    }, x, y, null];
  }
  static parseDestDictionary({
    destDict,
    resultObj,
    docBaseUrl = null,
    docAttachments = null
  }) {
    if (!(destDict instanceof Dict)) {
      warn("parseDestDictionary: `destDict` must be a dictionary.");
      return;
    }
    let action = destDict.get("A"),
      url,
      dest;
    if (!(action instanceof Dict)) {
      if (destDict.has("Dest")) {
        action = destDict.get("Dest");
      } else {
        action = destDict.get("AA");
        if (action instanceof Dict) {
          if (action.has("D")) {
            action = action.get("D");
          } else if (action.has("U")) {
            action = action.get("U");
          }
        }
      }
    }
    if (action instanceof Dict) {
      const actionType = action.get("S");
      if (!(actionType instanceof Name)) {
        warn("parseDestDictionary: Invalid type in Action dictionary.");
        return;
      }
      const actionName = actionType.name;
      switch (actionName) {
        case "ResetForm":
          const flags = action.get("Flags");
          const include = ((typeof flags === "number" ? flags : 0) & 1) === 0;
          const fields = [];
          const refs = [];
          for (const obj of action.get("Fields") || []) {
            if (obj instanceof Ref) {
              refs.push(obj.toString());
            } else if (typeof obj === "string") {
              fields.push(stringToPDFString(obj));
            }
          }
          resultObj.resetForm = {
            fields,
            refs,
            include
          };
          break;
        case "URI":
          url = action.get("URI");
          if (url instanceof Name) {
            url = "/" + url.name;
          }
          break;
        case "GoTo":
          dest = action.get("D");
          break;
        case "Launch":
        case "GoToR":
          const urlDict = action.get("F");
          if (urlDict instanceof Dict) {
            url = new FileSpec(urlDict).filename;
          } else if (typeof urlDict === "string") {
            url = urlDict;
          } else {
            break;
          }
          const remoteDest = fetchRemoteDest(action);
          if (remoteDest) {
            url = url.split("#", 1)[0] + "#" + remoteDest;
          }
          const newWindow = action.get("NewWindow");
          if (typeof newWindow === "boolean") {
            resultObj.newWindow = newWindow;
          }
          break;
        case "GoToE":
          const target = action.get("T");
          let id = null;
          if (target instanceof Dict) {
            const relationship = target.get("R");
            const name = target.get("N");
            if (isName(relationship, "C") && typeof name === "string") {
              id = stringToPDFString(name, true);
            }
          }
          if (docAttachments && id) {
            resultObj.attachmentId = id;
            resultObj.attachment = docAttachments.get(id);
            const attachmentDest = fetchRemoteDest(action);
            if (attachmentDest) {
              resultObj.attachmentDest = attachmentDest;
            }
          } else {
            warn(`parseDestDictionary - unimplemented "GoToE" action.`);
          }
          break;
        case "Named":
          const namedAction = action.get("N");
          if (namedAction instanceof Name) {
            resultObj.action = namedAction.name;
          }
          break;
        case "SetOCGState":
          const state = action.get("State");
          const preserveRB = action.get("PreserveRB");
          if (!Array.isArray(state) || state.length === 0) {
            break;
          }
          const stateArr = [];
          for (const elem of state) {
            if (elem instanceof Name) {
              switch (elem.name) {
                case "ON":
                case "OFF":
                case "Toggle":
                  stateArr.push(elem.name);
                  break;
              }
            } else if (elem instanceof Ref) {
              stateArr.push(elem.toString());
            }
          }
          if (stateArr.length !== state.length) {
            break;
          }
          resultObj.setOCGState = {
            state: stateArr,
            preserveRB: preserveRB !== false
          };
          break;
        case "JavaScript":
          const jsAction = action.get("JS");
          let js;
          if (jsAction instanceof BaseStream) {
            js = jsAction.getString();
          } else if (typeof jsAction === "string") {
            js = jsAction;
          }
          const jsURL = js && recoverJsURL(stringToPDFString(js, true));
          if (jsURL) {
            url = jsURL.url;
            resultObj.newWindow = jsURL.newWindow;
            break;
          }
        default:
          if (actionName === "JavaScript" || actionName === "SubmitForm") {
            break;
          }
          warn(`parseDestDictionary - unsupported action: "${actionName}".`);
          break;
      }
    } else if (destDict.has("Dest")) {
      dest = destDict.get("Dest");
    }
    if (typeof url === "string") {
      const absoluteUrl = createValidAbsoluteUrl(url, docBaseUrl, {
        addDefaultProtocol: true,
        tryConvertEncoding: true
      });
      if (absoluteUrl) {
        resultObj.url = absoluteUrl.href;
      }
      resultObj.unsafeUrl = url;
    }
    if (dest) {
      if (dest instanceof Name) {
        dest = dest.name;
      }
      if (typeof dest === "string") {
        resultObj.dest = stringToPDFString(dest, true);
      } else if (isValidExplicitDest(dest)) {
        resultObj.dest = dest;
      }
    }
    if (!resultObj.dest && !resultObj.url && !resultObj.action && !resultObj.attachment && !resultObj.setOCGState && !resultObj.resetForm) {
      const seRef = destDict.getRaw("SE");
      if (seRef instanceof Ref) {
        try {
          const seDest = Catalog.#getDestFromStructElement(destDict.xref, seRef);
          if (seDest) {
            resultObj.dest = seDest;
          }
        } catch (ex) {
          if (ex instanceof MissingDataException) {
            throw ex;
          }
          info("SE parsing failed.");
        }
      }
    }
  }
}
export { Catalog };