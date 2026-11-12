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
import "core-js/modules/es.iterator.every.js";
import "core-js/modules/es.iterator.map.js";
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
import { makeArr } from "../shared/util.js";
import { MathClamp } from "../shared/math_clamp.js";
class PagesMapper {
  #pageNumberToId = null;
  #prevPageNumbers = null;
  #pagesNumber = 0;
  #initialPagesNumber = 0;
  #clipboard = null;
  #savedData = null;
  get pagesNumber() {
    return this.#pagesNumber;
  }
  set pagesNumber(n) {
    if (this.#pagesNumber === n) {
      return;
    }
    this.#pagesNumber = this.#initialPagesNumber = n;
    this.#pageNumberToId = null;
    this.#prevPageNumbers = null;
  }
  #ensureInit() {
    if (this.#pageNumberToId) {
      return;
    }
    const n = this.#pagesNumber;
    const pageNumberToId = this.#pageNumberToId = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      pageNumberToId[i] = i + 1;
    }
    this.#prevPageNumbers = new Int32Array(pageNumberToId);
  }
  #buildIdToPageNumber() {
    const idToPageNumber = new Map();
    const pageNumberToId = this.#pageNumberToId;
    for (let i = 0, ii = this.#pagesNumber; i < ii; i++) {
      const id = pageNumberToId[i];
      const pageNumbers = idToPageNumber.get(id);
      if (pageNumbers) {
        pageNumbers.push(i + 1);
      } else {
        idToPageNumber.set(id, [i + 1]);
      }
    }
    return idToPageNumber;
  }
  movePages(selectedPages, pagesToMove, index) {
    this.#ensureInit();
    const pageNumberToId = this.#pageNumberToId;
    const movedCount = pagesToMove.length;
    const mappedPagesToMove = new Uint32Array(movedCount);
    let removedBeforeTarget = 0;
    for (let i = 0; i < movedCount; i++) {
      const pageIndex = pagesToMove[i] - 1;
      mappedPagesToMove[i] = pageNumberToId[pageIndex];
      if (pageIndex < index) {
        removedBeforeTarget++;
      }
    }
    const pagesNumber = this.#pagesNumber;
    const remainingLen = pagesNumber - movedCount;
    const prevPageNumbers = new Int32Array(pagesNumber);
    const adjustedTarget = MathClamp(index - removedBeforeTarget, 0, remainingLen);
    for (let i = 0, r = 0; i < pagesNumber; i++) {
      if (!selectedPages.has(i + 1)) {
        pageNumberToId[r] = pageNumberToId[i];
        prevPageNumbers[r++] = i + 1;
      }
    }
    pageNumberToId.copyWithin(adjustedTarget + movedCount, adjustedTarget, remainingLen);
    pageNumberToId.set(mappedPagesToMove, adjustedTarget);
    prevPageNumbers.copyWithin(adjustedTarget + movedCount, adjustedTarget, remainingLen);
    prevPageNumbers.set(pagesToMove, adjustedTarget);
    this.#prevPageNumbers = prevPageNumbers;
    if (pagesNumber === this.#initialPagesNumber && pageNumberToId.every((id, i) => id === i + 1)) {
      this.#pageNumberToId = null;
    }
  }
  deletePages(pagesToDelete) {
    this.#ensureInit();
    const pageNumberToId = this.#pageNumberToId;
    const prevIdToPageNumber = this.#buildIdToPageNumber();
    this.#savedData = {
      pageNumberToId: pageNumberToId.slice(),
      pagesNumber: this.#pagesNumber,
      prevPageNumbers: this.#prevPageNumbers.slice()
    };
    const newN = this.#pagesNumber - pagesToDelete.length;
    this.#pagesNumber = newN;
    const newPageNumberToId = this.#pageNumberToId = new Uint32Array(newN);
    this.#prevPageNumbers = new Int32Array(newN);
    let sourceIndex = 0;
    let destIndex = 0;
    for (const pageNumber of pagesToDelete) {
      const pageIndex = pageNumber - 1;
      if (pageIndex !== sourceIndex) {
        newPageNumberToId.set(pageNumberToId.subarray(sourceIndex, pageIndex), destIndex);
        destIndex += pageIndex - sourceIndex;
      }
      sourceIndex = pageIndex + 1;
    }
    if (sourceIndex < pageNumberToId.length) {
      newPageNumberToId.set(pageNumberToId.subarray(sourceIndex), destIndex);
    }
    this.#updatePrevPageNumbers(prevIdToPageNumber, new Set(pagesToDelete));
  }
  cancelDelete() {
    if (this.#savedData) {
      this.#pageNumberToId = this.#savedData.pageNumberToId;
      this.#pagesNumber = this.#savedData.pagesNumber;
      this.#prevPageNumbers = this.#savedData.prevPageNumbers;
      this.#savedData = null;
    }
  }
  cleanSavedData() {
    this.#savedData = null;
  }
  copyPages(pagesToCopy) {
    this.#ensureInit();
    this.#clipboard = {
      pageNumbers: pagesToCopy,
      pageIds: pagesToCopy.map(n => this.#pageNumberToId[n - 1])
    };
  }
  cancelCopy() {
    this.#clipboard = null;
  }
  pastePages(index) {
    this.#ensureInit();
    const pageNumberToId = this.#pageNumberToId;
    const prevIdToPageNumber = this.#buildIdToPageNumber();
    const {
      pageNumbers: copiedPageNumbers,
      pageIds: copiedPageIds
    } = this.#clipboard;
    const newN = this.#pagesNumber + copiedPageNumbers.length;
    this.#pagesNumber = newN;
    const newPageNumberToId = this.#pageNumberToId = new Uint32Array(newN);
    this.#prevPageNumbers = new Int32Array(newN);
    newPageNumberToId.set(pageNumberToId.subarray(0, index), 0);
    newPageNumberToId.set(copiedPageIds, index);
    newPageNumberToId.set(pageNumberToId.subarray(index), index + copiedPageNumbers.length);
    this.#updatePrevPageNumbers(prevIdToPageNumber, null, index, copiedPageNumbers);
    this.#clipboard = null;
  }
  #updatePrevPageNumbers(prevIdToPageNumber, deletedPageNumbers = null, pasteIndex = -1, copiedPageNumbers = null) {
    const prevPageNumbers = this.#prevPageNumbers;
    const newPageNumberToId = this.#pageNumberToId;
    const pasteEnd = pasteIndex + (copiedPageNumbers?.length ?? 0);
    const idsIndices = new Map();
    for (let i = 0, ii = this.#pagesNumber; i < ii; i++) {
      if (i >= pasteIndex && i < pasteEnd) {
        prevPageNumbers[i] = -copiedPageNumbers[i - pasteIndex];
        continue;
      }
      const id = newPageNumberToId[i];
      const oldPositions = prevIdToPageNumber.get(id);
      let j = idsIndices.get(id) || 0;
      if (deletedPageNumbers && oldPositions) {
        while (j < oldPositions.length && deletedPageNumbers.has(oldPositions[j])) {
          j++;
        }
      }
      prevPageNumbers[i] = oldPositions?.[j];
      idsIndices.set(id, j + 1);
    }
  }
  hasBeenAltered() {
    return this.#pageNumberToId !== null;
  }
  #buildCopyLevels(extractedPageNumbers = null) {
    if (!this.#pageNumberToId) {
      return null;
    }
    const copyLevels = new Int32Array(this.#pagesNumber).fill(-1);
    const counts = new Map();
    if (extractedPageNumbers) {
      for (const pageNumber of extractedPageNumbers) {
        const id = this.getPageId(pageNumber);
        const level = counts.get(id) ?? 0;
        counts.set(id, level + 1);
        copyLevels[pageNumber - 1] = level;
      }
    } else {
      for (let i = 0, ii = this.#pagesNumber; i < ii; i++) {
        const id = this.#pageNumberToId[i];
        const level = counts.get(id) ?? 0;
        counts.set(id, level + 1);
        copyLevels[i] = level;
      }
    }
    return copyLevels;
  }
  getPageMappingForSaving(idToPageNumber = null, copyLevels = this.#buildCopyLevels()) {
    idToPageNumber ??= this.#buildIdToPageNumber();
    let nCopy = 0;
    for (const pageNumbers of idToPageNumber.values()) {
      nCopy = Math.max(nCopy, pageNumbers.length);
    }
    const extractParams = new Array(nCopy);
    for (let i = 0; i < nCopy; i++) {
      extractParams[i] = {
        document: null,
        pageIndices: [],
        includePages: []
      };
    }
    for (const [id, pageNumbers] of idToPageNumber) {
      for (let i = 0, ii = pageNumbers.length; i < ii; i++) {
        extractParams[i].includePages.push([id - 1, pageNumbers[i] - 1]);
      }
    }
    for (const {
      includePages,
      pageIndices
    } of extractParams) {
      includePages.sort((a, b) => a[0] - b[0]);
      for (let i = 0, ii = includePages.length; i < ii; i++) {
        pageIndices.push(includePages[i][1]);
        includePages[i] = includePages[i][0];
      }
    }
    return {
      pageInfos: extractParams,
      copyLevels
    };
  }
  extractPages(extractedPageNumbers) {
    extractedPageNumbers = Array.from(extractedPageNumbers).sort((a, b) => a - b);
    const usedIds = new Map();
    for (let i = 0, ii = extractedPageNumbers.length; i < ii; i++) {
      const id = this.getPageId(extractedPageNumbers[i]);
      const usedPageNumbers = usedIds.getOrInsertComputed(id, makeArr);
      usedPageNumbers.push(i + 1);
    }
    return this.getPageMappingForSaving(usedIds, this.#buildCopyLevels(extractedPageNumbers));
  }
  getPrevPageNumber(pageNumber) {
    return this.#prevPageNumbers?.[pageNumber - 1] ?? 0;
  }
  getPageNumber(id) {
    if (!this.#pageNumberToId) {
      return id;
    }
    const pageNumberToId = this.#pageNumberToId;
    for (let i = 0, ii = this.#pagesNumber; i < ii; i++) {
      if (pageNumberToId[i] === id) {
        return i + 1;
      }
    }
    return 0;
  }
  getPageId(pageNumber) {
    return this.#pageNumberToId?.[pageNumber - 1] ?? pageNumber;
  }
  getMapping() {
    return this.#pageNumberToId?.subarray(0, this.pagesNumber);
  }
}
export { PagesMapper };