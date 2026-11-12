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
import "core-js/modules/es.typed-array.with.js";
import "core-js/modules/es.uint8-array.set-from-base64.js";
import "core-js/modules/es.uint8-array.set-from-hex.js";
import "core-js/modules/es.uint8-array.to-base64.js";
import "core-js/modules/es.uint8-array.to-hex.js";
import { parsePostScriptFunction, PS_NODE, PS_VALUE_TYPE, PSStackToTree } from "./ast.js";
import { stringToBytes } from "../../shared/util.js";
import { TOKEN } from "./lexer.js";
const OP = {
  if: 0x04,
  else: 0x05,
  end: 0x0b,
  select: 0x1b,
  call: 0x10,
  local_get: 0x20,
  local_set: 0x21,
  local_tee: 0x22,
  i32_const: 0x41,
  i32_eqz: 0x45,
  i32_and: 0x71,
  i32_or: 0x72,
  i32_xor: 0x73,
  i32_shl: 0x74,
  i32_shr_s: 0x75,
  i32_trunc_f64_s: 0xaa,
  f64_const: 0x44,
  f64_eq: 0x61,
  f64_ne: 0x62,
  f64_lt: 0x63,
  f64_gt: 0x64,
  f64_le: 0x65,
  f64_ge: 0x66,
  f64_abs: 0x99,
  f64_neg: 0x9a,
  f64_ceil: 0x9b,
  f64_floor: 0x9c,
  f64_trunc: 0x9d,
  f64_nearest: 0x9e,
  f64_sqrt: 0x9f,
  f64_add: 0xa0,
  f64_sub: 0xa1,
  f64_mul: 0xa2,
  f64_div: 0xa3,
  f64_min: 0xa4,
  f64_max: 0xa5,
  f64_convert_i32_s: 0xb7,
  f64_store: 0x39,
  prefix_fc: 0xfc
};
const FC_OP = {
  i32_trunc_sat_f64_u: 0x03
};
const FUNC_TYPE = 0x60;
const F64 = 0x7c;
const SECTION = {
  type: 0x01,
  import: 0x02,
  function: 0x03,
  memory: 0x05,
  export: 0x07,
  code: 0x0a
};
const EXTERN_FUNC = 0x00;
const EXTERN_MEM = 0x02;
function unsignedLEB128(n) {
  const out = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) {
      byte |= 0x80;
    }
    out.push(byte);
  } while (n !== 0);
  return out;
}
function encodeASCIIString(s) {
  return [...unsignedLEB128(s.length), ...stringToBytes(s)];
}
function section(id, data) {
  return [id, ...unsignedLEB128(data.length), ...data];
}
function vec(items) {
  const out = unsignedLEB128(items.length);
  for (const item of items) {
    if (typeof item === "number") {
      out.push(item);
      continue;
    }
    for (const byte of item) {
      out.push(byte);
    }
  }
  return out;
}
const MATH_IMPORTS = [["sin", "Math", "sin", [F64], [F64]], ["cos", "Math", "cos", [F64], [F64]], ["atan2", "Math", "atan2", [F64, F64], [F64]], ["log", "Math", "log", [F64], [F64]], ["log10", "Math", "log10", [F64], [F64]], ["pow", "Math", "pow", [F64, F64], [F64]]];
const _mathImportObject = {
  Math: Object.fromEntries(MATH_IMPORTS.map(([name]) => [name, Math[name]]))
};
class PsWasmCompiler {
  static #initialized = false;
  static #comparisonToOp = null;
  static #importIdx = null;
  static #degToRad = 0;
  static #radToDeg = 0;
  static #importTypeEntries = null;
  static #importSection = null;
  static #functionSection = null;
  static #memorySection = null;
  static #exportSection = null;
  static #wasmMagicVersion = null;
  static #f64View = null;
  static #f64Arr = null;
  static #init() {
    this.#comparisonToOp = new Map([[TOKEN.eq, OP.f64_eq], [TOKEN.ne, OP.f64_ne], [TOKEN.lt, OP.f64_lt], [TOKEN.le, OP.f64_le], [TOKEN.gt, OP.f64_gt], [TOKEN.ge, OP.f64_ge]]);
    this.#importIdx = Object.create(null);
    for (let i = 0; i < MATH_IMPORTS.length; i++) {
      this.#importIdx[MATH_IMPORTS[i][0]] = i;
    }
    this.#degToRad = Math.PI / 180;
    this.#radToDeg = 180 / Math.PI;
    this.#importTypeEntries = MATH_IMPORTS.map(([,,, params, results]) => [FUNC_TYPE, ...vec(params), ...vec(results)]);
    this.#importSection = new Uint8Array(section(SECTION.import, vec(MATH_IMPORTS.map(([, mod, field], i) => [...encodeASCIIString(mod), ...encodeASCIIString(field), EXTERN_FUNC, ...unsignedLEB128(i + 1)]))));
    this.#functionSection = new Uint8Array(section(SECTION.function, vec([[0]])));
    this.#memorySection = new Uint8Array(section(SECTION.memory, vec([[0x00, 0x01]])));
    this.#exportSection = new Uint8Array(section(SECTION.export, vec([[...encodeASCIIString("fn"), EXTERN_FUNC, ...unsignedLEB128(MATH_IMPORTS.length)], [...encodeASCIIString("mem"), EXTERN_MEM, 0x00]])));
    this.#wasmMagicVersion = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    const f64Buf = new ArrayBuffer(8);
    this.#f64View = new DataView(f64Buf);
    this.#f64Arr = new Uint8Array(f64Buf);
    this.#initialized = true;
  }
  constructor(domain, range) {
    if (!PsWasmCompiler.#initialized) {
      PsWasmCompiler.#init();
    }
    this._nIn = domain.length >> 1;
    this._nOut = range.length >> 1;
    this._range = range;
    this._code = [];
    this._nextLocal = this._nIn;
    this._freeLocals = [];
    this._sharedLocals = new Map();
  }
  _allocLocal() {
    return this._freeLocals.pop() ?? this._nextLocal++;
  }
  _releaseLocal(idx) {
    this._freeLocals.push(idx);
  }
  _emitULEB128(n) {
    do {
      let b = n & 0x7f;
      n >>>= 7;
      if (n !== 0) {
        b |= 0x80;
      }
      this._code.push(b);
    } while (n !== 0);
  }
  _emitSLEB128(n) {
    for (;;) {
      const b = n & 0x7f;
      n >>= 7;
      if (n === 0 && (b & 0x40) === 0 || n === -1 && (b & 0x40) !== 0) {
        this._code.push(b);
        return;
      }
      this._code.push(b | 0x80);
    }
  }
  _emitF64Const(value) {
    this._code.push(OP.f64_const);
    PsWasmCompiler.#f64View.setFloat64(0, value, true);
    for (let i = 0; i < 8; i++) {
      this._code.push(PsWasmCompiler.#f64Arr[i]);
    }
  }
  _emitLocalGet(idx) {
    this._code.push(OP.local_get);
    this._emitULEB128(idx);
  }
  _emitLocalSet(idx) {
    this._code.push(OP.local_set);
    this._emitULEB128(idx);
  }
  _emitLocalTee(idx) {
    this._code.push(OP.local_tee);
    this._emitULEB128(idx);
  }
  _emitToInt32() {
    const code = this._code;
    const local = this._allocLocal();
    code.push(OP.f64_trunc);
    this._emitLocalTee(local);
    this._emitLocalGet(local);
    this._emitF64Const(2 ** -32);
    code.push(OP.f64_mul, OP.f64_floor);
    this._emitF64Const(2 ** 32);
    code.push(OP.f64_mul, OP.f64_sub, OP.prefix_fc, FC_OP.i32_trunc_sat_f64_u);
    this._releaseLocal(local);
  }
  _compileNode(node) {
    if (node.shared) {
      const entry = this._sharedLocals.get(node);
      if (entry !== undefined) {
        this._emitLocalGet(entry.local);
        if (--entry.remaining === 0) {
          this._releaseLocal(entry.local);
        }
        return true;
      }
      if (!this._compileNodeImpl(node)) {
        return false;
      }
      const local = this._allocLocal();
      this._sharedLocals.set(node, {
        local,
        remaining: node.sharedCount - 1
      });
      this._emitLocalTee(local);
      return true;
    }
    return this._compileNodeImpl(node);
  }
  _compileNodeImpl(node) {
    switch (node.type) {
      case PS_NODE.arg:
        this._emitLocalGet(node.index);
        return true;
      case PS_NODE.const:
        {
          let v = node.value;
          if (typeof v === "boolean") {
            v = v ? 1 : 0;
          }
          this._emitF64Const(v);
          return true;
        }
      case PS_NODE.unary:
        return this._compileUnaryNode(node);
      case PS_NODE.binary:
        return this._compileBinaryNode(node);
      case PS_NODE.ternary:
        return this._compileTernaryNode(node);
      default:
        return false;
    }
  }
  _compileSinCosNode(node) {
    const local = this._allocLocal();
    try {
      if (!this._compileNode(node.operand)) {
        return false;
      }
      const code = this._code;
      this._emitLocalSet(local);
      this._emitLocalGet(local);
      this._emitLocalGet(local);
      this._emitF64Const(360);
      code.push(OP.f64_div, OP.f64_trunc);
      this._emitF64Const(360);
      code.push(OP.f64_mul, OP.f64_sub);
      this._emitF64Const(PsWasmCompiler.#degToRad);
      code.push(OP.f64_mul, OP.call);
      this._emitULEB128(PsWasmCompiler.#importIdx[node.op === TOKEN.sin ? "sin" : "cos"]);
      return true;
    } finally {
      this._releaseLocal(local);
    }
  }
  _compileUnaryNode(node) {
    const code = this._code;
    if (node.op === TOKEN.sin || node.op === TOKEN.cos) {
      return this._compileSinCosNode(node);
    }
    if (node.op === TOKEN.not) {
      if (node.valueType === PS_VALUE_TYPE.boolean) {
        if (!this._compileNodeAsBoolI32(node.operand)) {
          return false;
        }
        code.push(OP.i32_eqz, OP.f64_convert_i32_s);
        return true;
      }
      if (node.valueType === PS_VALUE_TYPE.numeric) {
        if (!this._compileNode(node.operand)) {
          return false;
        }
        this._emitToInt32();
        code.push(OP.i32_const, 0x7f, OP.i32_xor, OP.f64_convert_i32_s);
        return true;
      }
      return false;
    }
    if (!this._compileNode(node.operand)) {
      return false;
    }
    switch (node.op) {
      case TOKEN.abs:
        code.push(OP.f64_abs);
        break;
      case TOKEN.neg:
        code.push(OP.f64_neg);
        break;
      case TOKEN.sqrt:
        code.push(OP.f64_sqrt);
        break;
      case TOKEN.floor:
        code.push(OP.f64_floor);
        break;
      case TOKEN.ceiling:
        code.push(OP.f64_ceil);
        break;
      case TOKEN.round:
        this._emitF64Const(0.5);
        code.push(OP.f64_add, OP.f64_floor);
        break;
      case TOKEN.truncate:
        code.push(OP.f64_trunc);
        break;
      case TOKEN.cvi:
        this._emitToInt32();
        code.push(OP.f64_convert_i32_s);
        break;
      case TOKEN.cvr:
        break;
      case TOKEN.ln:
        code.push(OP.call);
        this._emitULEB128(PsWasmCompiler.#importIdx.log);
        break;
      case TOKEN.log:
        code.push(OP.call);
        this._emitULEB128(PsWasmCompiler.#importIdx.log10);
        break;
      default:
        return false;
    }
    return true;
  }
  _compileSafeDivNode(first, second) {
    const tmp = this._allocLocal();
    try {
      if (!this._compileNode(second) || !this._compileNode(first)) {
        return false;
      }
      const code = this._code;
      this._emitLocalTee(tmp);
      code.push(OP.f64_div);
      this._emitF64Const(0);
      this._emitLocalGet(tmp);
      this._emitF64Const(0);
      code.push(OP.f64_ne, OP.select);
      return true;
    } finally {
      this._releaseLocal(tmp);
    }
  }
  _compileSafeIdivNode(first, second) {
    const tmp = this._allocLocal();
    try {
      if (!this._compileNode(second) || !this._compileNode(first)) {
        return false;
      }
      const code = this._code;
      this._emitLocalTee(tmp);
      code.push(OP.f64_div, OP.f64_trunc);
      this._emitF64Const(0);
      this._emitLocalGet(tmp);
      this._emitF64Const(0);
      code.push(OP.f64_ne, OP.select);
      return true;
    } finally {
      this._releaseLocal(tmp);
    }
  }
  _compileBitshiftNode(first, second) {
    if (first.type !== PS_NODE.const || !Number.isInteger(first.value) || !this._compileNode(second)) {
      return false;
    }
    const code = this._code;
    this._emitToInt32();
    const shift = first.value;
    if (shift > 0) {
      code.push(OP.i32_const);
      this._emitSLEB128(shift);
      code.push(OP.i32_shl);
    } else if (shift < 0) {
      code.push(OP.i32_const);
      this._emitSLEB128(-shift);
      code.push(OP.i32_shr_s);
    }
    code.push(OP.f64_convert_i32_s);
    return true;
  }
  _compileModNode(first, second) {
    if (first.type === PS_NODE.const && first.value === 0) {
      this._emitF64Const(0);
      return true;
    }
    const localA = this._allocLocal();
    try {
      if (!this._compileNode(second)) {
        return false;
      }
      this._emitLocalTee(localA);
      const code = this._code;
      if (first.type === PS_NODE.const) {
        this._emitLocalGet(localA);
        this._emitF64Const(first.value);
        code.push(OP.f64_div, OP.f64_trunc);
        this._emitF64Const(first.value);
        code.push(OP.f64_mul, OP.f64_sub);
      } else {
        const localB = this._allocLocal();
        try {
          if (!this._compileNode(first)) {
            return false;
          }
          this._emitLocalSet(localB);
          this._emitLocalGet(localA);
          this._emitLocalGet(localB);
          code.push(OP.f64_div, OP.f64_trunc);
          this._emitLocalGet(localB);
          code.push(OP.f64_mul, OP.f64_sub);
          this._emitF64Const(0);
          this._emitLocalGet(localB);
          this._emitF64Const(0);
          code.push(OP.f64_ne, OP.select);
        } finally {
          this._releaseLocal(localB);
        }
      }
      return true;
    } finally {
      this._releaseLocal(localA);
    }
  }
  _compileAtanNode(first, second) {
    const localR = this._allocLocal();
    try {
      if (!this._compileNode(second) || !this._compileNode(first)) {
        return false;
      }
      const code = this._code;
      code.push(OP.call);
      this._emitULEB128(PsWasmCompiler.#importIdx.atan2);
      this._emitF64Const(PsWasmCompiler.#radToDeg);
      code.push(OP.f64_mul);
      this._emitLocalTee(localR);
      this._emitF64Const(0);
      code.push(OP.f64_lt, OP.if, F64);
      this._emitLocalGet(localR);
      this._emitF64Const(360);
      code.push(OP.f64_add, OP.else);
      this._emitLocalGet(localR);
      code.push(OP.end);
      return true;
    } finally {
      this._releaseLocal(localR);
    }
  }
  _compileBitwiseNode(op, first, second) {
    if (!this._compileBitwiseOperandI32(second) || !this._compileBitwiseOperandI32(first)) {
      return false;
    }
    const code = this._code;
    switch (op) {
      case TOKEN.and:
        code.push(OP.i32_and);
        break;
      case TOKEN.or:
        code.push(OP.i32_or);
        break;
      case TOKEN.xor:
        code.push(OP.i32_xor);
        break;
      default:
        return false;
    }
    code.push(OP.f64_convert_i32_s);
    return true;
  }
  _compileBitwiseOperandI32(node) {
    if (node.valueType === PS_VALUE_TYPE.boolean) {
      return this._compileNodeAsBoolI32(node);
    }
    if (!this._compileNode(node)) {
      return false;
    }
    this._emitToInt32();
    return true;
  }
  _compileStandardBinaryNode(op, first, second) {
    if (first === second && first.type !== PS_NODE.arg && first.type !== PS_NODE.const && !first.shared) {
      const tmp = this._allocLocal();
      try {
        if (!this._compileNode(first)) {
          return false;
        }
        this._emitLocalTee(tmp);
        this._emitLocalGet(tmp);
      } finally {
        this._releaseLocal(tmp);
      }
    } else if (!this._compileNode(second) || !this._compileNode(first)) {
      return false;
    }
    const code = this._code;
    switch (op) {
      case TOKEN.add:
        code.push(OP.f64_add);
        break;
      case TOKEN.sub:
        code.push(OP.f64_sub);
        break;
      case TOKEN.mul:
        code.push(OP.f64_mul);
        break;
      case TOKEN.exp:
        code.push(OP.call);
        this._emitULEB128(PsWasmCompiler.#importIdx.pow);
        break;
      case TOKEN.eq:
        code.push(OP.f64_eq, OP.f64_convert_i32_s);
        break;
      case TOKEN.ne:
        code.push(OP.f64_ne, OP.f64_convert_i32_s);
        break;
      case TOKEN.lt:
        code.push(OP.f64_lt, OP.f64_convert_i32_s);
        break;
      case TOKEN.le:
        code.push(OP.f64_le, OP.f64_convert_i32_s);
        break;
      case TOKEN.gt:
        code.push(OP.f64_gt, OP.f64_convert_i32_s);
        break;
      case TOKEN.ge:
        code.push(OP.f64_ge, OP.f64_convert_i32_s);
        break;
      case TOKEN.min:
        code.push(OP.f64_min);
        break;
      case TOKEN.max:
        code.push(OP.f64_max);
        break;
      default:
        return false;
    }
    return true;
  }
  _compileBinaryNode(node) {
    const {
      op,
      first,
      second
    } = node;
    if (op === TOKEN.bitshift) {
      return this._compileBitshiftNode(first, second);
    }
    if (op === TOKEN.div) {
      return this._compileSafeDivNode(first, second);
    }
    if (op === TOKEN.idiv) {
      return this._compileSafeIdivNode(first, second);
    }
    if (op === TOKEN.mod) {
      return this._compileModNode(first, second);
    }
    if (op === TOKEN.atan) {
      return this._compileAtanNode(first, second);
    }
    return op === TOKEN.and || op === TOKEN.or || op === TOKEN.xor ? this._compileBitwiseNode(op, first, second) : this._compileStandardBinaryNode(op, first, second);
  }
  _compileNodeAsBoolI32(node) {
    if (node.type === PS_NODE.binary) {
      const wasmOp = PsWasmCompiler.#comparisonToOp.get(node.op);
      if (wasmOp !== undefined) {
        if (!this._compileNode(node.second) || !this._compileNode(node.first)) {
          return false;
        }
        this._code.push(wasmOp);
        return true;
      }
      if (node.valueType === PS_VALUE_TYPE.boolean && (node.op === TOKEN.and || node.op === TOKEN.or || node.op === TOKEN.xor)) {
        if (!this._compileNodeAsBoolI32(node.second) || !this._compileNodeAsBoolI32(node.first)) {
          return false;
        }
        switch (node.op) {
          case TOKEN.and:
            this._code.push(OP.i32_and);
            break;
          case TOKEN.or:
            this._code.push(OP.i32_or);
            break;
          case TOKEN.xor:
            this._code.push(OP.i32_xor);
            break;
        }
        return true;
      }
    }
    if (node.type === PS_NODE.unary && node.op === TOKEN.not && node.valueType === PS_VALUE_TYPE.boolean) {
      if (!this._compileNodeAsBoolI32(node.operand)) {
        return false;
      }
      this._code.push(OP.i32_eqz);
      return true;
    }
    if (!this._compileNode(node)) {
      return false;
    }
    if (node.valueType === PS_VALUE_TYPE.boolean) {
      this._code.push(OP.i32_trunc_f64_s);
    } else {
      this._emitF64Const(0);
      this._code.push(OP.f64_ne);
    }
    return true;
  }
  _compileTernaryNode(node) {
    if (!this._compileNodeAsBoolI32(node.cond)) {
      return false;
    }
    this._code.push(OP.if, F64);
    if (!this._compileNode(node.then)) {
      return false;
    }
    this._code.push(OP.else);
    if (!this._compileNode(node.otherwise)) {
      return false;
    }
    this._code.push(OP.end);
    return true;
  }
  compile(program) {
    const outputs = new PSStackToTree().evaluate(program, this._nIn);
    if (!outputs || outputs.length < this._nOut) {
      return null;
    }
    const code = this._code;
    for (let i = 0; i < this._nOut; i++) {
      const min = this._range[i * 2];
      const max = this._range[i * 2 + 1];
      code.push(OP.i32_const);
      this._emitSLEB128(i * 8);
      if (!this._compileNode(outputs[i])) {
        return null;
      }
      this._emitF64Const(max);
      code.push(OP.f64_min);
      this._emitF64Const(min);
      code.push(OP.f64_max, OP.f64_store, 0x03, 0x00);
    }
    code.push(OP.end);
    const nIn = this._nIn;
    const nLocals = this._nextLocal - nIn;
    const paramTypes = Array(nIn).fill(F64);
    const resultTypes = [];
    const funcType = [FUNC_TYPE, ...vec(paramTypes), ...vec(resultTypes)];
    const typeSectionBytes = new Uint8Array(section(SECTION.type, vec([funcType, ...PsWasmCompiler.#importTypeEntries])));
    const localDecls = nLocals > 0 ? vec([[...unsignedLEB128(nLocals), F64]]) : vec([]);
    const funcBodyLen = localDecls.length + code.length;
    const codeSectionBytes = new Uint8Array(section(SECTION.code, vec([[...unsignedLEB128(funcBodyLen), ...localDecls, ...code]])));
    const magicVersion = PsWasmCompiler.#wasmMagicVersion;
    const importSection = PsWasmCompiler.#importSection;
    const functionSection = PsWasmCompiler.#functionSection;
    const memorySection = PsWasmCompiler.#memorySection;
    const exportSection = PsWasmCompiler.#exportSection;
    const totalLen = magicVersion.length + typeSectionBytes.length + importSection.length + functionSection.length + memorySection.length + exportSection.length + codeSectionBytes.length;
    const result = new Uint8Array(totalLen);
    let off = 0;
    result.set(magicVersion, off);
    off += magicVersion.length;
    result.set(typeSectionBytes, off);
    off += typeSectionBytes.length;
    result.set(importSection, off);
    off += importSection.length;
    result.set(functionSection, off);
    off += functionSection.length;
    result.set(memorySection, off);
    off += memorySection.length;
    result.set(exportSection, off);
    off += exportSection.length;
    result.set(codeSectionBytes, off);
    return result;
  }
}
function compilePostScriptToWasm(source, domain, range) {
  return new PsWasmCompiler(domain, range).compile(parsePostScriptFunction(source));
}
function _makeWrapper(exports, nIn, nOut) {
  const {
    fn,
    mem
  } = exports;
  const outView = new Float64Array(mem.buffer, 0, nOut);
  let writeOut;
  switch (nOut) {
    case 1:
      writeOut = (dest, destOffset) => {
        dest[destOffset] = outView[0];
      };
      break;
    case 2:
      writeOut = (dest, destOffset) => {
        dest[destOffset] = outView[0];
        dest[destOffset + 1] = outView[1];
      };
      break;
    case 3:
      writeOut = (dest, destOffset) => {
        dest[destOffset] = outView[0];
        dest[destOffset + 1] = outView[1];
        dest[destOffset + 2] = outView[2];
      };
      break;
    case 4:
      writeOut = (dest, destOffset) => {
        dest[destOffset] = outView[0];
        dest[destOffset + 1] = outView[1];
        dest[destOffset + 2] = outView[2];
        dest[destOffset + 3] = outView[3];
      };
      break;
    default:
      writeOut = (dest, destOffset) => {
        for (let i = 0; i < nOut; i++) {
          dest[destOffset + i] = outView[i];
        }
      };
  }
  switch (nIn) {
    case 1:
      return (src, srcOffset, dest, destOffset) => {
        fn(src[srcOffset]);
        writeOut(dest, destOffset);
      };
    case 2:
      return (src, srcOffset, dest, destOffset) => {
        fn(src[srcOffset], src[srcOffset + 1]);
        writeOut(dest, destOffset);
      };
    case 3:
      return (src, srcOffset, dest, destOffset) => {
        fn(src[srcOffset], src[srcOffset + 1], src[srcOffset + 2]);
        writeOut(dest, destOffset);
      };
    case 4:
      return (src, srcOffset, dest, destOffset) => {
        fn(src[srcOffset], src[srcOffset + 1], src[srcOffset + 2], src[srcOffset + 3]);
        writeOut(dest, destOffset);
      };
    default:
      {
        const inBuf = new Float64Array(nIn);
        return (src, srcOffset, dest, destOffset) => {
          for (let i = 0; i < nIn; i++) {
            inBuf[i] = src[srcOffset + i];
          }
          fn(...inBuf);
          writeOut(dest, destOffset);
        };
      }
  }
}
function buildPostScriptWasmFunction(source, domain, range) {
  const bytes = compilePostScriptToWasm(source, domain, range);
  if (!bytes) {
    return null;
  }
  try {
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), _mathImportObject);
    return _makeWrapper(instance.exports, domain.length >> 1, range.length >> 1);
  } catch {
    return null;
  }
}
export { buildPostScriptWasmFunction, compilePostScriptToWasm };