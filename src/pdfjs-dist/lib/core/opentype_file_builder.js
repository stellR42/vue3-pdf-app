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
import { stringToBytes } from "../shared/util.js";
const OTF_HEADER_SIZE = 12;
const OTF_TABLE_ENTRY_SIZE = 16;
class OpenTypeFileBuilder {
  #tables = new Map();
  constructor(sfnt) {
    this.sfnt = sfnt;
  }
  static getSearchParams(entriesCount, entrySize) {
    let maxPower2 = 1,
      log2 = 0;
    while ((maxPower2 ^ entriesCount) > maxPower2) {
      maxPower2 <<= 1;
      log2++;
    }
    const searchRange = maxPower2 * entrySize;
    return {
      range: searchRange,
      entry: log2,
      rangeShift: entrySize * entriesCount - searchRange
    };
  }
  toArray() {
    let sfnt = this.sfnt;
    const tables = this.#tables;
    const tablesNames = [...tables.keys()].sort();
    const numTables = tablesNames.length;
    let offset = OTF_HEADER_SIZE + numTables * OTF_TABLE_ENTRY_SIZE;
    const tableOffsets = [offset];
    for (let i = 0; i < numTables; i++) {
      const table = tables.get(tablesNames[i]);
      const paddedLength = (table.length + 3 & ~3) >>> 0;
      offset += paddedLength;
      tableOffsets.push(offset);
    }
    const file = new Uint8Array(offset),
      view = new DataView(file.buffer);
    for (let i = 0; i < numTables; i++) {
      const table = tables.get(tablesNames[i]);
      file.set(table, tableOffsets[i]);
    }
    if (sfnt === "true") {
      sfnt = "\x00\x01\x00\x00";
    }
    file.set(stringToBytes(sfnt), 0);
    view.setInt16(4, numTables);
    const searchParams = OpenTypeFileBuilder.getSearchParams(numTables, 16);
    view.setInt16(6, searchParams.range);
    view.setInt16(8, searchParams.entry);
    view.setInt16(10, searchParams.rangeShift);
    offset = OTF_HEADER_SIZE;
    for (let i = 0; i < numTables; i++) {
      const tableName = tablesNames[i];
      file.set(stringToBytes(tableName), offset);
      let checksum = 0;
      for (let j = tableOffsets[i], jj = tableOffsets[i + 1]; j < jj; j += 4) {
        const quad = view.getUint32(j);
        checksum = checksum + quad >>> 0;
      }
      view.setInt32(offset + 4, checksum);
      view.setInt32(offset + 8, tableOffsets[i]);
      view.setInt32(offset + 12, tables.get(tableName).length);
      offset += OTF_TABLE_ENTRY_SIZE;
    }
    this.#tables.clear();
    return file;
  }
  addTable(tag, data) {
    if (this.#tables.has(tag)) {
      throw new Error(`Table ${tag} already exists`);
    }
    this.#tables.set(tag, data);
  }
}
export { OpenTypeFileBuilder };