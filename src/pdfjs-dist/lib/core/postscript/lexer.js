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
const TOKEN = {
  number: 0,
  lbrace: 1,
  rbrace: 2,
  true: 3,
  false: 4,
  add: 5,
  sub: 6,
  mul: 7,
  div: 8,
  idiv: 9,
  mod: 10,
  exp: 11,
  eq: 12,
  ne: 13,
  gt: 14,
  ge: 15,
  lt: 16,
  le: 17,
  and: 18,
  or: 19,
  xor: 20,
  bitshift: 21,
  abs: 22,
  neg: 23,
  ceiling: 24,
  floor: 25,
  round: 26,
  truncate: 27,
  not: 28,
  sqrt: 29,
  sin: 30,
  cos: 31,
  ln: 32,
  log: 33,
  atan: 34,
  cvi: 35,
  cvr: 36,
  dup: 37,
  exch: 38,
  pop: 39,
  copy: 40,
  index: 41,
  roll: 42,
  if: 43,
  ifelse: 44,
  eof: 45,
  min: 46,
  max: 47
};
class Token {
  constructor(id, value = null) {
    this.id = id;
    this.value = value;
  }
}
class Lexer {
  static #singletons = null;
  static #operatorSingletons = null;
  static #initSingletons() {
    const singletons = Object.create(null);
    const operatorSingletons = Object.create(null);
    for (const [name, id] of Object.entries(TOKEN)) {
      if (name === "number") {
        continue;
      }
      const isOperator = id >= TOKEN.true && id <= TOKEN.ifelse;
      const token = new Token(id, isOperator ? name : null);
      singletons[name] = token;
      if (isOperator) {
        operatorSingletons[name] = token;
      }
    }
    this.#singletons = singletons;
    this.#operatorSingletons = operatorSingletons;
  }
  constructor(data) {
    if (!Lexer.#singletons) {
      Lexer.#initSingletons();
    }
    this.data = data;
    this.pos = 0;
    this.len = data.length;
    this._numberPattern = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iy;
    this._identifierPattern = /[a-z]+/y;
  }
  _skipComment() {
    const lf = this.data.indexOf("\n", this.pos);
    const cr = this.data.indexOf("\r", this.pos);
    const eol = Math.min(lf < 0 ? this.len : lf, cr < 0 ? this.len : cr);
    this.pos = Math.min(eol + 1, this.len);
  }
  _getNumber() {
    this._numberPattern.lastIndex = this.pos;
    const match = this._numberPattern.exec(this.data);
    if (!match) {
      this.pos++;
      return new Token(TOKEN.number, 0);
    }
    const number = parseFloat(match[0]);
    this.pos = this._numberPattern.lastIndex;
    return new Token(TOKEN.number, Number.isFinite(number) ? number : 0);
  }
  _getOperator() {
    this._identifierPattern.lastIndex = this.pos;
    const match = this._identifierPattern.exec(this.data);
    if (!match) {
      this.pos++;
      return new Token(TOKEN.number, 0);
    }
    this.pos = this._identifierPattern.lastIndex;
    const op = match[0];
    const token = Lexer.#operatorSingletons[op];
    return token ?? new Token(TOKEN.number, 0);
  }
  next() {
    while (this.pos < this.len) {
      const ch = this.data.charCodeAt(this.pos++);
      switch (ch) {
        case 0x00:
        case 0x09:
        case 0x0a:
        case 0x0c:
        case 0x0d:
        case 0x20:
          break;
        case 0x25:
          this._skipComment();
          break;
        case 0x7b:
          return Lexer.#singletons.lbrace;
        case 0x7d:
          return Lexer.#singletons.rbrace;
        case 0x2b:
        case 0x2d:
        case 0x2e:
          this.pos--;
          return this._getNumber();
        default:
          if (ch >= 0x30 && ch <= 0x39) {
            this.pos--;
            return this._getNumber();
          }
          if (ch >= 0x61 && ch <= 0x7a) {
            this.pos--;
            return this._getOperator();
          }
          return new Token(TOKEN.number, 0);
      }
    }
    return Lexer.#singletons.eof;
  }
}
export { Lexer, Token, TOKEN };