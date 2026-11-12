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
import { FeatureTest, shadow, warn } from "../shared/util.js";
import { DecodeStream } from "./decode_stream.js";
import { Dict } from "./primitives.js";
import { ImageResizer } from "./image_resizer.js";
import { JpegImage } from "./jpg.js";
class JpegStream extends DecodeStream {
  static #isImageDecoderSupported = FeatureTest.isImageDecoderSupported;
  constructor(stream, maybeLength, params) {
    super(maybeLength);
    this.stream = stream;
    this.dict = stream.dict;
    this.maybeLength = maybeLength;
    this.params = params;
  }
  static get canUseImageDecoder() {
    return shadow(this, "canUseImageDecoder", this.#isImageDecoderSupported ? ImageDecoder.isTypeSupported("image/jpeg") : Promise.resolve(false));
  }
  static setOptions({
    isImageDecoderSupported = false
  }) {
    this.#isImageDecoderSupported = isImageDecoderSupported;
  }
  get bytes() {
    return shadow(this, "bytes", this.stream.getBytes(this.maybeLength));
  }
  ensureBuffer(requested) {}
  readBlock() {
    this.decodeImage();
  }
  get jpegOptions() {
    const jpegOptions = {
      colorTransform: undefined
    };
    if (this.params instanceof Dict) {
      const colorTransform = this.params.get("ColorTransform");
      if (Number.isInteger(colorTransform)) {
        jpegOptions.colorTransform = colorTransform;
      }
    }
    return shadow(this, "jpegOptions", jpegOptions);
  }
  #skipUselessBytes(data) {
    for (let i = 0, ii = data.length - 1; i < ii; i++) {
      if (data[i] === 0xff && data[i + 1] === 0xd8) {
        if (i > 0) {
          data = data.subarray(i);
        }
        break;
      }
    }
    return data;
  }
  decodeImage(bytes) {
    if (this.eof) {
      return this.buffer;
    }
    bytes = this.#skipUselessBytes(bytes || this.bytes);
    const jpegImage = new JpegImage(this.jpegOptions);
    jpegImage.parse(bytes);
    const data = jpegImage.getData({
      width: this.drawWidth,
      height: this.drawHeight,
      forceRGBA: this.forceRGBA,
      forceRGB: this.forceRGB
    });
    this.buffer = data;
    this.bufferLength = data.length;
    this.eof = true;
    return this.buffer;
  }
  get canAsyncDecodeImageFromBuffer() {
    return this.stream.isAsync;
  }
  async getTransferableImage(width, height) {
    if (!(await JpegStream.canUseImageDecoder)) {
      return null;
    }
    const jpegOptions = this.jpegOptions;
    let decoder;
    try {
      const bytes = this.canAsyncDecodeImageFromBuffer && (await this.stream.asyncGetBytes()) || this.bytes;
      if (!bytes) {
        return null;
      }
      let data = this.#skipUselessBytes(bytes);
      const useImageDecoder = JpegImage.canUseImageDecoder(data, jpegOptions.colorTransform);
      if (!useImageDecoder) {
        return null;
      }
      const {
        width: frameWidth,
        height: frameHeight
      } = useImageDecoder;
      const reducePower = ImageResizer.getReducePower(frameWidth, frameHeight);
      if ((frameWidth !== width || frameHeight !== height) && (reducePower || !frameHeight)) {
        return null;
      }
      if (useImageDecoder.exifStart) {
        data = data.slice();
        data.fill(0x00, useImageDecoder.exifStart, useImageDecoder.exifEnd);
      }
      const init = {
        data,
        type: "image/jpeg",
        preferAnimation: false
      };
      if (reducePower) {
        const factor = 2 ** reducePower;
        init.desiredWidth = Math.ceil(frameWidth / factor);
        init.desiredHeight = Math.ceil(frameHeight / factor);
      }
      decoder = new ImageDecoder(init);
      return (await decoder.decode()).image;
    } catch (reason) {
      warn(`getTransferableImage - failed: "${reason}".`);
      return null;
    } finally {
      decoder?.close();
    }
  }
  get isImageStream() {
    return true;
  }
}
export { JpegStream };