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
import "core-js/modules/es.array.push.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import { bytesToString, FormatError, warn } from "../shared/util.js";
import { CFF, CFFCharset, CFFCompiler, CFFHeader, CFFIndex, CFFPrivateDict, CFFStandardStrings, CFFStrings, CFFTopDict } from "./cff_parser.js";
import { SEAC_ANALYSIS_ENABLED, type1FontGlyphMapping } from "./fonts_utils.js";
import { isWhiteSpace } from "./core_utils.js";
import { Stream } from "./stream.js";
import { Type1Parser } from "./type1_parser.js";
function findBlock(streamBytes, signature, startIndex) {
  const streamBytesLength = streamBytes.length;
  const signatureLength = signature.length;
  const scanLength = streamBytesLength - signatureLength;
  let i = startIndex,
    found = false;
  while (i < scanLength) {
    let j = 0;
    while (j < signatureLength && streamBytes[i + j] === signature[j]) {
      j++;
    }
    if (j >= signatureLength) {
      i += j;
      while (i < streamBytesLength && isWhiteSpace(streamBytes[i])) {
        i++;
      }
      found = true;
      break;
    }
    i++;
  }
  return {
    found,
    length: i
  };
}
function getHeaderBlock(stream, suggestedLength) {
  const EEXEC_SIGNATURE = [0x65, 0x65, 0x78, 0x65, 0x63];
  const streamStartPos = stream.pos;
  let headerBytes, headerBytesLength, block;
  try {
    headerBytes = stream.getBytes(suggestedLength);
    headerBytesLength = headerBytes.length;
  } catch {}
  if (headerBytesLength === suggestedLength) {
    block = findBlock(headerBytes, EEXEC_SIGNATURE, suggestedLength - 2 * EEXEC_SIGNATURE.length);
    if (block.found && block.length === suggestedLength) {
      return {
        stream: new Stream(headerBytes),
        length: suggestedLength
      };
    }
  }
  warn('Invalid "Length1" property in Type1 font -- trying to recover.');
  stream.pos = streamStartPos;
  const SCAN_BLOCK_LENGTH = 2048;
  let actualLength;
  while (true) {
    const scanBytes = stream.peekBytes(SCAN_BLOCK_LENGTH);
    block = findBlock(scanBytes, EEXEC_SIGNATURE, 0);
    if (block.length === 0) {
      break;
    }
    stream.pos += block.length;
    if (block.found) {
      actualLength = stream.pos - streamStartPos;
      break;
    }
  }
  stream.pos = streamStartPos;
  if (actualLength) {
    return {
      stream: new Stream(stream.getBytes(actualLength)),
      length: actualLength
    };
  }
  warn('Unable to recover "Length1" property in Type1 font -- using as is.');
  return {
    stream: new Stream(stream.getBytes(suggestedLength)),
    length: suggestedLength
  };
}
function getEexecBlock(stream, suggestedLength) {
  const eexecBytes = stream.getBytes();
  if (eexecBytes.length === 0) {
    throw new FormatError("getEexecBlock - no font program found.");
  }
  return {
    stream: new Stream(eexecBytes),
    length: eexecBytes.length
  };
}
function isCidKeyedType1File(file) {
  const sample = file.peekBytes(2048);
  if (sample.length < 2 || sample[0] !== 0x25 || sample[1] !== 0x21) {
    return false;
  }
  const text = bytesToString(sample);
  return text.includes("Resource-CIDFont") || /\/CIDFontType\s+0\b/.test(text);
}
class Type1Font {
  #rawFileLength;
  constructor(name, file, properties) {
    let data;
    if (properties.composite && isCidKeyedType1File(file)) {
      data = this.#parseCidKeyedType1(file, properties);
    }
    data ||= this.#parseType1(file, properties);
    for (const key in data.properties) {
      properties[key] = data.properties[key];
    }
    const charstrings = data.charstrings;
    const type2Charstrings = this.getType2Charstrings(charstrings);
    const subrs = this.getType2Subrs(data.subrs);
    this.charstrings = charstrings;
    this.data = this.wrap(name, type2Charstrings, this.charstrings, subrs, properties);
    this.seacs = this.getSeacs(data.charstrings);
  }
  #parseType1(file, properties) {
    const PFB_HEADER_SIZE = 6;
    let headerBlockLength = properties.length1;
    let eexecBlockLength = properties.length2;
    let pfbHeader = file.peekBytes(PFB_HEADER_SIZE);
    const pfbHeaderPresent = pfbHeader[0] === 0x80 && pfbHeader[1] === 0x01;
    if (pfbHeaderPresent) {
      file.skip(PFB_HEADER_SIZE);
      headerBlockLength = pfbHeader[5] << 24 | pfbHeader[4] << 16 | pfbHeader[3] << 8 | pfbHeader[2];
    }
    const headerBlock = getHeaderBlock(file, headerBlockLength);
    const headerBlockParser = new Type1Parser(headerBlock.stream, false, SEAC_ANALYSIS_ENABLED);
    headerBlockParser.extractFontHeader(properties);
    if (pfbHeaderPresent) {
      pfbHeader = file.getBytes(PFB_HEADER_SIZE);
      eexecBlockLength = pfbHeader[5] << 24 | pfbHeader[4] << 16 | pfbHeader[3] << 8 | pfbHeader[2];
    }
    const eexecBlock = getEexecBlock(file, eexecBlockLength);
    const eexecBlockParser = new Type1Parser(eexecBlock.stream, true, SEAC_ANALYSIS_ENABLED);
    const data = eexecBlockParser.extractFontProgram(properties);
    this.#rawFileLength = headerBlock.length + eexecBlock.length;
    return data;
  }
  #parseCidKeyedType1(file, properties) {
    const fileStart = file.pos;
    const length = file.end - fileStart;
    const parser = new Type1Parser(file, false, SEAC_ANALYSIS_ENABLED);
    const data = parser.extractCidKeyedFontProgram(properties);
    if (!data) {
      file.pos = fileStart;
      warn("Type1Font: unable to parse CID-keyed Type 1 font.");
      return null;
    }
    this.#rawFileLength = length;
    return data;
  }
  get numGlyphs() {
    return this.charstrings.length + 1;
  }
  getCharset() {
    const charset = [".notdef"];
    for (const {
      glyphName
    } of this.charstrings) {
      charset.push(glyphName);
    }
    return charset;
  }
  getGlyphMapping(properties) {
    const charstrings = this.charstrings;
    if (properties.composite) {
      const charCodeToGlyphId = new Map();
      for (let glyphId = 0, charstringsLen = charstrings.length; glyphId < charstringsLen; glyphId++) {
        const charCode = properties.cMap.charCodeOf(glyphId);
        charCodeToGlyphId.set(charCode, glyphId + 1);
      }
      return charCodeToGlyphId;
    }
    const glyphNames = [".notdef"];
    let builtInEncoding, glyphId;
    for (glyphId = 0; glyphId < charstrings.length; glyphId++) {
      glyphNames.push(charstrings[glyphId].glyphName);
    }
    const encoding = properties.builtInEncoding;
    if (encoding) {
      builtInEncoding = Object.create(null);
      for (const charCode in encoding) {
        glyphId = glyphNames.indexOf(encoding[charCode]);
        if (glyphId >= 0) {
          builtInEncoding[charCode] = glyphId;
        }
      }
    }
    return type1FontGlyphMapping(properties, builtInEncoding, glyphNames);
  }
  hasGlyphId(id) {
    if (id < 0 || id >= this.numGlyphs) {
      return false;
    }
    if (id === 0) {
      return true;
    }
    const glyph = this.charstrings[id - 1];
    return glyph.charstring.length > 0;
  }
  getSeacs(charstrings) {
    const seacs = new Map();
    for (let i = 0, ii = charstrings.length; i < ii; i++) {
      const {
        seac
      } = charstrings[i];
      if (seac) {
        seacs.set(i + 1, seac);
      }
    }
    return seacs;
  }
  getType2Charstrings(type1Charstrings) {
    const type2Charstrings = [];
    for (const type1Charstring of type1Charstrings) {
      type2Charstrings.push(type1Charstring.charstring);
    }
    return type2Charstrings;
  }
  getType2Subrs(type1Subrs) {
    let bias = 0;
    const count = type1Subrs.length;
    if (count < 1133) {
      bias = 107;
    } else if (count < 33769) {
      bias = 1131;
    } else {
      bias = 32768;
    }
    const type2Subrs = [];
    let i;
    for (i = 0; i < bias; i++) {
      type2Subrs.push([0x0b]);
    }
    for (i = 0; i < count; i++) {
      type2Subrs.push(type1Subrs[i]);
    }
    return type2Subrs;
  }
  wrap(name, glyphs, charstrings, subrs, properties) {
    const cff = new CFF(this.#rawFileLength);
    cff.header = new CFFHeader(1, 0, 4, 4);
    cff.names = [name];
    const topDict = new CFFTopDict();
    topDict.setByName("version", 391);
    topDict.setByName("Notice", 392);
    topDict.setByName("FullName", 393);
    topDict.setByName("FamilyName", 394);
    topDict.setByName("Weight", 395);
    topDict.setByName("Encoding", null);
    topDict.setByName("FontMatrix", properties.fontMatrix);
    topDict.setByName("FontBBox", properties.bbox);
    topDict.setByName("charset", null);
    topDict.setByName("CharStrings", null);
    topDict.setByName("Private", null);
    cff.topDict = topDict;
    const strings = new CFFStrings();
    strings.add("Version 0.11");
    strings.add("See original notice");
    strings.add(name);
    strings.add(name);
    strings.add("Medium");
    cff.strings = strings;
    cff.globalSubrIndex = new CFFIndex();
    const count = glyphs.length;
    const charsetArray = [".notdef"];
    for (let i = 0; i < count; i++) {
      const {
        glyphName
      } = charstrings[i];
      const index = CFFStandardStrings.indexOf(glyphName);
      if (index === -1) {
        strings.add(glyphName);
      }
      charsetArray.push(glyphName);
    }
    cff.charset = new CFFCharset(false, 0, charsetArray);
    const charStringsIndex = new CFFIndex();
    charStringsIndex.add([0x8b, 0x0e]);
    for (let i = 0; i < count; i++) {
      charStringsIndex.add(glyphs[i]);
    }
    cff.charStrings = charStringsIndex;
    const privateDict = new CFFPrivateDict();
    privateDict.setByName("Subrs", null);
    const fields = ["BlueValues", "OtherBlues", "FamilyBlues", "FamilyOtherBlues", "StemSnapH", "StemSnapV", "BlueShift", "BlueFuzz", "BlueScale", "LanguageGroup", "ExpansionFactor", "ForceBold", "StdHW", "StdVW"];
    for (const field of fields) {
      if (!properties.privateData.has(field)) {
        continue;
      }
      const value = properties.privateData.get(field);
      if (Array.isArray(value)) {
        for (let j = value.length - 1; j > 0; j--) {
          value[j] -= value[j - 1];
        }
      }
      privateDict.setByName(field, value);
    }
    cff.topDict.privateDict = privateDict;
    const subrIndex = new CFFIndex();
    for (const subr of subrs) {
      subrIndex.add(subr);
    }
    privateDict.subrsIndex = subrIndex;
    const compiler = new CFFCompiler(cff);
    return compiler.compile();
  }
}
export { Type1Font };