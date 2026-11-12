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
import "core-js/modules/es.iterator.for-each.js";
import "core-js/modules/es.iterator.map.js";
import { $appendChild, $clone, $consumed, $content, $data, $finalize, $getAttributeIt, $getChildren, $getDataValue, $getParent, $getRealChildrenByNameIt, $hasSettableValue, $indexOf, $insertAt, $isBindable, $isDataValue, $isDescendent, $namespaceId, $nodeName, $removeChild, $setValue, $text } from "./symbol_utils.js";
import { BindItems, Field, Items, SetProperty, Text } from "./template.js";
import { createDataNode, searchNode } from "./som.js";
import { XFAAttribute, XFAObjectArray, XmlObject } from "./xfa_object.js";
import { NamespaceIds } from "./namespaces.js";
import { warn } from "../../shared/util.js";
const NS_DATASETS = NamespaceIds.datasets.id;
function createText(content) {
  const node = new Text({});
  node[$content] = content;
  return node;
}
class Binder {
  constructor(root) {
    this.root = root;
    this.datasets = root.datasets;
    this.data = root.datasets?.data || new XmlObject(NS_DATASETS, "data");
    this.emptyMerge = this.data[$getChildren]().length === 0;
    this.root.form = this.form = root.template[$clone]();
  }
  _isConsumeData() {
    return !this.emptyMerge && this._mergeMode;
  }
  _isMatchTemplate() {
    return !this._isConsumeData();
  }
  bind() {
    this._bindElement(this.form, this.data);
    return this.form;
  }
  getData() {
    return this.data;
  }
  _bindValue(formNode, data, picture) {
    formNode[$data] = data;
    if (formNode[$hasSettableValue]()) {
      if (data[$isDataValue]()) {
        const value = data[$getDataValue]();
        formNode[$setValue](createText(value));
      } else if (formNode instanceof Field && formNode.ui?.choiceList?.open === "multiSelect") {
        const value = data[$getChildren]().map(child => child[$content].trim()).join("\n");
        formNode[$setValue](createText(value));
      } else if (this._isConsumeData()) {
        warn(`XFA - Nodes haven't the same type.`);
      }
    } else if (!data[$isDataValue]() || this._isMatchTemplate()) {
      this._bindElement(formNode, data);
    } else {
      warn(`XFA - Nodes haven't the same type.`);
    }
  }
  _findDataByNameToConsume(name, isValue, dataNode, global) {
    if (!name) {
      return null;
    }
    let generator, match;
    for (let i = 0; i < 3; i++) {
      generator = dataNode[$getRealChildrenByNameIt](name, false, true);
      while (true) {
        match = generator.next().value;
        if (!match) {
          break;
        }
        if (isValue === match[$isDataValue]()) {
          return match;
        }
      }
      if (dataNode[$namespaceId] === NS_DATASETS && dataNode[$nodeName] === "data") {
        break;
      }
      dataNode = dataNode[$getParent]();
    }
    if (!global) {
      return null;
    }
    generator = this.data[$getRealChildrenByNameIt](name, true, false);
    match = generator.next().value;
    if (match) {
      return match;
    }
    generator = this.data[$getAttributeIt](name, true);
    match = generator.next().value;
    return match?.[$isDataValue]() ? match : null;
  }
  _setProperties(formNode, dataNode) {
    if (!Object.hasOwn(formNode, "setProperty")) {
      return;
    }
    for (const {
      ref,
      target,
      connection
    } of formNode.setProperty.children) {
      if (connection) {
        continue;
      }
      if (!ref) {
        continue;
      }
      const nodes = searchNode(this.root, dataNode, ref, false, false);
      if (!nodes) {
        warn(`XFA - Invalid reference: ${ref}.`);
        continue;
      }
      const [node] = nodes;
      if (!node[$isDescendent](this.data)) {
        warn(`XFA - Invalid node: must be a data node.`);
        continue;
      }
      const targetNodes = searchNode(this.root, formNode, target, false, false);
      if (!targetNodes) {
        warn(`XFA - Invalid target: ${target}.`);
        continue;
      }
      const [targetNode] = targetNodes;
      if (!targetNode[$isDescendent](formNode)) {
        warn(`XFA - Invalid target: must be a property or subproperty.`);
        continue;
      }
      const targetParent = targetNode[$getParent]();
      if (targetNode instanceof SetProperty || targetParent instanceof SetProperty) {
        warn(`XFA - Invalid target: cannot be a setProperty or one of its properties.`);
        continue;
      }
      if (targetNode instanceof BindItems || targetParent instanceof BindItems) {
        warn(`XFA - Invalid target: cannot be a bindItems or one of its properties.`);
        continue;
      }
      const content = node[$text]();
      const name = targetNode[$nodeName];
      if (targetNode instanceof XFAAttribute) {
        const attrs = Object.create(null);
        attrs[name] = content;
        const obj = Reflect.construct(Object.getPrototypeOf(targetParent).constructor, [attrs]);
        targetParent[name] = obj[name];
        continue;
      }
      if (!Object.hasOwn(targetNode, $content)) {
        warn(`XFA - Invalid node to use in setProperty`);
        continue;
      }
      targetNode[$data] = node;
      targetNode[$content] = content;
      targetNode[$finalize]();
    }
  }
  _bindItems(formNode, dataNode) {
    if (!Object.hasOwn(formNode, "items") || !Object.hasOwn(formNode, "bindItems") || formNode.bindItems.isEmpty()) {
      return;
    }
    for (const item of formNode.items.children) {
      formNode[$removeChild](item);
    }
    formNode.items.clear();
    const labels = new Items({});
    const values = new Items({});
    formNode[$appendChild](labels);
    formNode.items.push(labels);
    formNode[$appendChild](values);
    formNode.items.push(values);
    for (const {
      ref,
      labelRef,
      valueRef,
      connection
    } of formNode.bindItems.children) {
      if (connection) {
        continue;
      }
      if (!ref) {
        continue;
      }
      const nodes = searchNode(this.root, dataNode, ref, false, false);
      if (!nodes) {
        warn(`XFA - Invalid reference: ${ref}.`);
        continue;
      }
      for (const node of nodes) {
        if (!node[$isDescendent](this.datasets)) {
          warn(`XFA - Invalid ref (${ref}): must be a datasets child.`);
          continue;
        }
        const labelNodes = searchNode(this.root, node, labelRef, true, false);
        if (!labelNodes) {
          warn(`XFA - Invalid label: ${labelRef}.`);
          continue;
        }
        const [labelNode] = labelNodes;
        if (!labelNode[$isDescendent](this.datasets)) {
          warn(`XFA - Invalid label: must be a datasets child.`);
          continue;
        }
        const valueNodes = searchNode(this.root, node, valueRef, true, false);
        if (!valueNodes) {
          warn(`XFA - Invalid value: ${valueRef}.`);
          continue;
        }
        const [valueNode] = valueNodes;
        if (!valueNode[$isDescendent](this.datasets)) {
          warn(`XFA - Invalid value: must be a datasets child.`);
          continue;
        }
        const label = createText(labelNode[$text]());
        const value = createText(valueNode[$text]());
        labels[$appendChild](label);
        labels.text.push(label);
        values[$appendChild](value);
        values.text.push(value);
      }
    }
  }
  _bindOccurrences(formNode, matches, picture) {
    let baseClone;
    if (matches.length > 1) {
      baseClone = formNode[$clone]();
      baseClone[$removeChild](baseClone.occur);
      baseClone.occur = null;
    }
    this._bindValue(formNode, matches[0], picture);
    this._setProperties(formNode, matches[0]);
    this._bindItems(formNode, matches[0]);
    if (matches.length === 1) {
      return;
    }
    const parent = formNode[$getParent]();
    const name = formNode[$nodeName];
    const pos = parent[$indexOf](formNode);
    for (let i = 1, ii = matches.length; i < ii; i++) {
      const match = matches[i];
      const clone = baseClone[$clone]();
      parent[name].push(clone);
      parent[$insertAt](pos + i, clone);
      this._bindValue(clone, match, picture);
      this._setProperties(clone, match);
      this._bindItems(clone, match);
    }
  }
  _createOccurrences(formNode) {
    if (!this.emptyMerge) {
      return;
    }
    const {
      occur
    } = formNode;
    if (!occur || occur.initial <= 1) {
      return;
    }
    const parent = formNode[$getParent]();
    const name = formNode[$nodeName];
    if (!(parent[name] instanceof XFAObjectArray)) {
      return;
    }
    let currentNumber;
    if (formNode.name) {
      currentNumber = parent[name].children.filter(e => e.name === formNode.name).length;
    } else {
      currentNumber = parent[name].children.length;
    }
    const pos = parent[$indexOf](formNode) + 1;
    const ii = occur.initial - currentNumber;
    if (ii) {
      const nodeClone = formNode[$clone]();
      nodeClone[$removeChild](nodeClone.occur);
      nodeClone.occur = null;
      parent[name].push(nodeClone);
      parent[$insertAt](pos, nodeClone);
      for (let i = 1; i < ii; i++) {
        const clone = nodeClone[$clone]();
        parent[name].push(clone);
        parent[$insertAt](pos + i, clone);
      }
    }
  }
  _getOccurInfo(formNode) {
    const {
      name,
      occur
    } = formNode;
    if (!occur || !name) {
      return [1, 1];
    }
    const max = occur.max === -1 ? Infinity : occur.max;
    return [occur.min, max];
  }
  _setAndBind(formNode, dataNode) {
    this._setProperties(formNode, dataNode);
    this._bindItems(formNode, dataNode);
    this._bindElement(formNode, dataNode);
  }
  _bindElement(formNode, dataNode) {
    const uselessNodes = [];
    this._createOccurrences(formNode);
    for (const child of formNode[$getChildren]()) {
      if (child[$data]) {
        continue;
      }
      if (this._mergeMode === undefined && child[$nodeName] === "subform") {
        this._mergeMode = child.mergeMode === "consumeData";
        const dataChildren = dataNode[$getChildren]();
        if (dataChildren.length > 0) {
          this._bindOccurrences(child, [dataChildren[0]], null);
        } else if (this.emptyMerge) {
          const nsId = dataNode[$namespaceId] === NS_DATASETS ? -1 : dataNode[$namespaceId];
          const dataChild = child[$data] = new XmlObject(nsId, child.name || "root");
          dataNode[$appendChild](dataChild);
          this._bindElement(child, dataChild);
        }
        continue;
      }
      if (!child[$isBindable]()) {
        continue;
      }
      let global = false;
      let picture = null;
      let ref = null;
      let match = null;
      if (child.bind) {
        switch (child.bind.match) {
          case "none":
            this._setAndBind(child, dataNode);
            continue;
          case "global":
            global = true;
            break;
          case "dataRef":
            if (!child.bind.ref) {
              warn(`XFA - ref is empty in node ${child[$nodeName]}.`);
              this._setAndBind(child, dataNode);
              continue;
            }
            ref = child.bind.ref;
            break;
          default:
            break;
        }
        if (child.bind.picture) {
          picture = child.bind.picture[$content];
        }
      }
      const [min, max] = this._getOccurInfo(child);
      if (ref) {
        match = searchNode(this.root, dataNode, ref, true, false);
        if (match === null) {
          match = createDataNode(this.data, dataNode, ref);
          if (!match) {
            continue;
          }
          if (this._isConsumeData()) {
            match[$consumed] = true;
          }
          this._setAndBind(child, match);
          continue;
        } else {
          if (this._isConsumeData()) {
            match = match.filter(node => !node[$consumed]);
          }
          if (match.length > max) {
            match = match.slice(0, max);
          } else if (match.length === 0) {
            match = null;
          }
          if (match && this._isConsumeData()) {
            match.forEach(node => {
              node[$consumed] = true;
            });
          }
        }
      } else {
        if (!child.name) {
          this._setAndBind(child, dataNode);
          continue;
        }
        if (this._isConsumeData()) {
          const matches = [];
          while (matches.length < max) {
            const found = this._findDataByNameToConsume(child.name, child[$hasSettableValue](), dataNode, global);
            if (!found) {
              break;
            }
            found[$consumed] = true;
            matches.push(found);
          }
          match = matches.length > 0 ? matches : null;
        } else {
          match = dataNode[$getRealChildrenByNameIt](child.name, false, this.emptyMerge).next().value;
          if (!match) {
            if (min === 0) {
              uselessNodes.push(child);
              continue;
            }
            const nsId = dataNode[$namespaceId] === NS_DATASETS ? -1 : dataNode[$namespaceId];
            match = child[$data] = new XmlObject(nsId, child.name);
            if (this.emptyMerge) {
              match[$consumed] = true;
            }
            dataNode[$appendChild](match);
            this._setAndBind(child, match);
            continue;
          }
          if (this.emptyMerge) {
            match[$consumed] = true;
          }
          match = [match];
        }
      }
      if (match) {
        this._bindOccurrences(child, match, picture);
      } else if (min > 0) {
        this._setAndBind(child, dataNode);
      } else {
        uselessNodes.push(child);
      }
    }
    uselessNodes.forEach(node => node[$getParent]()[$removeChild](node));
  }
}
export { Binder };