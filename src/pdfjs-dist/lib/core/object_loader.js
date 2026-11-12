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
import { Dict, Ref, RefSet } from "./primitives.js";
import { BaseStream } from "./base_stream.js";
import { MissingDataException } from "./core_utils.js";
import { warn } from "../shared/util.js";
function mayHaveChildren(value) {
  return value instanceof Ref || value instanceof Dict || value instanceof BaseStream || Array.isArray(value);
}
function addChildren(node, nodesToVisit) {
  if (node instanceof Dict) {
    node = node.getRawValues();
  } else if (node instanceof BaseStream) {
    node = node.dict.getRawValues();
  } else if (!Array.isArray(node)) {
    return;
  }
  for (const rawValue of node) {
    if (mayHaveChildren(rawValue)) {
      nodesToVisit.push(rawValue);
    }
  }
}
class ObjectLoader {
  refSet = new RefSet();
  constructor(dict, keys, xref) {
    this.dict = dict;
    this.keys = keys;
    this.xref = xref;
  }
  async load() {
    const {
      keys,
      dict
    } = this;
    const nodesToVisit = [];
    for (const key of keys) {
      const rawValue = dict.getRaw(key);
      if (rawValue !== undefined) {
        nodesToVisit.push(rawValue);
      }
    }
    await this.#walk(nodesToVisit);
    this.refSet = null;
  }
  async #walk(nodesToVisit) {
    const nodesToRevisit = [];
    const pendingRequests = [];
    while (nodesToVisit.length) {
      let currentNode = nodesToVisit.pop();
      if (currentNode instanceof Ref) {
        if (this.refSet.has(currentNode)) {
          continue;
        }
        try {
          this.refSet.put(currentNode);
          currentNode = this.xref.fetch(currentNode);
        } catch (ex) {
          if (!(ex instanceof MissingDataException)) {
            warn(`ObjectLoader.#walk - requesting all data: "${ex}".`);
            await this.xref.stream.manager.requestAllChunks();
            return;
          }
          nodesToRevisit.push(currentNode);
          pendingRequests.push({
            begin: ex.begin,
            end: ex.end
          });
        }
      }
      if (currentNode instanceof BaseStream) {
        const baseStreams = currentNode.getBaseStreams();
        if (baseStreams) {
          let foundMissingData = false;
          for (const stream of baseStreams) {
            if (stream.isDataLoaded) {
              continue;
            }
            foundMissingData = true;
            pendingRequests.push({
              begin: stream.start,
              end: stream.end
            });
          }
          if (foundMissingData) {
            nodesToRevisit.push(currentNode);
          }
        }
      }
      addChildren(currentNode, nodesToVisit);
    }
    if (pendingRequests.length) {
      await this.xref.stream.manager.requestRanges(pendingRequests);
      for (const node of nodesToRevisit) {
        if (node instanceof Ref) {
          this.refSet.remove(node);
        }
      }
      await this.#walk(nodesToRevisit);
    }
  }
  static async load(obj, keys, xref) {
    if (xref.stream.isDataLoaded) {
      return;
    }
    const objLoader = new ObjectLoader(obj, keys, xref);
    await objLoader.load();
  }
}
export { ObjectLoader };