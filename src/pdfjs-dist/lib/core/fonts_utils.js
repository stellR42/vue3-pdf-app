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
import { DrawOPS, info, OPS } from "../shared/util.js";
import { getEncoding, StandardEncoding } from "./encodings.js";
import { getGlyphsUnicode } from "./glyphlist.js";
import { getLookupTableFactory } from "./core_utils.js";
import { getUnicodeForGlyph } from "./unicode.js";
const SEAC_ANALYSIS_ENABLED = true;
const FontFlags = {
  FixedPitch: 1,
  Serif: 2,
  Symbolic: 4,
  Script: 8,
  Nonsymbolic: 32,
  Italic: 64,
  AllCap: 65536,
  SmallCap: 131072,
  ForceBold: 262144
};
const MacStandardGlyphOrdering = [".notdef", ".null", "nonmarkingreturn", "space", "exclam", "quotedbl", "numbersign", "dollar", "percent", "ampersand", "quotesingle", "parenleft", "parenright", "asterisk", "plus", "comma", "hyphen", "period", "slash", "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "colon", "semicolon", "less", "equal", "greater", "question", "at", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "bracketleft", "backslash", "bracketright", "asciicircum", "underscore", "grave", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "braceleft", "bar", "braceright", "asciitilde", "Adieresis", "Aring", "Ccedilla", "Eacute", "Ntilde", "Odieresis", "Udieresis", "aacute", "agrave", "acircumflex", "adieresis", "atilde", "aring", "ccedilla", "eacute", "egrave", "ecircumflex", "edieresis", "iacute", "igrave", "icircumflex", "idieresis", "ntilde", "oacute", "ograve", "ocircumflex", "odieresis", "otilde", "uacute", "ugrave", "ucircumflex", "udieresis", "dagger", "degree", "cent", "sterling", "section", "bullet", "paragraph", "germandbls", "registered", "copyright", "trademark", "acute", "dieresis", "notequal", "AE", "Oslash", "infinity", "plusminus", "lessequal", "greaterequal", "yen", "mu", "partialdiff", "summation", "product", "pi", "integral", "ordfeminine", "ordmasculine", "Omega", "ae", "oslash", "questiondown", "exclamdown", "logicalnot", "radical", "florin", "approxequal", "Delta", "guillemotleft", "guillemotright", "ellipsis", "nonbreakingspace", "Agrave", "Atilde", "Otilde", "OE", "oe", "endash", "emdash", "quotedblleft", "quotedblright", "quoteleft", "quoteright", "divide", "lozenge", "ydieresis", "Ydieresis", "fraction", "currency", "guilsinglleft", "guilsinglright", "fi", "fl", "daggerdbl", "periodcentered", "quotesinglbase", "quotedblbase", "perthousand", "Acircumflex", "Ecircumflex", "Aacute", "Edieresis", "Egrave", "Iacute", "Icircumflex", "Idieresis", "Igrave", "Oacute", "Ocircumflex", "apple", "Ograve", "Uacute", "Ucircumflex", "Ugrave", "dotlessi", "circumflex", "tilde", "macron", "breve", "dotaccent", "ring", "cedilla", "hungarumlaut", "ogonek", "caron", "Lslash", "lslash", "Scaron", "scaron", "Zcaron", "zcaron", "brokenbar", "Eth", "eth", "Yacute", "yacute", "Thorn", "thorn", "minus", "multiply", "onesuperior", "twosuperior", "threesuperior", "onehalf", "onequarter", "threequarters", "franc", "Gbreve", "gbreve", "Idotaccent", "Scedilla", "scedilla", "Cacute", "cacute", "Ccaron", "ccaron", "dcroat"];
function recoverGlyphName(name, glyphsUnicodeMap) {
  if (glyphsUnicodeMap[name] !== undefined) {
    return name;
  }
  const unicode = getUnicodeForGlyph(name, glyphsUnicodeMap);
  if (unicode !== -1) {
    for (const key in glyphsUnicodeMap) {
      if (glyphsUnicodeMap[key] === unicode) {
        return key;
      }
    }
  }
  info("Unable to recover a standard glyph name for: " + name);
  return name;
}
function buildMapping(baseEncoding, glyphNames) {
  const map = new Map();
  const {
    length
  } = baseEncoding;
  for (let charCode = 0; charCode < length; charCode++) {
    const glyphId = glyphNames.indexOf(baseEncoding[charCode]);
    map.set(charCode, glyphId >= 0 ? glyphId : 0);
  }
  return map;
}
function type1FontGlyphMapping(properties, builtInEncoding, glyphNames) {
  let charCodeToGlyphId, glyphsUnicodeMap;
  if (properties.isInternalFont) {
    charCodeToGlyphId = buildMapping(builtInEncoding, glyphNames);
  } else if (properties.baseEncodingName) {
    charCodeToGlyphId = buildMapping(getEncoding(properties.baseEncodingName), glyphNames);
  } else if (properties.flags & FontFlags.Symbolic) {
    charCodeToGlyphId = new Map();
    for (const charCode in builtInEncoding) {
      charCodeToGlyphId.set(+charCode, builtInEncoding[charCode]);
    }
  } else {
    charCodeToGlyphId = buildMapping(StandardEncoding, glyphNames);
  }
  if (properties.differences) {
    for (const [charCode, glyphName] of properties.differences) {
      let glyphId = glyphNames.indexOf(glyphName);
      if (glyphId === -1) {
        glyphsUnicodeMap ??= getGlyphsUnicode();
        const standardGlyphName = recoverGlyphName(glyphName, glyphsUnicodeMap);
        if (standardGlyphName !== glyphName) {
          glyphId = glyphNames.indexOf(standardGlyphName);
        }
      }
      charCodeToGlyphId.set(charCode, glyphId >= 0 ? glyphId : 0);
    }
  }
  return charCodeToGlyphId;
}
function normalizeFontName(name) {
  return name.replaceAll(/[,_]/g, "-").replaceAll(/\s/g, "");
}
const getVerticalPresentationForm = getLookupTableFactory(t => {
  t[0x2013] = 0xfe32;
  t[0x2014] = 0xfe31;
  t[0x2025] = 0xfe30;
  t[0x2026] = 0xfe19;
  t[0x3001] = 0xfe11;
  t[0x3002] = 0xfe12;
  t[0x3008] = 0xfe3f;
  t[0x3009] = 0xfe40;
  t[0x300a] = 0xfe3d;
  t[0x300b] = 0xfe3e;
  t[0x300c] = 0xfe41;
  t[0x300d] = 0xfe42;
  t[0x300e] = 0xfe43;
  t[0x300f] = 0xfe44;
  t[0x3010] = 0xfe3b;
  t[0x3011] = 0xfe3c;
  t[0x3014] = 0xfe39;
  t[0x3015] = 0xfe3a;
  t[0x3016] = 0xfe17;
  t[0x3017] = 0xfe18;
  t[0xfe4f] = 0xfe34;
  t[0xff01] = 0xfe15;
  t[0xff08] = 0xfe35;
  t[0xff09] = 0xfe36;
  t[0xff0c] = 0xfe10;
  t[0xff1a] = 0xfe13;
  t[0xff1b] = 0xfe14;
  t[0xff1f] = 0xfe16;
  t[0xff3b] = 0xfe47;
  t[0xff3d] = 0xfe48;
  t[0xff3f] = 0xfe33;
  t[0xff5b] = 0xfe37;
  t[0xff5d] = 0xfe38;
});
const VERTICAL_ROTATED_CHARS = new Set([0x2010, 0x2015, 0x2016, 0x3018, 0x3019, 0x301c, 0x30a0, 0x30fc, 0xff1d, 0xff5c, 0xff5e, 0xff5f, 0xff60]);
const MAX_SIZE_TO_COMPILE = 1000;
function compileType3Glyph({
  data: img,
  width,
  height
}) {
  if (width > MAX_SIZE_TO_COMPILE || height > MAX_SIZE_TO_COMPILE) {
    return null;
  }
  const POINT_TO_PROCESS_LIMIT = 1000;
  const POINT_TYPES = new Uint8Array([0, 2, 4, 0, 1, 0, 5, 4, 8, 10, 0, 8, 0, 2, 1, 0]);
  const width1 = width + 1;
  const points = new Uint8Array(width1 * (height + 1));
  let i, j, j0;
  const lineSize = width + 7 & ~7;
  const data = new Uint8Array(lineSize * height);
  let pos = 0;
  for (const elem of img) {
    let mask = 128;
    while (mask > 0) {
      data[pos++] = elem & mask ? 0 : 255;
      mask >>= 1;
    }
  }
  let count = 0;
  pos = 0;
  if (data[pos] !== 0) {
    points[0] = 1;
    ++count;
  }
  for (j = 1; j < width; j++) {
    if (data[pos] !== data[pos + 1]) {
      points[j] = data[pos] ? 2 : 1;
      ++count;
    }
    pos++;
  }
  if (data[pos] !== 0) {
    points[j] = 2;
    ++count;
  }
  for (i = 1; i < height; i++) {
    pos = i * lineSize;
    j0 = i * width1;
    if (data[pos - lineSize] !== data[pos]) {
      points[j0] = data[pos] ? 1 : 8;
      ++count;
    }
    let sum = (data[pos] ? 4 : 0) + (data[pos - lineSize] ? 8 : 0);
    for (j = 1; j < width; j++) {
      sum = (sum >> 2) + (data[pos + 1] ? 4 : 0) + (data[pos - lineSize + 1] ? 8 : 0);
      if (POINT_TYPES[sum]) {
        points[j0 + j] = POINT_TYPES[sum];
        ++count;
      }
      pos++;
    }
    if (data[pos - lineSize] !== data[pos]) {
      points[j0 + j] = data[pos] ? 2 : 4;
      ++count;
    }
    if (count > POINT_TO_PROCESS_LIMIT) {
      return null;
    }
  }
  pos = lineSize * (height - 1);
  j0 = i * width1;
  if (data[pos] !== 0) {
    points[j0] = 8;
    ++count;
  }
  for (j = 1; j < width; j++) {
    if (data[pos] !== data[pos + 1]) {
      points[j0 + j] = data[pos] ? 4 : 8;
      ++count;
    }
    pos++;
  }
  if (data[pos] !== 0) {
    points[j0 + j] = 4;
    ++count;
  }
  if (count > POINT_TO_PROCESS_LIMIT) {
    return null;
  }
  const steps = new Int32Array([0, width1, -1, 0, -width1, 0, 0, 0, 1]);
  const pathBuf = [];
  const {
    a,
    b,
    c,
    d,
    e,
    f
  } = new DOMMatrix().scaleSelf(1 / width, -1 / height).translateSelf(0, -height);
  for (i = 0; count && i <= height; i++) {
    let p = i * width1;
    const end = p + width;
    while (p < end && !points[p]) {
      p++;
    }
    if (p === end) {
      continue;
    }
    let x = p % width1;
    let y = i;
    pathBuf.push(DrawOPS.moveTo, a * x + c * y + e, b * x + d * y + f);
    const p0 = p;
    let type = points[p];
    do {
      const step = steps[type];
      do {
        p += step;
      } while (!points[p]);
      const pp = points[p];
      if (pp !== 5 && pp !== 10) {
        type = pp;
        points[p] = 0;
      } else {
        type = pp & 0x33 * type >> 4;
        points[p] &= type >> 2 | type << 2;
      }
      x = p % width1;
      y = p / width1 | 0;
      pathBuf.push(DrawOPS.lineTo, a * x + c * y + e, b * x + d * y + f);
      if (!points[p]) {
        --count;
      }
    } while (p0 !== p);
    --i;
  }
  return [OPS.rawFillPath, [new Float32Array(pathBuf)], new Float32Array([0, 0, width, height])];
}
export { compileType3Glyph, FontFlags, getVerticalPresentationForm, MacStandardGlyphOrdering, normalizeFontName, recoverGlyphName, SEAC_ANALYSIS_ENABLED, type1FontGlyphMapping, VERTICAL_ROTATED_CHARS };