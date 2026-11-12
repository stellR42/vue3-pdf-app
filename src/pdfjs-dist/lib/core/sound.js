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
import "core-js/modules/es.typed-array.with.js";
import "core-js/modules/es.uint8-array.set-from-base64.js";
import "core-js/modules/es.uint8-array.set-from-hex.js";
import "core-js/modules/es.uint8-array.to-base64.js";
import "core-js/modules/es.uint8-array.to-hex.js";
import { Name } from "./primitives.js";
import { stringToBytes } from "../shared/util.js";
const WAV_HEADER_SIZE = 44;
function getSoundFormat(dict) {
  if (!dict || dict.has("CO")) {
    return null;
  }
  const sampleRate = dict.get("R");
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    return null;
  }
  const channels = dict.get("C") ?? 1;
  if (!Number.isInteger(channels) || channels < 1 || channels > 2) {
    return null;
  }
  const bitsPerSample = dict.get("B") ?? 8;
  if (bitsPerSample !== 8 && bitsPerSample !== 16) {
    return null;
  }
  const e = dict.get("E");
  let encoding = "Raw";
  if (e !== undefined) {
    encoding = e instanceof Name ? e.name : null;
  }
  return encoding !== "Raw" && encoding !== "Signed" ? null : {
    channels,
    sampleRate,
    bitsPerSample,
    encoding
  };
}
function soundStreamToWav(stream, samples) {
  const format = getSoundFormat(stream.dict);
  if (!format) {
    return null;
  }
  const {
    channels,
    sampleRate,
    bitsPerSample,
    encoding
  } = format;
  const blockAlign = channels * (bitsPerSample >> 3);
  const dataLength = samples.length - samples.length % blockAlign;
  if (dataLength === 0) {
    return null;
  }
  const wav = new Uint8Array(WAV_HEADER_SIZE + dataLength);
  const view = new DataView(wav.buffer);
  wav.set(stringToBytes("RIFF"), 0);
  view.setUint32(4, WAV_HEADER_SIZE - 8 + dataLength, true);
  wav.set(stringToBytes("WAVE"), 8);
  wav.set(stringToBytes("fmt "), 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  wav.set(stringToBytes("data"), 36);
  view.setUint32(40, dataLength, true);
  if (bitsPerSample === 16) {
    const signed = encoding === "Signed";
    for (let i = 0; i < dataLength; i += 2) {
      let value = samples[i] << 8 | samples[i + 1];
      if (signed) {
        if (value >= 0x8000) {
          value -= 0x10000;
        }
      } else {
        value -= 0x8000;
      }
      view.setInt16(WAV_HEADER_SIZE + i, value, true);
    }
  } else if (encoding === "Signed") {
    for (let i = 0; i < dataLength; i++) {
      wav[WAV_HEADER_SIZE + i] = samples[i] + 128 & 0xff;
    }
  } else {
    wav.set(samples.subarray(0, dataLength), WAV_HEADER_SIZE);
  }
  return wav;
}
export { getSoundFormat, soundStreamToWav };