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
import { assert, makeArr, shadow, unreachable } from "../shared/util.js";
const CIRCULAR_REF = Symbol("CIRCULAR_REF");
const EOF = Symbol("EOF");
const CmdCache = new Map();
const NameCache = new Map();
const RefCache = new Map();
function clearPrimitiveCaches() {
  CmdCache.clear();
  NameCache.clear();
  RefCache.clear();
}
class Name {
  constructor(name) {
    this.name = name;
  }
  static get(name) {
    let n = NameCache.get(name);
    if (!n) {
      n = new Name(name);
      NameCache.set(name, n);
    }
    return n;
  }
}
class Cmd {
  constructor(cmd) {
    this.cmd = cmd;
  }
  static get(cmd) {
    let c = CmdCache.get(cmd);
    if (!c) {
      c = new Cmd(cmd);
      CmdCache.set(cmd, c);
    }
    return c;
  }
}
const nonSerializable = () => nonSerializable;
class Dict {
  __nonSerializable__ = nonSerializable;
  #map = new Map();
  objId = null;
  suppressEncryption = false;
  xref;
  constructor(xref = null) {
    this.xref = xref;
  }
  assignXref(newXref) {
    this.xref = newXref;
  }
  get size() {
    return this.#map.size;
  }
  #getValue(isAsync, key1, key2) {
    let value = this.#map.get(key1);
    if (value === undefined && key2 !== undefined) {
      value = this.#map.get(key2);
    }
    if (value instanceof Ref && this.xref) {
      return isAsync ? this.xref.fetchAsync(value, this.suppressEncryption) : this.xref.fetch(value, this.suppressEncryption);
    }
    return value;
  }
  get(key1, key2) {
    return this.#getValue(false, key1, key2);
  }
  async getAsync(key1, key2) {
    return this.#getValue(true, key1, key2);
  }
  getArray(key1, key2) {
    let value = this.#getValue(false, key1, key2);
    if (Array.isArray(value)) {
      value = value.slice();
      for (let i = 0, ii = value.length; i < ii; i++) {
        if (value[i] instanceof Ref && this.xref) {
          value[i] = this.xref.fetch(value[i], this.suppressEncryption);
        }
      }
    }
    return value;
  }
  getRaw(key) {
    return this.#map.get(key);
  }
  getKeys() {
    return this.#map.keys();
  }
  getRawValues() {
    return this.#map.values();
  }
  getRawEntries() {
    return this.#map.entries();
  }
  set(key, value) {
    this.#map.set(key, value);
  }
  setIfNotExists(key, value) {
    if (!this.has(key)) {
      this.set(key, value);
    }
  }
  setIfNumber(key, value) {
    if (typeof value === "number") {
      this.set(key, value);
    }
  }
  setIfArray(key, value) {
    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
      this.set(key, value);
    }
  }
  setIfDefined(key, value) {
    if (value !== undefined && value !== null) {
      this.set(key, value);
    }
  }
  setIfName(key, value) {
    if (typeof value === "string") {
      this.set(key, Name.get(value));
    } else if (value instanceof Name) {
      this.set(key, value);
    }
  }
  setIfDict(key, value) {
    if (value instanceof Dict) {
      this.set(key, value);
    }
  }
  has(key) {
    return this.#map.has(key);
  }
  *[Symbol.iterator]() {
    for (const [key, value] of this.#map) {
      yield [key, value instanceof Ref && this.xref ? this.xref.fetch(value, this.suppressEncryption) : value];
    }
  }
  static get empty() {
    const emptyDict = new Dict(null);
    emptyDict.set = (key, value) => {
      unreachable("Should not call `set` on the empty dictionary.");
    };
    return shadow(this, "empty", emptyDict);
  }
  static merge({
    xref,
    dictArray,
    mergeSubDicts = false
  }) {
    const mergedDict = new Dict(xref),
      properties = new Map();
    for (const dict of dictArray) {
      if (!(dict instanceof Dict)) {
        continue;
      }
      for (const [key, value] of dict.getRawEntries()) {
        const property = properties.getOrInsertComputed(key, makeArr);
        if (property.length && !(mergeSubDicts && value instanceof Dict)) {
          continue;
        }
        property.push(value);
      }
    }
    for (const [name, values] of properties) {
      if (values.length === 1 || !(values[0] instanceof Dict)) {
        mergedDict.set(name, values[0]);
        continue;
      }
      const subDict = new Dict(xref);
      for (const dict of values) {
        for (const [key, value] of dict.getRawEntries()) {
          subDict.setIfNotExists(key, value);
        }
      }
      if (subDict.size > 0) {
        mergedDict.set(name, subDict);
      }
    }
    properties.clear();
    return mergedDict.size > 0 ? mergedDict : Dict.empty;
  }
  clone() {
    const dict = new Dict(this.xref);
    for (const [key, value] of this.#map) {
      dict.set(key, value);
    }
    return dict;
  }
  delete(key) {
    this.#map.delete(key);
  }
}
class Ref {
  #str;
  constructor(str, num, gen) {
    this.#str = str;
    this.num = num;
    this.gen = gen;
  }
  toString() {
    return this.#str;
  }
  static fromString(str) {
    let ref = RefCache.get(str);
    if (ref) {
      return ref;
    }
    const m = /^([1-9]\d*)R([1-9]\d*)?$/.exec(str);
    if (!m) {
      return null;
    }
    ref = new Ref(str, parseInt(m[1], 10), !m[2] ? 0 : parseInt(m[2], 10));
    RefCache.set(str, ref);
    return ref;
  }
  static get(num, gen) {
    const str = gen === 0 ? `${num}R` : `${num}R${gen}`;
    let ref = RefCache.get(str);
    if (!ref) {
      ref = new Ref(str, num, gen);
      RefCache.set(str, ref);
    }
    return ref;
  }
}
class RefSet {
  #set = new Set();
  constructor(parent = null) {
    if (parent) {
      for (const refStr of parent) {
        this.#set.add(refStr);
      }
    }
  }
  has(ref) {
    return this.#set.has(ref.toString());
  }
  put(ref) {
    this.#set.add(ref.toString());
  }
  remove(ref) {
    this.#set.delete(ref.toString());
  }
  [Symbol.iterator]() {
    return this.#set.keys();
  }
  clear() {
    this.#set.clear();
  }
}
class RefMap {
  #map = new Map();
  get size() {
    return this.#map.size;
  }
  get(ref) {
    return this.#map.get(ref.toString());
  }
  has(ref) {
    return this.#map.has(ref.toString());
  }
  put(ref, obj) {
    this.#map.set(ref.toString(), obj);
  }
  putAlias(ref, aliasRef) {
    this.#map.set(ref.toString(), this.get(aliasRef));
  }
  remove(ref) {
    this.#map.delete(ref.toString());
  }
  getOrPutComputed(ref, callback) {
    const map = this.#map,
      refStr = ref.toString();
    if (!map.has(refStr)) {
      map.set(refStr, callback(ref));
    }
    return map.get(refStr);
  }
  [Symbol.iterator]() {
    return this.#map.values();
  }
  clear() {
    this.#map.clear();
  }
  *values() {
    yield* this.#map.values();
  }
  *items() {
    for (const [ref, value] of this.#map) {
      yield [Ref.fromString(ref), value];
    }
  }
  *keys() {
    for (const ref of this.#map.keys()) {
      yield Ref.fromString(ref);
    }
  }
}
function isName(v, name) {
  return v instanceof Name && (name === undefined || v.name === name);
}
function isCmd(v, cmd) {
  return v instanceof Cmd && (cmd === undefined || v.cmd === cmd);
}
function isDict(v, type) {
  return v instanceof Dict && (type === undefined || isName(v.get("Type"), type));
}
function isRefsEqual(v1, v2) {
  return v1.num === v2.num && v1.gen === v2.gen;
}
export { CIRCULAR_REF, clearPrimitiveCaches, Cmd, Dict, EOF, isCmd, isDict, isName, isRefsEqual, Name, Ref, RefMap, RefSet };