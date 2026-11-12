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
import "core-js/modules/es.iterator.some.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import "core-js/modules/es.typed-array.with.js";
import "core-js/modules/es.uint8-array.set-from-base64.js";
import "core-js/modules/es.uint8-array.set-from-hex.js";
import "core-js/modules/es.uint8-array.to-base64.js";
import "core-js/modules/es.uint8-array.to-hex.js";
import { assert, bytesToString, FormatError, info, warn } from "../shared/util.js";
import { Cmd, Dict, EOF, isCmd, isName, Name, Ref } from "./primitives.js";
import { isWhiteSpace, MissingDataException, ParserEOFException } from "./core_utils.js";
import { NullStream, Stream } from "./stream.js";
import { Ascii85Stream } from "./ascii_85_stream.js";
import { AsciiHexStream } from "./ascii_hex_stream.js";
import { BrotliStream } from "./brotli_stream.js";
import { CCITTFaxStream } from "./ccitt_stream.js";
import { FlateStream } from "./flate_stream.js";
import { Jbig2Stream } from "./jbig2_stream.js";
import { JpegStream } from "./jpeg_stream.js";
import { JpxStream } from "./jpx_stream.js";
import { LZWStream } from "./lzw_stream.js";
import { PredictorStream } from "./predictor_stream.js";
import { RunLengthStream } from "./run_length_stream.js";
const MAX_LENGTH_TO_CACHE = 1000;
function getInlineImageCacheKey(bytes) {
  const strBuf = [],
    ii = bytes.length;
  let i = 0;
  while (i < ii - 1) {
    strBuf.push(bytes[i++] << 8 | bytes[i++]);
  }
  if (i < ii) {
    strBuf.push(bytes[i]);
  }
  return ii + "_" + String.fromCharCode.apply(null, strBuf);
}
class Parser {
  #imageCache = null;
  #imageId = 0;
  constructor({
    lexer,
    xref,
    allowStreams = false,
    recoveryMode = false
  }) {
    this.lexer = lexer;
    this.xref = xref;
    this.allowStreams = allowStreams;
    this.recoveryMode = recoveryMode;
    this.refill();
  }
  refill() {
    this.buf1 = this.lexer.getObj();
    this.buf2 = this.lexer.getObj();
  }
  shift() {
    if (this.buf2 instanceof Cmd && this.buf2.cmd === "ID") {
      this.buf1 = this.buf2;
      this.buf2 = null;
    } else {
      this.buf1 = this.buf2;
      this.buf2 = this.lexer.getObj();
    }
  }
  tryShift() {
    try {
      this.shift();
      return true;
    } catch (e) {
      if (e instanceof MissingDataException) {
        throw e;
      }
      return false;
    }
  }
  getObj(cipherTransform = null) {
    const buf1 = this.buf1;
    this.shift();
    if (buf1 instanceof Cmd) {
      switch (buf1.cmd) {
        case "BI":
          return this.makeInlineImage(cipherTransform);
        case "[":
          const array = [];
          while (!isCmd(this.buf1, "]") && this.buf1 !== EOF) {
            array.push(this.getObj(cipherTransform));
          }
          if (this.buf1 === EOF) {
            if (this.recoveryMode) {
              return array;
            }
            throw new ParserEOFException("End of file inside array.");
          }
          this.shift();
          return array;
        case "<<":
          const dict = new Dict(this.xref);
          while (!isCmd(this.buf1, ">>") && this.buf1 !== EOF) {
            if (!(this.buf1 instanceof Name)) {
              info("Malformed dictionary: key must be a name object");
              this.shift();
              continue;
            }
            const key = this.buf1.name;
            this.shift();
            if (this.buf1 === EOF) {
              break;
            }
            dict.set(key, this.getObj(cipherTransform));
          }
          if (this.buf1 === EOF) {
            if (this.recoveryMode) {
              return dict;
            }
            throw new ParserEOFException("End of file inside dictionary.");
          }
          if (isCmd(this.buf2, "stream")) {
            return this.allowStreams ? this.makeStream(dict, cipherTransform) : dict;
          }
          this.shift();
          return dict;
        default:
          return buf1;
      }
    }
    if (Number.isInteger(buf1)) {
      if (Number.isInteger(this.buf1) && isCmd(this.buf2, "R")) {
        const ref = Ref.get(buf1, this.buf1);
        this.shift();
        this.shift();
        return ref;
      }
      return buf1;
    }
    if (typeof buf1 === "string") {
      return cipherTransform ? cipherTransform.decryptString(buf1) : buf1;
    }
    return buf1;
  }
  findDefaultInlineStreamEnd(stream) {
    const E = 0x45,
      I = 0x49,
      SPACE = 0x20,
      LF = 0xa,
      CR = 0xd,
      NUL = 0x0;
    const {
        knownCommands
      } = this.lexer,
      startPos = stream.pos,
      n = 15;
    let state = 0,
      ch,
      maybeEIPos;
    while ((ch = stream.getByte()) !== -1) {
      if (state === 0) {
        state = ch === E ? 1 : 0;
      } else if (state === 1) {
        state = ch === I ? 2 : 0;
      } else {
        if (ch === SPACE || ch === LF || ch === CR) {
          maybeEIPos = stream.pos;
          const followingBytes = stream.peekBytes(n);
          const ii = followingBytes.length;
          if (ii === 0) {
            break;
          }
          for (let i = 0; i < ii; i++) {
            ch = followingBytes[i];
            if (ch === NUL && followingBytes[i + 1] !== NUL) {
              continue;
            }
            if (ch !== LF && ch !== CR && (ch < SPACE || ch > 0x7f)) {
              state = 0;
              break;
            }
          }
          if (state !== 2) {
            continue;
          }
          if (!knownCommands) {
            warn("findDefaultInlineStreamEnd - `lexer.knownCommands` is undefined.");
            continue;
          }
          const tmpLexer = new Lexer(new Stream(stream.peekBytes(5 * n)), knownCommands);
          tmpLexer._hexStringWarn = () => {};
          let numArgs = 0;
          while (true) {
            const nextObj = tmpLexer.getObj();
            if (nextObj === EOF) {
              state = 0;
              break;
            }
            if (nextObj instanceof Cmd) {
              const knownCommand = knownCommands[nextObj.cmd];
              if (!knownCommand) {
                state = 0;
                break;
              } else if (knownCommand.variableArgs ? numArgs <= knownCommand.numArgs : numArgs === knownCommand.numArgs) {
                break;
              }
              numArgs = 0;
              continue;
            }
            numArgs++;
          }
          if (state === 2) {
            break;
          }
        } else {
          state = 0;
        }
      }
    }
    if (ch === -1) {
      warn("findDefaultInlineStreamEnd: " + "Reached the end of the stream without finding a valid EI marker");
      if (maybeEIPos) {
        warn('... trying to recover by using the last "EI" occurrence.');
        stream.skip(-(stream.pos - maybeEIPos));
      }
    }
    let endOffset = 4;
    stream.skip(-endOffset);
    ch = stream.peekByte();
    stream.skip(endOffset);
    if (!isWhiteSpace(ch)) {
      endOffset--;
    }
    return stream.pos - endOffset - startPos;
  }
  findDCTDecodeInlineStreamEnd(stream) {
    const startPos = stream.pos;
    let foundEOI = false,
      b,
      markerLength;
    while ((b = stream.getByte()) !== -1) {
      if (b !== 0xff) {
        continue;
      }
      switch (stream.getByte()) {
        case 0x00:
          break;
        case 0xff:
          stream.skip(-1);
          break;
        case 0xd9:
          foundEOI = true;
          break;
        case 0xc0:
        case 0xc1:
        case 0xc2:
        case 0xc3:
        case 0xc5:
        case 0xc6:
        case 0xc7:
        case 0xc9:
        case 0xca:
        case 0xcb:
        case 0xcd:
        case 0xce:
        case 0xcf:
        case 0xc4:
        case 0xcc:
        case 0xda:
        case 0xdb:
        case 0xdc:
        case 0xdd:
        case 0xde:
        case 0xdf:
        case 0xe0:
        case 0xe1:
        case 0xe2:
        case 0xe3:
        case 0xe4:
        case 0xe5:
        case 0xe6:
        case 0xe7:
        case 0xe8:
        case 0xe9:
        case 0xea:
        case 0xeb:
        case 0xec:
        case 0xed:
        case 0xee:
        case 0xef:
        case 0xfe:
          markerLength = stream.getUint16();
          if (markerLength > 2) {
            stream.skip(markerLength - 2);
          } else {
            stream.skip(-2);
          }
          break;
      }
      if (foundEOI) {
        break;
      }
    }
    return this.inlineStreamSkipEI(stream, startPos, b, "DCTDecode");
  }
  findASCII85DecodeInlineStreamEnd(stream) {
    const TILDE = 0x7e;
    const startPos = stream.pos;
    let ch;
    while ((ch = stream.getByte()) !== -1) {
      if (ch === TILDE) {
        break;
      }
    }
    return this.inlineStreamSkipEI(stream, startPos, ch, "ASCII85Decode");
  }
  findASCIIHexDecodeInlineStreamEnd(stream) {
    const GT = 0x3e;
    const startPos = stream.pos;
    let ch;
    while ((ch = stream.getByte()) !== -1) {
      if (ch === GT) {
        break;
      }
    }
    return this.inlineStreamSkipEI(stream, startPos, ch, "ASCIIHexDecode");
  }
  inlineStreamSkipEI(stream, startPos, ch, name) {
    const length = stream.pos - startPos;
    if (ch === -1) {
      const type = name === "DCTDecode" ? "EOI" : "EOD";
      warn(`Inline ${name} image stream: ${type} marker not found, searching for /EI/ instead.`);
      stream.skip(-length);
      return this.findDefaultInlineStreamEnd(stream);
    }
    const E = 0x45,
      I = 0x49;
    let state = 0;
    while ((ch = stream.getByte()) !== -1) {
      if (state === 0) {
        state = ch === E ? 1 : 0;
      } else if (state === 1) {
        state = ch === I ? 2 : 0;
      } else if (state === 2) {
        break;
      }
    }
    return length;
  }
  makeInlineImage(cipherTransform) {
    const lexer = this.lexer;
    const stream = lexer.stream;
    const dict = new Dict(this.xref);
    let dictLength;
    while (!isCmd(this.buf1, "ID") && this.buf1 !== EOF) {
      if (!(this.buf1 instanceof Name)) {
        throw new FormatError("Dictionary key must be a name object");
      }
      const key = this.buf1.name;
      this.shift();
      if (this.buf1 === EOF) {
        break;
      }
      dict.set(key, this.getObj(cipherTransform));
    }
    if (lexer.beginInlineImagePos !== -1) {
      dictLength = stream.pos - lexer.beginInlineImagePos;
    }
    const filter = dict.get("F", "Filter");
    let filterName;
    if (filter instanceof Name) {
      filterName = filter.name;
    } else if (Array.isArray(filter)) {
      const filterZero = this.#fetchIfRef(filter[0]);
      if (filterZero instanceof Name) {
        filterName = filterZero.name;
      }
    }
    const startPos = stream.pos;
    let length;
    switch (filterName) {
      case "DCT":
      case "DCTDecode":
        length = this.findDCTDecodeInlineStreamEnd(stream);
        break;
      case "A85":
      case "ASCII85Decode":
        length = this.findASCII85DecodeInlineStreamEnd(stream);
        break;
      case "AHx":
      case "ASCIIHexDecode":
        length = this.findASCIIHexDecodeInlineStreamEnd(stream);
        break;
      default:
        length = this.findDefaultInlineStreamEnd(stream);
    }
    let cacheKey;
    if (length < MAX_LENGTH_TO_CACHE && dictLength > 0) {
      const initialStreamPos = stream.pos;
      stream.pos = lexer.beginInlineImagePos;
      cacheKey = getInlineImageCacheKey(stream.getBytes(dictLength + length));
      stream.pos = initialStreamPos;
      const cacheEntry = this.#imageCache?.get(cacheKey);
      if (cacheEntry) {
        this.buf2 = Cmd.get("EI");
        this.shift();
        cacheEntry.reset();
        return cacheEntry;
      }
    }
    let imageStream = stream.makeSubStream(startPos, length, dict);
    if (cipherTransform && !this.#hasCryptFilter(filter)) {
      imageStream = cipherTransform.createStream(imageStream, length);
    }
    imageStream = this.filter(imageStream, dict, length, cipherTransform);
    imageStream.dict = dict;
    if (cacheKey) {
      imageStream.cacheKey = `inline_img_${++this.#imageId}`;
      (this.#imageCache ??= new Map()).set(cacheKey, imageStream);
    }
    this.buf2 = Cmd.get("EI");
    this.shift();
    return imageStream;
  }
  #fetchIfRef(obj) {
    return this.xref ? this.xref.fetchIfRef(obj) : obj;
  }
  #hasCryptFilter(filter) {
    return Array.isArray(filter) ? filter.some(f => isName(this.#fetchIfRef(f), "Crypt")) : isName(filter, "Crypt");
  }
  #findStreamLength(startPos) {
    const {
      stream
    } = this.lexer;
    stream.pos = startPos;
    const SCAN_BLOCK_LENGTH = 2048;
    const signatureLength = "endstream".length;
    const END_SIGNATURE = new Uint8Array([0x65, 0x6e, 0x64]);
    const endLength = END_SIGNATURE.length;
    const PARTIAL_SIGNATURE = [new Uint8Array([0x73, 0x74, 0x72, 0x65, 0x61, 0x6d]), new Uint8Array([0x73, 0x74, 0x65, 0x61, 0x6d]), new Uint8Array([0x73, 0x74, 0x72, 0x65, 0x61])];
    const normalLength = signatureLength - endLength;
    while (stream.pos < stream.end) {
      const scanBytes = stream.peekBytes(SCAN_BLOCK_LENGTH);
      const scanLength = scanBytes.length - signatureLength;
      if (scanLength <= 0) {
        break;
      }
      let pos = 0;
      while (pos < scanLength) {
        let j = 0;
        while (j < endLength && scanBytes[pos + j] === END_SIGNATURE[j]) {
          j++;
        }
        if (j >= endLength) {
          let found = false;
          for (const part of PARTIAL_SIGNATURE) {
            const partLen = part.length;
            let k = 0;
            while (k < partLen && scanBytes[pos + j + k] === part[k]) {
              k++;
            }
            if (k >= normalLength) {
              found = true;
              break;
            }
            if (k >= partLen) {
              const lastByte = scanBytes[pos + j + k];
              if (isWhiteSpace(lastByte)) {
                info(`Found "${bytesToString([...END_SIGNATURE, ...part])}" when ` + "searching for endstream command.");
                found = true;
              }
              break;
            }
          }
          if (found) {
            stream.pos += pos;
            return stream.pos - startPos;
          }
        }
        pos++;
      }
      stream.pos += scanLength;
    }
    return -1;
  }
  makeStream(dict, cipherTransform) {
    const lexer = this.lexer;
    let stream = lexer.stream;
    lexer.skipToNextLine();
    const startPos = stream.pos - 1;
    let length = dict.get("Length");
    if (!Number.isInteger(length)) {
      info(`Bad length "${length && length.toString()}" in stream.`);
      length = 0;
    }
    stream.pos = startPos + length;
    lexer.nextChar();
    if (this.tryShift() && isCmd(this.buf2, "endstream")) {
      this.shift();
    } else {
      length = this.#findStreamLength(startPos);
      if (length < 0) {
        throw new FormatError("Missing endstream command.");
      }
      lexer.nextChar();
      this.shift();
      this.shift();
    }
    this.shift();
    stream = stream.makeSubStream(startPos, length, dict);
    const filter = dict.get("F", "Filter");
    if (cipherTransform && !this.#hasCryptFilter(filter)) {
      stream = cipherTransform.createStream(stream, length);
    }
    stream = this.filter(stream, dict, length, cipherTransform);
    stream.dict = dict;
    return stream;
  }
  filter(stream, dict, length, cipherTransform = null) {
    let filter = dict.get("F", "Filter");
    let params = dict.get("DP", "DecodeParms");
    if (filter instanceof Name) {
      if (Array.isArray(params)) {
        warn("/DecodeParms should not be an Array, when /Filter is a Name.");
      }
      return this.makeFilter(stream, filter.name, length, params, cipherTransform);
    }
    let maybeLength = length;
    if (Array.isArray(filter)) {
      const filterArray = filter;
      const paramsArray = params;
      for (let i = 0, ii = filterArray.length; i < ii; ++i) {
        filter = this.#fetchIfRef(filterArray[i]);
        if (!(filter instanceof Name)) {
          throw new FormatError(`Bad filter name "${filter}"`);
        }
        params = null;
        if (Array.isArray(paramsArray) && i in paramsArray) {
          params = this.#fetchIfRef(paramsArray[i]);
        }
        stream = this.makeFilter(stream, filter.name, maybeLength, params, cipherTransform);
        maybeLength = null;
      }
    }
    return stream;
  }
  makeFilter(stream, name, maybeLength, params, cipherTransform = null) {
    if (maybeLength === 0) {
      warn(`Empty "${name}" stream.`);
      return new NullStream();
    }
    try {
      switch (name) {
        case "Fl":
        case "FlateDecode":
          if (params) {
            return new PredictorStream(new FlateStream(stream, maybeLength), maybeLength, params);
          }
          return new FlateStream(stream, maybeLength);
        case "LZW":
        case "LZWDecode":
          let earlyChange = 1;
          if (params) {
            if (params.has("EarlyChange")) {
              earlyChange = params.get("EarlyChange");
            }
            return new PredictorStream(new LZWStream(stream, maybeLength, earlyChange), maybeLength, params);
          }
          return new LZWStream(stream, maybeLength, earlyChange);
        case "DCT":
        case "DCTDecode":
          return new JpegStream(stream, maybeLength, params);
        case "JPX":
        case "JPXDecode":
          return new JpxStream(stream, maybeLength);
        case "A85":
        case "ASCII85Decode":
          return new Ascii85Stream(stream, maybeLength);
        case "AHx":
        case "ASCIIHexDecode":
          return new AsciiHexStream(stream, maybeLength);
        case "CCF":
        case "CCITTFaxDecode":
          return new CCITTFaxStream(stream, maybeLength, params);
        case "RL":
        case "RunLengthDecode":
          return new RunLengthStream(stream, maybeLength);
        case "JBIG2Decode":
          return new Jbig2Stream(stream, maybeLength, params);
        case "BrotliDecode":
          return new BrotliStream(stream, maybeLength);
        case "Crypt":
          {
            if (!cipherTransform) {
              warn('Filter "Crypt" is missing a cipher transform.');
              return stream;
            }
            const param = params instanceof Dict ? params.get("Name") : null;
            const cryptName = param instanceof Name ? param : Name.get("Identity");
            return cipherTransform.createStream(stream, maybeLength, cryptName);
          }
      }
      warn(`Filter "${name}" is not supported.`);
      return stream;
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn(`Invalid stream: "${ex}"`);
      return new NullStream();
    }
  }
}
const specialChars = [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
function toHexDigit(ch) {
  if (ch >= 0x30 && ch <= 0x39) {
    return ch & 0x0f;
  }
  if (ch >= 0x41 && ch <= 0x46 || ch >= 0x61 && ch <= 0x66) {
    return (ch & 0x0f) + 9;
  }
  return -1;
}
class Lexer {
  constructor(stream, knownCommands = null) {
    this.stream = stream;
    this.nextChar();
    this.strBuf = [];
    this.knownCommands = knownCommands;
    this._hexStringNumWarn = 0;
    this.beginInlineImagePos = -1;
  }
  nextChar() {
    return this.currentChar = this.stream.getByte();
  }
  peekChar() {
    return this.stream.peekByte();
  }
  getNumber() {
    let ch = this.currentChar;
    let divideBy = 0;
    let sign = 1;
    if (ch === 0x2d) {
      sign = -1;
      ch = this.nextChar();
      if (ch === 0x2d) {
        ch = this.nextChar();
      }
    } else if (ch === 0x2b) {
      ch = this.nextChar();
    }
    if (ch === 0x0a || ch === 0x0d) {
      do {
        ch = this.nextChar();
      } while (ch === 0x0a || ch === 0x0d);
    }
    if (ch === 0x2e) {
      divideBy = 10;
      ch = this.nextChar();
    }
    if (ch < 0x30 || ch > 0x39) {
      const msg = `Invalid number: ${String.fromCharCode(ch)} (charCode ${ch})`;
      if (isWhiteSpace(ch) || ch === 0x28 || ch === 0x3c || ch === -1) {
        info(`Lexer.getNumber - "${msg}".`);
        return 0;
      }
      throw new FormatError(msg);
    }
    let baseValue = ch - 0x30;
    while ((ch = this.nextChar()) >= 0) {
      if (ch >= 0x30 && ch <= 0x39) {
        const currentDigit = ch - 0x30;
        if (divideBy !== 0) {
          divideBy *= 10;
        }
        baseValue = baseValue * 10 + currentDigit;
      } else if (ch === 0x2e) {
        if (divideBy === 0) {
          divideBy = 1;
        } else {
          break;
        }
      } else if (ch === 0x2d) {
        warn("Badly formatted number: minus sign in the middle");
      } else {
        break;
      }
    }
    if (divideBy !== 0) {
      baseValue /= divideBy;
    }
    return sign * baseValue;
  }
  getString() {
    let numParen = 1;
    let done = false;
    const strBuf = this.strBuf;
    strBuf.length = 0;
    let ch = this.nextChar();
    while (true) {
      let charBuffered = false;
      switch (ch | 0) {
        case -1:
          warn("Unterminated string");
          done = true;
          break;
        case 0x28:
          ++numParen;
          strBuf.push("(");
          break;
        case 0x29:
          if (--numParen === 0) {
            this.nextChar();
            done = true;
          } else {
            strBuf.push(")");
          }
          break;
        case 0x5c:
          ch = this.nextChar();
          switch (ch) {
            case -1:
              warn("Unterminated string");
              done = true;
              break;
            case 0x6e:
              strBuf.push("\n");
              break;
            case 0x72:
              strBuf.push("\r");
              break;
            case 0x74:
              strBuf.push("\t");
              break;
            case 0x62:
              strBuf.push("\b");
              break;
            case 0x66:
              strBuf.push("\f");
              break;
            case 0x5c:
              strBuf.push("\\");
              break;
            case 0x28:
              strBuf.push("(");
              break;
            case 0x29:
              strBuf.push(")");
              break;
            case 0x30:
            case 0x31:
            case 0x32:
            case 0x33:
            case 0x34:
            case 0x35:
            case 0x36:
            case 0x37:
              let x = ch & 0x0f;
              ch = this.nextChar();
              charBuffered = true;
              if (ch >= 0x30 && ch <= 0x37) {
                x = (x << 3) + (ch & 0x0f);
                ch = this.nextChar();
                if (ch >= 0x30 && ch <= 0x37) {
                  charBuffered = false;
                  x = (x << 3) + (ch & 0x0f);
                }
              }
              strBuf.push(String.fromCharCode(x));
              break;
            case 0x0d:
              if (this.peekChar() === 0x0a) {
                this.nextChar();
              }
              break;
            case 0x0a:
              break;
            default:
              strBuf.push(String.fromCharCode(ch));
              break;
          }
          break;
        default:
          strBuf.push(String.fromCharCode(ch));
          break;
      }
      if (done) {
        break;
      }
      if (!charBuffered) {
        ch = this.nextChar();
      }
    }
    return strBuf.join("");
  }
  getName() {
    let ch, previousCh;
    const strBuf = this.strBuf;
    strBuf.length = 0;
    while ((ch = this.nextChar()) >= 0 && !specialChars[ch]) {
      if (ch === 0x23) {
        ch = this.nextChar();
        if (specialChars[ch]) {
          warn("Lexer_getName: " + "NUMBER SIGN (#) should be followed by a hexadecimal number.");
          strBuf.push("#");
          break;
        }
        const x = toHexDigit(ch);
        if (x !== -1) {
          previousCh = ch;
          ch = this.nextChar();
          const x2 = toHexDigit(ch);
          if (x2 === -1) {
            warn(`Lexer_getName: Illegal digit (${String.fromCharCode(ch)}) ` + "in hexadecimal number.");
            strBuf.push("#", String.fromCharCode(previousCh));
            if (specialChars[ch]) {
              break;
            }
            strBuf.push(String.fromCharCode(ch));
            continue;
          }
          strBuf.push(String.fromCharCode(x << 4 | x2));
        } else {
          strBuf.push("#", String.fromCharCode(ch));
        }
      } else {
        strBuf.push(String.fromCharCode(ch));
      }
    }
    if (strBuf.length > 127) {
      warn(`Name token is longer than allowed by the spec: ${strBuf.length}`);
    }
    return Name.get(strBuf.join(""));
  }
  _hexStringWarn(ch) {
    const MAX_HEX_STRING_NUM_WARN = 5;
    if (this._hexStringNumWarn++ === MAX_HEX_STRING_NUM_WARN) {
      warn("getHexString - ignoring additional invalid characters.");
      return;
    }
    if (this._hexStringNumWarn > MAX_HEX_STRING_NUM_WARN) {
      return;
    }
    warn(`getHexString - ignoring invalid character: ${ch}`);
  }
  getHexString() {
    const strBuf = this.strBuf;
    strBuf.length = 0;
    let ch = this.currentChar;
    let firstDigit = -1,
      digit = -1;
    this._hexStringNumWarn = 0;
    while (true) {
      if (ch < 0) {
        warn("Unterminated hex string");
        break;
      } else if (ch === 0x3e) {
        this.nextChar();
        break;
      } else if (specialChars[ch] === 1) {
        ch = this.nextChar();
        continue;
      } else {
        digit = toHexDigit(ch);
        if (digit === -1) {
          this._hexStringWarn(ch);
        } else if (firstDigit === -1) {
          firstDigit = digit;
        } else {
          strBuf.push(String.fromCharCode(firstDigit << 4 | digit));
          firstDigit = -1;
        }
        ch = this.nextChar();
      }
    }
    if (firstDigit !== -1) {
      strBuf.push(String.fromCharCode(firstDigit << 4));
    }
    return strBuf.join("");
  }
  getObj() {
    let comment = false;
    let ch = this.currentChar;
    while (true) {
      if (ch < 0) {
        return EOF;
      }
      if (comment) {
        if (ch === 0x0a || ch === 0x0d) {
          comment = false;
        }
      } else if (ch === 0x25) {
        comment = true;
      } else if (specialChars[ch] !== 1) {
        break;
      }
      ch = this.nextChar();
    }
    switch (ch | 0) {
      case 0x30:
      case 0x31:
      case 0x32:
      case 0x33:
      case 0x34:
      case 0x35:
      case 0x36:
      case 0x37:
      case 0x38:
      case 0x39:
      case 0x2b:
      case 0x2d:
      case 0x2e:
        return this.getNumber();
      case 0x28:
        return this.getString();
      case 0x2f:
        return this.getName();
      case 0x5b:
        this.nextChar();
        return Cmd.get("[");
      case 0x5d:
        this.nextChar();
        return Cmd.get("]");
      case 0x3c:
        ch = this.nextChar();
        if (ch === 0x3c) {
          this.nextChar();
          return Cmd.get("<<");
        }
        return this.getHexString();
      case 0x3e:
        ch = this.nextChar();
        if (ch === 0x3e) {
          this.nextChar();
          return Cmd.get(">>");
        }
        return Cmd.get(">");
      case 0x7b:
        this.nextChar();
        return Cmd.get("{");
      case 0x7d:
        this.nextChar();
        return Cmd.get("}");
      case 0x29:
        this.nextChar();
        throw new FormatError(`Illegal character: ${ch}`);
    }
    let str = String.fromCharCode(ch);
    if (ch < 0x20 || ch > 0x7f) {
      const nextCh = this.peekChar();
      if (nextCh >= 0x20 && nextCh <= 0x7f) {
        this.nextChar();
        return Cmd.get(str);
      }
    }
    const knownCommands = this.knownCommands;
    let knownCommandFound = knownCommands?.[str] !== undefined;
    while ((ch = this.nextChar()) >= 0 && !specialChars[ch]) {
      const possibleCommand = str + String.fromCharCode(ch);
      if (knownCommandFound && knownCommands[possibleCommand] === undefined) {
        break;
      }
      if (str.length === 128) {
        throw new FormatError(`Command token too long: ${str.length}`);
      }
      str = possibleCommand;
      knownCommandFound = knownCommands?.[str] !== undefined;
    }
    if (str === "true") {
      return true;
    }
    if (str === "false") {
      return false;
    }
    if (str === "null") {
      return null;
    }
    if (str === "BI") {
      this.beginInlineImagePos = this.stream.pos;
    }
    return Cmd.get(str);
  }
  skipToNextLine() {
    let ch = this.currentChar;
    while (ch >= 0) {
      if (ch === 0x0d) {
        ch = this.nextChar();
        if (ch === 0x0a) {
          this.nextChar();
        }
        break;
      } else if (ch === 0x0a) {
        this.nextChar();
        break;
      }
      ch = this.nextChar();
    }
  }
}
class Linearization {
  static create(stream) {
    function getInt(linDict, name, allowZeroValue = false) {
      const obj = linDict.get(name);
      if (Number.isInteger(obj) && (allowZeroValue ? obj >= 0 : obj > 0)) {
        return obj;
      }
      throw new Error(`The "${name}" parameter in the linearization ` + "dictionary is invalid.");
    }
    function getHints(linDict) {
      const hints = linDict.get("H");
      let hintsLength;
      if (Array.isArray(hints) && ((hintsLength = hints.length) === 2 || hintsLength === 4)) {
        for (let index = 0; index < hintsLength; index++) {
          const hint = hints[index];
          if (!(Number.isInteger(hint) && hint > 0)) {
            throw new Error(`Hint (${index}) in the linearization dictionary is invalid.`);
          }
        }
        return hints;
      }
      throw new Error("Hint array in the linearization dictionary is invalid.");
    }
    const parser = new Parser({
      lexer: new Lexer(stream),
      xref: null
    });
    const obj1 = parser.getObj();
    const obj2 = parser.getObj();
    const obj3 = parser.getObj();
    const linDict = parser.getObj();
    let obj, length;
    if (!(Number.isInteger(obj1) && Number.isInteger(obj2) && isCmd(obj3, "obj") && linDict instanceof Dict && typeof (obj = linDict.get("Linearized")) === "number" && obj > 0)) {
      return null;
    } else if ((length = getInt(linDict, "L")) !== stream.length) {
      throw new Error('The "L" parameter in the linearization dictionary ' + "does not equal the stream length.");
    }
    return {
      length,
      hints: getHints(linDict),
      objectNumberFirst: getInt(linDict, "O"),
      endFirst: getInt(linDict, "E"),
      numPages: getInt(linDict, "N"),
      mainXRefEntriesOffset: getInt(linDict, "T"),
      pageFirst: linDict.has("P") ? getInt(linDict, "P", true) : 0
    };
  }
}
export { Lexer, Linearization, Parser, toHexDigit };