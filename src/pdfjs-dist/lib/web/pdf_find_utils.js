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
import { FeatureTest } from "../pdf.js";
let wordSegmenter = null;
let graphemeSegmenter = null;
function isWordBreakAt(content, pos) {
  graphemeSegmenter ||= new Intl.Segmenter(undefined, {
    granularity: "grapheme"
  });
  const graphemes = graphemeSegmenter.segment(content);
  const after = graphemes.containing(pos);
  if (after.index !== pos) {
    return false;
  }
  wordSegmenter ||= new Intl.Segmenter(undefined, {
    granularity: "word"
  });
  const before = graphemes.containing(pos - 1).segment;
  return wordSegmenter.segment(before + after.segment).containing(before.length).index === before.length;
}
function isEntireWord(content, startIdx, length) {
  const endIdx = startIdx + length;
  return (startIdx === 0 || isWordBreakAt(content, startIdx)) && (endIdx === content.length || isWordBreakAt(content, endIdx));
}
let NormalizeWithNFKC;
function getNormalizeWithNFKC() {
  if (!NormalizeWithNFKC) {
    const ranges = [];
    const range = [];
    const flushRange = () => {
      if (range.length !== 2) {
        return;
      }
      const [start, end] = range;
      const first = String.fromCharCode(start);
      ranges.push(start === end ? first : `${first}-${String.fromCharCode(end)}`);
    };
    const diacriticsRegex = /^\p{M}$/u;
    for (let i = 0; i < 65536; i++) {
      if (i >= 0xd800 && i <= 0xdfff) {
        continue;
      }
      const c = String.fromCharCode(i);
      if (c.normalize("NFKC") !== c && !diacriticsRegex.test(c)) {
        if (range.length === 2 && range[1] + 1 === i) {
          range[1] = i;
        } else {
          flushRange();
          range[0] = range[1] = i;
        }
      }
    }
    flushRange();
    const rangesStr = ranges.join("");
    if (!NormalizeWithNFKC) {
      NormalizeWithNFKC = rangesStr;
    } else if (rangesStr !== NormalizeWithNFKC) {
      for (let i = 1; i < rangesStr.length; i++) {
        if (rangesStr[i] !== NormalizeWithNFKC[i]) {
          console.log(`Difference at index ${i}: ` + `U+${rangesStr.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0")}` + `!== U+${NormalizeWithNFKC.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0")}`);
          break;
        }
      }
      throw new Error("getNormalizeWithNFKC - update the `NormalizeWithNFKC` string.");
    }
  }
  return NormalizeWithNFKC;
}
export { getNormalizeWithNFKC, isEntireWord };