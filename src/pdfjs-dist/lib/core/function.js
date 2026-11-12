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
import "core-js/modules/es.typed-array.with.js";
import { Dict, Ref } from "./primitives.js";
import { FormatError, info, shadow, warn } from "../shared/util.js";
import { BaseStream } from "./base_stream.js";
import { buildPostScriptJsFunction } from "./postscript/js_evaluator.js";
import { buildPostScriptWasmFunction } from "./postscript/wasm_compiler.js";
import { isNumberArray } from "./core_utils.js";
import { LocalFunctionCache } from "./image_utils.js";
import { MathClamp } from "../shared/math_clamp.js";
const FunctionType = {
  SAMPLED: 0,
  EXPONENTIAL_INTERPOLATION: 2,
  STITCHING: 3,
  POSTSCRIPT_CALCULATOR: 4
};
class PDFFunctionFactory {
  static #useWasm = true;
  static setOptions({
    useWasm
  }) {
    this.#useWasm = useWasm;
  }
  constructor({
    xref
  }) {
    this.xref = xref;
  }
  get useWasm() {
    return PDFFunctionFactory.#useWasm;
  }
  create(fn, parseArray = false) {
    let fnRef, parsedFn;
    if (fn instanceof Ref) {
      fnRef = fn;
    } else if (fn instanceof Dict) {
      fnRef = fn.objId;
    } else if (fn instanceof BaseStream) {
      fnRef = fn.dict?.objId;
    }
    if (fnRef) {
      const cachedFn = this._localFunctionCache.getByRef(fnRef);
      if (cachedFn) {
        return cachedFn;
      }
    }
    const fnObj = this.xref.fetchIfRef(fn);
    if (Array.isArray(fnObj)) {
      if (!parseArray) {
        throw new Error('PDFFunctionFactory.create - expected "parseArray" argument.');
      }
      parsedFn = PDFFunction.parseArray(this, fnObj);
    } else {
      parsedFn = PDFFunction.parse(this, fnObj);
    }
    if (fnRef) {
      this._localFunctionCache.set(null, fnRef, parsedFn);
    }
    return parsedFn;
  }
  get _localFunctionCache() {
    return shadow(this, "_localFunctionCache", new LocalFunctionCache());
  }
}
function toNumberArray(arr) {
  if (!Array.isArray(arr)) {
    return null;
  }
  if (!isNumberArray(arr, null)) {
    return arr.map(x => +x);
  }
  return arr;
}
function setArity(fn, numInputs, numOutputs) {
  fn.numInputs = numInputs;
  fn.numOutputs = numOutputs;
  return fn;
}
function interpolate(x, xmin, xmax, ymin, ymax) {
  return xmin === xmax ? ymin : ymin + (x - xmin) * ((ymax - ymin) / (xmax - xmin));
}
class PDFFunction {
  static MAX_MULTILINEAR_INPUTS = 8;
  static getSampleArray(size, outputSize, bps, stream) {
    let length = outputSize;
    for (const s of size) {
      length *= s;
    }
    const array = new Array(length);
    let codeSize = 0;
    let codeBuf = 0;
    const sampleMul = 1.0 / (2.0 ** bps - 1);
    const strBytes = stream.getBytes((length * bps + 7) / 8);
    let strIdx = 0;
    for (let i = 0; i < length; i++) {
      while (codeSize < bps) {
        codeBuf <<= 8;
        codeBuf |= strBytes[strIdx++];
        codeSize += 8;
      }
      codeSize -= bps;
      array[i] = (codeBuf >> codeSize) * sampleMul;
      codeBuf &= (1 << codeSize) - 1;
    }
    return array;
  }
  static parse(factory, fn) {
    const dict = fn.dict || fn;
    const typeNum = dict.get("FunctionType");
    switch (typeNum) {
      case FunctionType.SAMPLED:
        return this.constructSampled(factory, fn, dict);
      case FunctionType.EXPONENTIAL_INTERPOLATION:
        return this.constructInterpolated(factory, dict);
      case FunctionType.STITCHING:
        return this.constructStitched(factory, dict);
      case FunctionType.POSTSCRIPT_CALCULATOR:
        return this.constructPostScript(factory, fn, dict);
    }
    throw new FormatError(`Unknown function type: ${typeNum}`);
  }
  static parseArray(factory, fnObj) {
    const {
      xref
    } = factory;
    const fnArray = [];
    for (const fn of fnObj) {
      fnArray.push(this.parse(factory, xref.fetchIfRef(fn)));
    }
    if (fnArray.length === 1) {
      return fnArray[0];
    }
    const numInputs = fnArray[0]?.numInputs ?? 0;
    if (fnArray.some(fn => fn.numInputs !== numInputs || fn.numOutputs !== 1)) {
      throw new FormatError("Invalid array of functions.");
    }
    return setArity(function (src, srcOffset, dest, destOffset) {
      for (let i = 0, ii = fnArray.length; i < ii; i++) {
        fnArray[i](src, srcOffset, dest, destOffset + i);
      }
    }, numInputs, fnArray.length);
  }
  static constructSampled(factory, fn, dict) {
    const domain = toNumberArray(dict.getArray("Domain"));
    const range = toNumberArray(dict.getArray("Range"));
    if (!domain || !range) {
      throw new FormatError("No domain or range");
    }
    const inputSize = domain.length / 2;
    const outputSize = range.length / 2;
    const size = toNumberArray(dict.getArray("Size"));
    const bps = dict.get("BitsPerSample");
    const order = dict.get("Order") || 1;
    if (order !== 1) {
      info("No support for cubic spline interpolation: " + order);
    }
    let encode = toNumberArray(dict.getArray("Encode"));
    if (!encode) {
      encode = [];
      for (let i = 0; i < inputSize; ++i) {
        encode.push(0, size[i] - 1);
      }
    }
    const decode = toNumberArray(dict.getArray("Decode")) || range;
    const samples = this.getSampleArray(size, outputSize, bps, fn);
    const useSimplex = inputSize > PDFFunction.MAX_MULTILINEAR_INPUTS;
    const steps = new Float64Array(inputSize);
    const weights0 = new Float64Array(inputSize);
    const weights1 = new Float64Array(inputSize);
    const sorted = useSimplex ? new Uint32Array(inputSize) : null;
    const maxVertices = useSimplex ? inputSize + 1 : 1 << inputSize;
    const vertices = new Uint32Array(maxVertices);
    const vertexWeights = new Float64Array(maxVertices);
    function constructSampledFn(src, srcOffset, dest, destOffset) {
      let base = 0,
        k = outputSize,
        numActive = 0;
      for (let i = 0; i < inputSize; ++i) {
        const domain_2i = domain[2 * i];
        const domain_2i_1 = domain[2 * i + 1];
        const xi = MathClamp(src[srcOffset + i], domain_2i, domain_2i_1);
        let e = interpolate(xi, domain_2i, domain_2i_1, encode[2 * i], encode[2 * i + 1]);
        const size_i = size[i];
        e = MathClamp(e, 0, size_i - 1);
        const e0 = Math.floor(e);
        base += e0 * k;
        if (e !== e0) {
          steps[numActive] = k;
          weights0[numActive] = e0 + 1 - e;
          weights1[numActive] = e - e0;
          numActive++;
        }
        k *= size_i;
      }
      vertices[0] = base;
      vertexWeights[0] = 1;
      let numVertices = 1;
      if (!useSimplex) {
        for (let i = 0; i < numActive; i++) {
          const step = steps[i],
            w0 = weights0[i],
            w1 = weights1[i];
          for (let j = 0; j < numVertices; j++) {
            vertices[numVertices + j] = vertices[j] + step;
            vertexWeights[numVertices + j] = vertexWeights[j] * w1;
            vertexWeights[j] *= w0;
          }
          numVertices <<= 1;
        }
      } else if (numActive > 0) {
        for (let i = 0; i < numActive; i++) {
          const w1 = weights1[i];
          let j = i;
          for (; j > 0 && weights1[sorted[j - 1]] < w1; j--) {
            sorted[j] = sorted[j - 1];
          }
          sorted[j] = i;
        }
        vertexWeights[0] = weights0[sorted[0]];
        for (let i = 0; i < numActive; i++) {
          const a = sorted[i];
          vertices[i + 1] = vertices[i] + steps[a];
          vertexWeights[i + 1] = i + 1 < numActive ? weights1[a] - weights1[sorted[i + 1]] : weights1[a];
        }
        numVertices = numActive + 1;
      }
      for (let j = 0; j < outputSize; ++j) {
        let rj = 0;
        for (let i = 0; i < numVertices; i++) {
          rj += samples[vertices[i] + j] * vertexWeights[i];
        }
        rj = interpolate(rj, 0, 1, decode[2 * j], decode[2 * j + 1]);
        dest[destOffset + j] = MathClamp(rj, range[2 * j], range[2 * j + 1]);
      }
    }
    return setArity(constructSampledFn, inputSize, outputSize);
  }
  static constructInterpolated(factory, dict) {
    const domain = toNumberArray(dict.getArray("Domain"));
    const c0 = toNumberArray(dict.getArray("C0")) || [0];
    const c1 = toNumberArray(dict.getArray("C1")) || [1];
    const n = dict.get("N");
    const diff = [];
    for (let i = 0, ii = c0.length; i < ii; ++i) {
      diff.push(c1[i] - c0[i]);
    }
    const length = diff.length;
    function constructInterpolatedFn(src, srcOffset, dest, destOffset) {
      const x = n === 1 ? src[srcOffset] : src[srcOffset] ** n;
      for (let j = 0; j < length; ++j) {
        dest[destOffset + j] = c0[j] + x * diff[j];
      }
    }
    return setArity(constructInterpolatedFn, domain ? domain.length / 2 : 1, length);
  }
  static constructStitched(factory, dict) {
    const domain = toNumberArray(dict.getArray("Domain"));
    if (!domain) {
      throw new FormatError("No domain");
    }
    const inputSize = domain.length / 2;
    if (inputSize !== 1) {
      throw new FormatError("Bad domain for stitched function");
    }
    const {
      xref
    } = factory;
    const fns = [];
    for (const fn of dict.get("Functions")) {
      fns.push(this.parse(factory, xref.fetchIfRef(fn)));
    }
    const numOutputs = fns[0]?.numOutputs ?? 0;
    if (fns.length === 0 || fns.some(fn => fn.numInputs !== 1 || fn.numOutputs !== numOutputs)) {
      throw new FormatError("Incompatible sub-functions for stitched function");
    }
    const bounds = toNumberArray(dict.getArray("Bounds"));
    const encode = toNumberArray(dict.getArray("Encode"));
    const tmpBuf = new Float32Array(1);
    function constructStitchedFn(src, srcOffset, dest, destOffset) {
      const v = MathClamp(src[srcOffset], domain[0], domain[1]);
      const length = bounds.length;
      let i;
      for (i = 0; i < length; ++i) {
        if (v < bounds[i]) {
          break;
        }
      }
      const dmin = i > 0 ? bounds[i - 1] : domain[0];
      const dmax = i < length ? bounds[i] : domain[1];
      tmpBuf[0] = interpolate(v, dmin, dmax, encode[2 * i], encode[2 * i + 1]);
      fns[i](tmpBuf, 0, dest, destOffset);
    }
    return setArity(constructStitchedFn, inputSize, numOutputs);
  }
  static constructPostScript(factory, fn, dict) {
    const domain = toNumberArray(dict.getArray("Domain"));
    const range = toNumberArray(dict.getArray("Range"));
    if (!domain) {
      throw new FormatError("No domain.");
    }
    if (!range) {
      throw new FormatError("No range.");
    }
    const psCode = fn.getString();
    const numInputs = domain.length / 2,
      numOutputs = range.length / 2;
    try {
      if (factory.useWasm) {
        const wasmFn = buildPostScriptWasmFunction(psCode, domain, range);
        if (wasmFn) {
          return setArity(wasmFn, numInputs, numOutputs);
        }
      }
    } catch {}
    warn("Failed to compile PostScript function to wasm, falling back to JS");
    return setArity(buildPostScriptJsFunction(psCode, domain, range), numInputs, numOutputs);
  }
}
function isPDFFunction(v) {
  let fnDict;
  if (v instanceof Dict) {
    fnDict = v;
  } else if (v instanceof BaseStream) {
    fnDict = v.dict;
  } else {
    return false;
  }
  return fnDict.has("FunctionType");
}
export { FunctionType, isPDFFunction, PDFFunctionFactory };