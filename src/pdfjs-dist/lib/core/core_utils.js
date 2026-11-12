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
import { AnnotationEditorPrefix, assert, BaseException, makeArr, Util, warn } from "../shared/util.js";
import { Dict, isName, isRefsEqual, Name, Ref, RefSet } from "./primitives.js";
import { BaseStream } from "./base_stream.js";
import { CONTROL_CHAR_REGEXP } from "../shared/css_utils.js";
import { stringToPDFString } from "./string_utils.js";
const PDF_VERSION_REGEXP = /^[1-9]\.\d$/;
const MAX_INT_32 = 2 ** 31 - 1;
const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];
const RESOURCES_KEYS_OPERATOR_LIST = ["ColorSpace", "ExtGState", "Font", "Pattern", "Properties", "Shading", "XObject"];
const RESOURCES_KEYS_TEXT_CONTENT = ["ExtGState", "Font", "Properties", "XObject"];
function getLookupTableFactory(initializer, useArray = false) {
  let lookup;
  return function () {
    if (initializer) {
      lookup = useArray ? [] : Object.create(null);
      initializer(lookup);
      initializer = null;
    }
    return lookup;
  };
}
class MissingDataException extends BaseException {
  constructor(begin, end) {
    super(`Missing data [${begin}, ${end})`, "MissingDataException");
    this.begin = begin;
    this.end = end;
  }
}
class ParserEOFException extends BaseException {
  constructor(msg) {
    super(msg, "ParserEOFException");
  }
}
class XRefEntryException extends BaseException {
  constructor(msg) {
    super(msg, "XRefEntryException");
  }
}
class XRefParseException extends BaseException {
  constructor(msg) {
    super(msg, "XRefParseException");
  }
}
function arrayBuffersToBytes(arr) {
  const length = arr.length;
  if (length === 0) {
    return new Uint8Array(0);
  }
  if (length === 1) {
    return new Uint8Array(arr[0]);
  }
  let dataLength = 0;
  for (let i = 0; i < length; i++) {
    dataLength += arr[i].byteLength;
  }
  const data = new Uint8Array(dataLength);
  let pos = 0;
  for (let i = 0; i < length; i++) {
    const item = new Uint8Array(arr[i]);
    data.set(item, pos);
    pos += item.byteLength;
  }
  return data;
}
async function fetchBinaryData(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file "${url}" with "${response.statusText}".`);
  }
  return response.bytes();
}
function getInheritableProperty({
  dict,
  key,
  getArray = false,
  stopWhenFound = true
}) {
  let values;
  const visited = new RefSet();
  while (dict instanceof Dict && !(dict.objId && visited.has(dict.objId))) {
    if (dict.objId) {
      visited.put(dict.objId);
    }
    const value = getArray ? dict.getArray(key) : dict.get(key);
    if (value !== undefined) {
      if (stopWhenFound) {
        return value;
      }
      (values ||= []).push(value);
    }
    dict = dict.get("Parent");
  }
  return values;
}
function getParentToUpdate(dict, ref, xref) {
  const visited = new RefSet();
  const firstDict = dict;
  const result = {
    dict: null,
    ref: null
  };
  while (dict instanceof Dict && !visited.has(ref)) {
    visited.put(ref);
    if (dict.has("T")) {
      break;
    }
    ref = dict.getRaw("Parent");
    if (!(ref instanceof Ref)) {
      return result;
    }
    dict = xref.fetch(ref);
  }
  if (dict instanceof Dict && dict !== firstDict) {
    result.dict = dict;
    result.ref = ref;
  }
  return result;
}
function deepCompare(a, b) {
  if (a === b) {
    return true;
  }
  if (a instanceof Ref && b instanceof Ref) {
    return isRefsEqual(a, b);
  }
  if (a instanceof Name && b instanceof Name) {
    return a.name === b.name;
  }
  if (a instanceof Dict && b instanceof Dict) {
    if (a.size !== b.size) {
      return false;
    }
    for (const [key, value1] of a.getRawEntries()) {
      const value2 = b.getRaw(key);
      if (value2 === undefined || !deepCompare(value1, value2)) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0, ii = a.length; i < ii; i++) {
      if (!deepCompare(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  return false;
}
const ROMAN_NUMBER_MAP = ["", "C", "CC", "CCC", "CD", "D", "DC", "DCC", "DCCC", "CM", "", "X", "XX", "XXX", "XL", "L", "LX", "LXX", "LXXX", "XC", "", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
function toRomanNumerals(number, lowerCase = false) {
  assert(Number.isInteger(number) && number > 0, "The number should be a positive integer.");
  const roman = "M".repeat(number / 1000 | 0) + ROMAN_NUMBER_MAP[number % 1000 / 100 | 0] + ROMAN_NUMBER_MAP[10 + (number % 100 / 10 | 0)] + ROMAN_NUMBER_MAP[20 + number % 10];
  return lowerCase ? roman.toLowerCase() : roman;
}
function isWhiteSpace(ch) {
  return ch === 0x20 || ch === 0x09 || ch === 0x0d || ch === 0x0a;
}
function isBooleanArray(arr, len) {
  return Array.isArray(arr) && (len === null || arr.length === len) && arr.every(x => typeof x === "boolean");
}
function isNumberArray(arr, len) {
  if (Array.isArray(arr)) {
    return (len === null || arr.length === len) && arr.every(x => typeof x === "number");
  }
  return ArrayBuffer.isView(arr) && !(arr instanceof BigInt64Array || arr instanceof BigUint64Array) && (len === null || arr.length === len);
}
function lookupMatrix(arr, fallback) {
  return isNumberArray(arr, 6) ? arr : fallback;
}
function lookupRect(arr, fallback) {
  return isNumberArray(arr, 4) ? arr : fallback;
}
function lookupNormalRect(arr, fallback) {
  return isNumberArray(arr, 4) ? Util.normalizeRect(arr) : fallback;
}
function parseXFAPath(path) {
  const positionPattern = /^(.+)\[(\d+)\]$/;
  return path.split(".").map(component => {
    const m = component.match(positionPattern);
    return m ? {
      name: m[1],
      pos: parseInt(m[2], 10)
    } : {
      name: component,
      pos: 0
    };
  });
}
function escapePDFName(str) {
  const buffer = [];
  let start = 0;
  for (let i = 0, ii = str.length; i < ii; i++) {
    const char = str.charCodeAt(i);
    if (char < 0x21 || char > 0x7e || char === 0x23 || char === 0x28 || char === 0x29 || char === 0x3c || char === 0x3e || char === 0x5b || char === 0x5d || char === 0x7b || char === 0x7d || char === 0x2f || char === 0x25) {
      if (start < i) {
        buffer.push(str.substring(start, i));
      }
      buffer.push(`#${char.toString(16).padStart(2, "0")}`);
      start = i + 1;
    }
  }
  if (buffer.length === 0) {
    return str;
  }
  if (start < str.length) {
    buffer.push(str.substring(start));
  }
  return buffer.join("");
}
function escapeString(str) {
  return str.replaceAll(/([()\\\n\r])/g, match => {
    if (match === "\n") {
      return "\\n";
    } else if (match === "\r") {
      return "\\r";
    }
    return `\\${match}`;
  });
}
function _collectJS(entry, xref, list, parents) {
  if (!entry) {
    return;
  }
  let parent = null;
  if (entry instanceof Ref) {
    if (parents.has(entry)) {
      return;
    }
    parent = entry;
    parents.put(parent);
    entry = xref.fetch(entry);
  }
  if (Array.isArray(entry)) {
    for (const element of entry) {
      _collectJS(element, xref, list, parents);
    }
  } else if (entry instanceof Dict) {
    if (isName(entry.get("S"), "JavaScript")) {
      const js = entry.get("JS");
      let code;
      if (js instanceof BaseStream) {
        code = js.getString();
      } else if (typeof js === "string") {
        code = js;
      }
      code &&= stringToPDFString(code, true).replaceAll("\x00", "");
      if (code) {
        list.push(code.trim());
      }
    }
    _collectJS(entry.getRaw("Next"), xref, list, parents);
  }
  if (parent) {
    parents.remove(parent);
  }
}
function _collectAction(dict, name, xref, actions) {
  const list = [];
  _collectJS(dict, xref, list, new RefSet());
  if (list.length) {
    actions.set(name, list);
  }
}
function collectActions(xref, dict, eventType) {
  const actions = new Map();
  const additionalActionsDicts = getInheritableProperty({
    dict,
    key: "AA",
    stopWhenFound: false
  });
  if (additionalActionsDicts) {
    for (let i = additionalActionsDicts.length - 1; i >= 0; i--) {
      const additionalActions = additionalActionsDicts[i];
      if (!(additionalActions instanceof Dict)) {
        continue;
      }
      for (const [key, rawActionDict] of additionalActions.getRawEntries()) {
        const action = eventType[key];
        if (action) {
          _collectAction(rawActionDict, action, xref, actions);
        }
      }
    }
  }
  if (dict.has("A")) {
    _collectAction(dict.get("A"), "Action", xref, actions);
  }
  return actions.size ? actions : null;
}
const XMLEntities = {
  0x3c: "&lt;",
  0x3e: "&gt;",
  0x26: "&amp;",
  0x22: "&quot;",
  0x27: "&apos;"
};
function* codePointIter(str) {
  for (let i = 0, ii = str.length; i < ii; i++) {
    const char = str.codePointAt(i);
    if (char > 0xd7ff && (char < 0xe000 || char > 0xfffd)) {
      i++;
    }
    yield char;
  }
}
function encodeToXmlString(str) {
  const buffer = [];
  let start = 0;
  for (let i = 0, ii = str.length; i < ii; i++) {
    const char = str.codePointAt(i);
    if (0x20 <= char && char <= 0x7e) {
      const entity = XMLEntities[char];
      if (entity) {
        if (start < i) {
          buffer.push(str.substring(start, i));
        }
        buffer.push(entity);
        start = i + 1;
      }
    } else {
      if (start < i) {
        buffer.push(str.substring(start, i));
      }
      buffer.push(`&#x${char.toString(16).toUpperCase()};`);
      if (char > 0xffff) {
        i++;
      }
      start = i + 1;
    }
  }
  if (buffer.length === 0) {
    return str;
  }
  if (start < str.length) {
    buffer.push(str.substring(start));
  }
  return buffer.join("");
}
function validateFontName(fontFamily, mustWarn = false) {
  const m = /^("|').*("|')$/.exec(fontFamily);
  if (m && m[1] === m[2]) {
    const re = new RegExp(`[^\\\\]${m[1]}`);
    if (re.test(fontFamily.slice(1, -1))) {
      if (mustWarn) {
        warn(`FontFamily contains unescaped ${m[1]}: ${fontFamily}.`);
      }
      return false;
    }
    if (CONTROL_CHAR_REGEXP.test(fontFamily)) {
      if (mustWarn) {
        warn(`FontFamily contains control characters: ${fontFamily}.`);
      }
      return false;
    }
  } else {
    for (const ident of fontFamily.split(/[ \t]+/)) {
      if (/^(?:\d|-[\d-])/.test(ident) || !/^[\w\\-]+$/.test(ident)) {
        if (mustWarn) {
          warn(`FontFamily contains invalid <custom-ident>: ${fontFamily}.`);
        }
        return false;
      }
    }
  }
  return true;
}
function normalizeCSSFontFamily(fontFamily) {
  return fontFamily.replaceAll(/( +)(\d)?/g, (_, spaces, digit) => digit ?? " ");
}
function validateCSSFont(cssFontInfo) {
  const DEFAULT_CSS_FONT_OBLIQUE = "14";
  const DEFAULT_CSS_FONT_WEIGHT = "400";
  const CSS_FONT_WEIGHT_VALUES = new Set(["100", "200", "300", "400", "500", "600", "700", "800", "900", "1000", "normal", "bold", "bolder", "lighter"]);
  const {
    fontFamily,
    fontWeight,
    italicAngle
  } = cssFontInfo;
  if (!validateFontName(fontFamily, true)) {
    return false;
  }
  const weight = fontWeight ? fontWeight.toString() : "";
  cssFontInfo.fontWeight = CSS_FONT_WEIGHT_VALUES.has(weight) ? weight : DEFAULT_CSS_FONT_WEIGHT;
  const angle = parseFloat(italicAngle);
  cssFontInfo.italicAngle = isNaN(angle) || angle < -90 || angle > 90 ? DEFAULT_CSS_FONT_OBLIQUE : italicAngle.toString();
  return true;
}
function recoverJsURL(str) {
  const URL_OPEN_METHODS = ["app.launchURL", "window.open", "xfa.host.gotoURL"];
  const regex = new RegExp("^\\s*(" + URL_OPEN_METHODS.join("|").replaceAll(".", "\\.") + ")\\((?:'|\")([^'\"]*)(?:'|\")(?:,\\s*(\\w+)\\)|\\))", "i");
  const jsUrl = regex.exec(str);
  if (jsUrl?.[2]) {
    return {
      url: jsUrl[2],
      newWindow: jsUrl[1] === "app.launchURL" && jsUrl[3] === "true"
    };
  }
  return null;
}
function numberToString(value) {
  if (Number.isInteger(value)) {
    return value.toString();
  }
  const roundedValue = Math.round(value * 100);
  if (roundedValue % 100 === 0) {
    return (roundedValue / 100).toString();
  }
  return roundedValue % 10 === 0 ? value.toFixed(1) : value.toFixed(2);
}
function getNewAnnotationsMap(annotationStorage) {
  if (!annotationStorage) {
    return null;
  }
  const newAnnotationsByPage = new Map();
  for (const [key, value] of annotationStorage) {
    if (!key.startsWith(AnnotationEditorPrefix)) {
      continue;
    }
    newAnnotationsByPage.getOrInsertComputed(value.pageIndex, makeArr).push(value);
  }
  return newAnnotationsByPage.size > 0 ? newAnnotationsByPage : null;
}
function getModificationDate(date = new Date()) {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  const buffer = [date.getUTCFullYear().toString(), (date.getUTCMonth() + 1).toString().padStart(2, "0"), date.getUTCDate().toString().padStart(2, "0"), date.getUTCHours().toString().padStart(2, "0"), date.getUTCMinutes().toString().padStart(2, "0"), date.getUTCSeconds().toString().padStart(2, "0")];
  return buffer.join("");
}
function getRotationMatrix(rotation, width, height) {
  switch (rotation) {
    case 90:
      return [0, 1, -1, 0, width, 0];
    case 180:
      return [-1, 0, 0, -1, width, height];
    case 270:
      return [0, -1, 1, 0, 0, height];
    default:
      throw new Error("Invalid rotation");
  }
}
function getSizeInBytes(x) {
  return Math.ceil(Math.ceil(Math.log2(1 + x)) / 8);
}
export { arrayBuffersToBytes, codePointIter, collectActions, deepCompare, encodeToXmlString, escapePDFName, escapeString, fetchBinaryData, getInheritableProperty, getLookupTableFactory, getModificationDate, getNewAnnotationsMap, getParentToUpdate, getRotationMatrix, getSizeInBytes, IDENTITY_MATRIX, isBooleanArray, isNumberArray, isWhiteSpace, lookupMatrix, lookupNormalRect, lookupRect, MAX_INT_32, MissingDataException, normalizeCSSFontFamily, numberToString, ParserEOFException, parseXFAPath, PDF_VERSION_REGEXP, recoverJsURL, RESOURCES_KEYS_OPERATOR_LIST, RESOURCES_KEYS_TEXT_CONTENT, toRomanNumerals, validateCSSFont, validateFontName, XRefEntryException, XRefParseException };