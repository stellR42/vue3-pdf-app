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
import { assert, bytesToString, FormatError, info, InvalidPDFException, warn } from "../shared/util.js";
import { CIRCULAR_REF, Cmd, Dict, isCmd, Ref, RefSet } from "./primitives.js";
import { Lexer, Parser } from "./parser.js";
import { MissingDataException, ParserEOFException, XRefEntryException, XRefParseException } from "./core_utils.js";
import { BaseStream } from "./base_stream.js";
import { CipherTransformFactory } from "./crypto.js";
class XRef {
  #cacheMap = new Map();
  #entries = [];
  #newPersistentRefNum = null;
  #newTemporaryRefNum = null;
  #parsedWithRecovery = false;
  #pendingRefs = new RefSet();
  #persistentRefsCache = null;
  #xrefSectionOffsets = new Set();
  #xrefSectionsComplete = true;
  #xrefStms = new Set();
  constructor(stream, pdfManager) {
    this.stream = stream;
    this.pdfManager = pdfManager;
  }
  getNewPersistentRef(obj) {
    if (this.#newPersistentRefNum === null) {
      this.#newPersistentRefNum = this.#entries.length || 1;
    }
    const num = this.#newPersistentRefNum++;
    this.#cacheMap.set(num, obj);
    return Ref.get(num, 0);
  }
  getNewTemporaryRef() {
    if (this.#newTemporaryRefNum === null) {
      this.#newTemporaryRefNum = this.#entries.length || 1;
      if (this.#newPersistentRefNum) {
        this.#persistentRefsCache = new Map();
        for (let i = this.#newTemporaryRefNum; i < this.#newPersistentRefNum; i++) {
          this.#persistentRefsCache.set(i, this.#cacheMap.get(i));
          this.#cacheMap.delete(i);
        }
      }
    }
    return Ref.get(this.#newTemporaryRefNum++, 0);
  }
  resetNewTemporaryRef() {
    this.#newTemporaryRefNum = null;
    if (this.#persistentRefsCache) {
      for (const [num, obj] of this.#persistentRefsCache) {
        this.#cacheMap.set(num, obj);
      }
    }
    this.#persistentRefsCache = null;
  }
  setStartXRef(startXRef) {
    this.startXRefQueue = [startXRef];
  }
  parse(recoveryMode = false) {
    this.#parsedWithRecovery = recoveryMode;
    let trailerDict;
    if (!recoveryMode) {
      trailerDict = this.readXRef();
    } else {
      warn("Indexing all PDF objects");
      trailerDict = this.indexObjects();
    }
    trailerDict.assignXref(this);
    this.trailer = trailerDict;
    let encrypt;
    try {
      encrypt = trailerDict.get("Encrypt");
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn(`XRef.parse - Invalid "Encrypt" reference: "${ex}".`);
    }
    if (encrypt instanceof Dict) {
      const ids = trailerDict.get("ID");
      const fileId = ids?.length ? ids[0] : "";
      encrypt.suppressEncryption = true;
      this.encrypt = new CipherTransformFactory(encrypt, fileId, this.pdfManager.password);
    }
    let root;
    try {
      root = trailerDict.get("Root");
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn(`XRef.parse - Invalid "Root" reference: "${ex}".`);
    }
    if (root instanceof Dict) {
      try {
        const pages = root.get("Pages");
        if (pages instanceof Dict) {
          this.root = root;
          return;
        }
      } catch (ex) {
        if (ex instanceof MissingDataException) {
          throw ex;
        }
        warn(`XRef.parse - Invalid "Pages" reference: "${ex}".`);
      }
    }
    if (!recoveryMode) {
      throw new XRefParseException();
    }
    throw new InvalidPDFException("Invalid Root reference.");
  }
  processXRefTable(parser) {
    this._tableState ??= {
      entryNum: 0,
      streamPos: parser.lexer.stream.pos,
      parserBuf1: parser.buf1,
      parserBuf2: parser.buf2
    };
    const obj = this.readXRefTable(parser);
    if (!isCmd(obj, "trailer")) {
      throw new FormatError("Invalid XRef table: could not find trailer dictionary");
    }
    let dict = parser.getObj();
    if (dict instanceof BaseStream) {
      dict = dict.dict;
    }
    if (!(dict instanceof Dict)) {
      throw new FormatError("Invalid XRef table: could not parse trailer dictionary");
    }
    delete this._tableState;
    return dict;
  }
  readXRefTable(parser) {
    const stream = parser.lexer.stream;
    const tableState = this._tableState;
    stream.pos = tableState.streamPos;
    parser.buf1 = tableState.parserBuf1;
    parser.buf2 = tableState.parserBuf2;
    let obj;
    while (true) {
      if (!("firstEntryNum" in tableState) || !("entryCount" in tableState)) {
        if (isCmd(obj = parser.getObj(), "trailer")) {
          break;
        }
        tableState.firstEntryNum = obj;
        tableState.entryCount = parser.getObj();
      }
      let first = tableState.firstEntryNum;
      const count = tableState.entryCount;
      if (!Number.isInteger(first) || !Number.isInteger(count)) {
        throw new FormatError("Invalid XRef table: wrong types in subsection header");
      }
      for (let i = tableState.entryNum; i < count; i++) {
        tableState.streamPos = stream.pos;
        tableState.entryNum = i;
        tableState.parserBuf1 = parser.buf1;
        tableState.parserBuf2 = parser.buf2;
        const entry = {
          offset: parser.getObj(),
          gen: parser.getObj(),
          free: false,
          uncompressed: false
        };
        const type = parser.getObj();
        if (type instanceof Cmd) {
          switch (type.cmd) {
            case "f":
              entry.free = true;
              break;
            case "n":
              entry.uncompressed = true;
              break;
          }
        }
        if (!Number.isInteger(entry.offset) || !Number.isInteger(entry.gen) || !(entry.free || entry.uncompressed)) {
          throw new FormatError(`Invalid entry in XRef subsection: ${first}, ${count}`);
        }
        if (i === 0 && entry.free && first === 1) {
          first = 0;
        }
        this.#entries[first + i] ??= entry;
      }
      tableState.entryNum = 0;
      tableState.streamPos = stream.pos;
      tableState.parserBuf1 = parser.buf1;
      tableState.parserBuf2 = parser.buf2;
      delete tableState.firstEntryNum;
      delete tableState.entryCount;
    }
    if (this.#entries[0] && !this.#entries[0].free) {
      throw new FormatError("Invalid XRef table: unexpected first object");
    }
    return obj;
  }
  processXRefStream(stream) {
    if (!("streamState" in this)) {
      const {
        dict,
        pos
      } = stream;
      const byteWidths = dict.get("W");
      const range = dict.get("Index") || [0, dict.get("Size")];
      this.streamState = {
        entryRanges: range,
        byteWidths,
        entryNum: 0,
        streamPos: pos
      };
    }
    this.readXRefStream(stream);
    delete this.streamState;
    return stream.dict;
  }
  readXRefStream(stream) {
    const streamState = this.streamState;
    stream.pos = streamState.streamPos;
    const [typeFieldWidth, offsetFieldWidth, generationFieldWidth] = streamState.byteWidths;
    const entryRanges = streamState.entryRanges;
    while (entryRanges.length > 0) {
      const [first, n] = entryRanges;
      if (!Number.isInteger(first) || !Number.isInteger(n)) {
        throw new FormatError(`Invalid XRef range fields: ${first}, ${n}`);
      }
      if (![typeFieldWidth, offsetFieldWidth, generationFieldWidth].every(width => Number.isInteger(width) && width >= 0) || typeFieldWidth + offsetFieldWidth + generationFieldWidth === 0) {
        throw new FormatError(`Invalid XRef entry fields length: ${first}, ${n}`);
      }
      for (let i = streamState.entryNum; i < n; ++i) {
        streamState.entryNum = i;
        streamState.streamPos = stream.pos;
        let type = 0,
          offset = 0,
          generation = 0;
        for (let j = 0; j < typeFieldWidth; ++j) {
          const typeByte = stream.getByte();
          if (typeByte === -1) {
            throw new FormatError("Invalid XRef byteWidths 'type'.");
          }
          type = type << 8 | typeByte;
        }
        if (typeFieldWidth === 0) {
          type = 1;
        }
        for (let j = 0; j < offsetFieldWidth; ++j) {
          const offsetByte = stream.getByte();
          if (offsetByte === -1) {
            throw new FormatError("Invalid XRef byteWidths 'offset'.");
          }
          offset = offset * 256 + offsetByte;
        }
        for (let j = 0; j < generationFieldWidth; ++j) {
          const generationByte = stream.getByte();
          if (generationByte === -1) {
            throw new FormatError("Invalid XRef byteWidths 'generation'.");
          }
          generation = generation << 8 | generationByte;
        }
        const entry = {
          offset,
          gen: generation,
          free: false,
          uncompressed: false
        };
        switch (type) {
          case 0:
            entry.free = true;
            break;
          case 1:
            entry.uncompressed = true;
            break;
          case 2:
            break;
          default:
            throw new FormatError(`Invalid XRef entry type: ${type}`);
        }
        this.#entries[first + i] ??= entry;
      }
      streamState.entryNum = 0;
      streamState.streamPos = stream.pos;
      entryRanges.splice(0, 2);
    }
  }
  indexObjects() {
    const TAB = 0x9,
      LF = 0xa,
      CR = 0xd,
      SPACE = 0x20;
    const PERCENT = 0x25,
      LT = 0x3c;
    function readToken(data, offset) {
      let token = "",
        ch = data[offset];
      while (ch !== LF && ch !== CR && ch !== LT) {
        if (++offset >= data.length) {
          break;
        }
        token += String.fromCharCode(ch);
        ch = data[offset];
      }
      return token;
    }
    function skipUntil(data, offset, what) {
      const length = what.length,
        dataLength = data.length;
      let skipped = 0;
      while (offset < dataLength) {
        let i = 0;
        while (i < length && data[offset + i] === what[i]) {
          ++i;
        }
        if (i >= length) {
          break;
        }
        offset++;
        skipped++;
      }
      return skipped;
    }
    const gEndobjRegExp = /\b(endobj|\d+\s+\d+\s+obj|xref|trailer\s*<<)\b/g;
    const gStartxrefRegExp = /\b(startxref|\d+\s+\d+\s+obj)\b/g;
    const objRegExp = /^(\d+)\s+(\d+)\s+obj\b/;
    const trailerBytes = new Uint8Array([116, 114, 97, 105, 108, 101, 114]);
    const startxrefBytes = new Uint8Array([115, 116, 97, 114, 116, 120, 114, 101, 102]);
    const xrefBytes = new Uint8Array([47, 88, 82, 101, 102]);
    this.#entries.length = 0;
    this.#cacheMap.clear();
    const stream = this.stream;
    stream.pos = 0;
    const buffer = stream.getBytes(),
      bufferStr = bytesToString(buffer),
      length = buffer.length;
    let position = stream.start;
    const trailers = [],
      xrefStms = [];
    while (position < length) {
      let ch = buffer[position];
      if (ch === TAB || ch === LF || ch === CR || ch === SPACE) {
        ++position;
        continue;
      }
      if (ch === PERCENT) {
        do {
          ++position;
          if (position >= length) {
            break;
          }
          ch = buffer[position];
        } while (ch !== LF && ch !== CR);
        continue;
      }
      const token = readToken(buffer, position);
      let m;
      if (token.startsWith("xref") && (token.length === 4 || /\s/.test(token[4]))) {
        position += skipUntil(buffer, position, trailerBytes);
        trailers.push(position);
        position += skipUntil(buffer, position, startxrefBytes);
      } else if (m = objRegExp.exec(token)) {
        const num = m[1] | 0,
          gen = m[2] | 0;
        const startPos = position + token.length;
        let contentLength,
          updateEntries = false;
        if (!this.#entries[num]) {
          updateEntries = true;
        } else if (this.#entries[num].gen === gen) {
          try {
            const parser = new Parser({
              lexer: new Lexer(stream.makeSubStream(startPos))
            });
            parser.getObj();
            updateEntries = true;
          } catch (ex) {
            if (ex instanceof ParserEOFException) {
              warn(`indexObjects -- checking object (${token}): "${ex}".`);
            } else {
              updateEntries = true;
            }
          }
        }
        if (updateEntries) {
          this.#entries[num] = {
            offset: position - stream.start,
            gen,
            free: false,
            uncompressed: true
          };
        }
        gEndobjRegExp.lastIndex = startPos;
        const match = gEndobjRegExp.exec(bufferStr);
        if (match) {
          const endPos = gEndobjRegExp.lastIndex + 1;
          contentLength = endPos - position;
          if (match[1] !== "endobj") {
            warn(`indexObjects: Found "${match[1]}" inside of another "obj", ` + 'caused by missing "endobj" -- trying to recover.');
            contentLength -= match[1].length + 1;
          }
        } else {
          contentLength = length - position;
        }
        const content = buffer.subarray(position, position + contentLength);
        const xrefTagOffset = skipUntil(content, 0, xrefBytes);
        if (xrefTagOffset < contentLength && content[xrefTagOffset + 5] < 64) {
          xrefStms.push(position - stream.start);
          this.#xrefStms.add(position - stream.start);
        }
        position += contentLength;
      } else if (token.startsWith("trailer") && (token.length === 7 || /\s/.test(token[7]))) {
        trailers.push(position);
        const startPos = position + token.length;
        let contentLength;
        gStartxrefRegExp.lastIndex = startPos;
        const match = gStartxrefRegExp.exec(bufferStr);
        if (match) {
          const endPos = gStartxrefRegExp.lastIndex + 1;
          contentLength = endPos - position;
          if (match[1] !== "startxref") {
            warn(`indexObjects: Found "${match[1]}" after "trailer", ` + 'caused by missing "startxref" -- trying to recover.');
            contentLength -= match[1].length + 1;
          }
        } else {
          contentLength = length - position;
        }
        position += contentLength;
      } else {
        position += token.length + 1;
      }
    }
    for (const xrefStm of xrefStms) {
      this.startXRefQueue.push(xrefStm);
      this.readXRef(true);
    }
    const trailerDicts = [];
    let isEncrypted = false;
    for (const trailer of trailers) {
      stream.pos = trailer;
      const parser = new Parser({
        lexer: new Lexer(stream),
        xref: this,
        allowStreams: true,
        recoveryMode: true
      });
      const obj = parser.getObj();
      if (!isCmd(obj, "trailer")) {
        continue;
      }
      const dict = parser.getObj();
      if (!(dict instanceof Dict)) {
        continue;
      }
      trailerDicts.push(dict);
      if (dict.has("Encrypt")) {
        isEncrypted = true;
      }
    }
    let trailerDict, trailerError;
    for (const dict of [...trailerDicts, "genFallback", ...trailerDicts]) {
      if (dict === "genFallback") {
        if (!trailerError) {
          break;
        }
        this._generationFallback = true;
        continue;
      }
      let validPagesDict = false;
      try {
        const rootDict = dict.get("Root");
        if (!(rootDict instanceof Dict)) {
          continue;
        }
        const pagesDict = rootDict.get("Pages");
        if (!(pagesDict instanceof Dict)) {
          continue;
        }
        const pagesCount = pagesDict.get("Count");
        if (Number.isInteger(pagesCount)) {
          validPagesDict = true;
        }
      } catch (ex) {
        trailerError = ex;
        continue;
      }
      if (validPagesDict && (!isEncrypted || dict.has("Encrypt")) && dict.has("ID")) {
        return dict;
      }
      trailerDict = dict;
    }
    if (trailerDict) {
      return trailerDict;
    }
    if (this.topDict) {
      return this.topDict;
    }
    if (!trailerDicts.length) {
      for (const num in this.#entries) {
        const entry = this.#entries[num];
        if (!entry) {
          continue;
        }
        const ref = Ref.get(parseInt(num, 10), entry.gen);
        let obj;
        try {
          obj = this.fetch(ref);
        } catch {
          continue;
        }
        if (obj instanceof BaseStream) {
          obj = obj.dict;
        }
        if (obj instanceof Dict && obj.has("Root")) {
          return obj;
        }
      }
    }
    throw new InvalidPDFException("Invalid PDF structure.");
  }
  readXRef(recoveryMode = false) {
    const stream = this.stream;
    const startXRefParsedCache = new Set();
    while (this.startXRefQueue.length) {
      try {
        const startXRef = this.startXRefQueue[0];
        if (startXRefParsedCache.has(startXRef)) {
          warn("readXRef - skipping XRef table since it was already parsed.");
          this.startXRefQueue.shift();
          continue;
        }
        startXRefParsedCache.add(startXRef);
        stream.pos = startXRef + stream.start;
        const parser = new Parser({
          lexer: new Lexer(stream),
          xref: this,
          allowStreams: true
        });
        let obj = parser.getObj();
        let dict;
        if (isCmd(obj, "xref")) {
          dict = this.processXRefTable(parser);
          this.topDict ||= dict;
          obj = dict.get("XRefStm");
          if (Number.isInteger(obj) && !this.#xrefStms.has(obj)) {
            this.#xrefStms.add(obj);
            this.startXRefQueue.push(obj);
          }
        } else if (Number.isInteger(obj)) {
          if (!Number.isInteger(parser.getObj()) || !isCmd(parser.getObj(), "obj") || !((obj = parser.getObj()) instanceof BaseStream)) {
            throw new FormatError("Invalid XRef stream");
          }
          dict = this.processXRefStream(obj);
          this.topDict ||= dict;
          if (!dict) {
            throw new FormatError("Failed to read XRef stream");
          }
        } else {
          throw new FormatError("Invalid XRef stream header");
        }
        this.#xrefSectionOffsets.add(startXRef);
        obj = dict.get("Prev");
        if (Number.isInteger(obj)) {
          this.startXRefQueue.push(obj);
        } else if (obj instanceof Ref) {
          this.startXRefQueue.push(obj.num);
        }
      } catch (e) {
        if (e instanceof MissingDataException) {
          throw e;
        }
        delete this._tableState;
        delete this.streamState;
        this.#xrefSectionsComplete = false;
        info("(while reading XRef): " + e);
      }
      this.startXRefQueue.shift();
    }
    if (this.topDict) {
      return this.topDict;
    }
    if (recoveryMode) {
      return undefined;
    }
    throw new XRefParseException();
  }
  countUpdatesAfter(offset) {
    if (this.#parsedWithRecovery || !this.#xrefSectionsComplete) {
      return null;
    }
    const relativeOffset = offset - this.stream.start;
    let count = 0;
    for (const sectionOffset of this.#xrefSectionOffsets) {
      if (sectionOffset >= relativeOffset && !this.#xrefStms.has(sectionOffset)) {
        count++;
      }
    }
    return count;
  }
  getEntry(i) {
    const entry = this.#entries[i];
    return entry && !entry.free && entry.offset ? entry : null;
  }
  fetchIfRef(obj, suppressEncryption = false) {
    return obj instanceof Ref ? this.fetch(obj, suppressEncryption) : obj;
  }
  fetch(ref, suppressEncryption = false) {
    if (!(ref instanceof Ref)) {
      throw new Error("ref object is not a reference");
    }
    const num = ref.num;
    const cacheEntry = this.#cacheMap.get(num);
    if (cacheEntry !== undefined) {
      if (cacheEntry instanceof Dict && !cacheEntry.objId) {
        cacheEntry.objId = ref.toString();
      }
      return cacheEntry;
    }
    let xrefEntry = this.getEntry(num);
    if (xrefEntry === null) {
      return xrefEntry;
    }
    if (this.#pendingRefs.has(ref)) {
      this.#pendingRefs.remove(ref);
      warn(`Ignoring circular reference: ${ref}.`);
      return CIRCULAR_REF;
    }
    this.#pendingRefs.put(ref);
    try {
      xrefEntry = xrefEntry.uncompressed ? this.fetchUncompressed(ref, xrefEntry, suppressEncryption) : this.fetchCompressed(ref, xrefEntry, suppressEncryption);
      this.#pendingRefs.remove(ref);
    } catch (ex) {
      this.#pendingRefs.remove(ref);
      throw ex;
    }
    if (xrefEntry instanceof Dict) {
      xrefEntry.objId = ref.toString();
    } else if (xrefEntry instanceof BaseStream) {
      xrefEntry.dict.objId = ref.toString();
    }
    return xrefEntry;
  }
  fetchUncompressed(ref, xrefEntry, suppressEncryption = false) {
    const gen = ref.gen;
    let num = ref.num;
    if (xrefEntry.gen !== gen) {
      const msg = `Inconsistent generation in XRef: ${ref}`;
      if (this._generationFallback && xrefEntry.gen < gen) {
        warn(msg);
        return this.fetchUncompressed(Ref.get(num, xrefEntry.gen), xrefEntry, suppressEncryption);
      }
      throw new XRefEntryException(msg);
    }
    const stream = this.stream.makeSubStream(xrefEntry.offset + this.stream.start);
    const parser = new Parser({
      lexer: new Lexer(stream),
      xref: this,
      allowStreams: true
    });
    const obj1 = parser.getObj();
    const obj2 = parser.getObj();
    const obj3 = parser.getObj();
    if (obj1 !== num || obj2 !== gen || !(obj3 instanceof Cmd)) {
      throw new XRefEntryException(`Bad (uncompressed) XRef entry: ${ref}`);
    }
    if (obj3.cmd !== "obj") {
      if (obj3.cmd.startsWith("obj")) {
        num = parseInt(obj3.cmd.substring(3), 10);
        if (!Number.isNaN(num)) {
          return num;
        }
      }
      throw new XRefEntryException(`Bad (uncompressed) XRef entry: ${ref}`);
    }
    xrefEntry = this.encrypt && !suppressEncryption ? parser.getObj(this.encrypt.createCipherTransform(num, gen)) : parser.getObj();
    if (!(xrefEntry instanceof BaseStream)) {
      this.#cacheMap.set(num, xrefEntry);
    }
    return xrefEntry;
  }
  fetchCompressed(ref, xrefEntry, suppressEncryption = false) {
    const tableOffset = xrefEntry.offset;
    const stream = this.fetch(Ref.get(tableOffset, 0));
    if (!(stream instanceof BaseStream)) {
      throw new FormatError("bad ObjStm stream");
    }
    const first = stream.dict.get("First");
    const n = stream.dict.get("N");
    if (!Number.isInteger(first) || !Number.isInteger(n)) {
      throw new FormatError("invalid first and n parameters for ObjStm stream");
    }
    let parser = new Parser({
      lexer: new Lexer(stream),
      xref: this,
      allowStreams: true
    });
    const nums = new Array(n);
    const offsets = new Array(n);
    for (let i = 0; i < n; ++i) {
      const num = parser.getObj();
      if (!Number.isInteger(num)) {
        throw new FormatError(`invalid object number in the ObjStm stream: ${num}`);
      }
      const offset = parser.getObj();
      if (!Number.isInteger(offset)) {
        throw new FormatError(`invalid object offset in the ObjStm stream: ${offset}`);
      }
      nums[i] = num;
      const entry = this.getEntry(num);
      if (entry?.offset === tableOffset && entry.gen !== i) {
        entry.gen = i;
      }
      offsets[i] = offset;
    }
    const start = (stream.start || 0) + first;
    const entries = new Array(n);
    for (let i = 0; i < n; ++i) {
      const length = i < n - 1 ? offsets[i + 1] - offsets[i] : undefined;
      if (length < 0) {
        throw new FormatError("Invalid offset in the ObjStm stream.");
      }
      parser = new Parser({
        lexer: new Lexer(stream.makeSubStream(start + offsets[i], length, stream.dict)),
        xref: this,
        allowStreams: true
      });
      const obj = parser.getObj();
      entries[i] = obj;
      if (obj instanceof BaseStream) {
        continue;
      }
      const num = nums[i],
        entry = this.#entries[num];
      if (entry && entry.offset === tableOffset && entry.gen === i) {
        this.#cacheMap.set(num, obj);
      }
    }
    xrefEntry = entries[xrefEntry.gen];
    if (xrefEntry === undefined) {
      throw new XRefEntryException(`Bad (compressed) XRef entry: ${ref}`);
    }
    return xrefEntry;
  }
  async fetchIfRefAsync(obj, suppressEncryption) {
    return obj instanceof Ref ? this.fetchAsync(obj, suppressEncryption) : obj;
  }
  async fetchAsync(ref, suppressEncryption) {
    try {
      return this.fetch(ref, suppressEncryption);
    } catch (ex) {
      if (!(ex instanceof MissingDataException)) {
        throw ex;
      }
      await this.pdfManager.requestRange(ex.begin, ex.end);
      return this.fetchAsync(ref, suppressEncryption);
    }
  }
  getCatalogObj() {
    return this.root;
  }
}
export { XRef };