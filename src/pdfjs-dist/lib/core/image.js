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
import { assert, FeatureTest, FormatError, ImageKind, warn } from "../shared/util.js";
import { convertBlackAndWhiteToRGBA, convertToRGBA } from "../shared/image_utils.js";
import { BaseStream } from "./base_stream.js";
import { ColorSpace } from "./colorspace.js";
import { ColorSpaceUtils } from "./colorspace_utils.js";
import { DecodeStream } from "./decode_stream.js";
import { ImageResizer } from "./image_resizer.js";
import { JpegStream } from "./jpeg_stream.js";
import { JpxImage } from "./jpx.js";
import { MathClamp } from "../shared/math_clamp.js";
import { Name } from "./primitives.js";
function sumOpaqueRow(sums, rgbRow, rgbX) {
  for (let x = 0, k = 0, ii = rgbX.length; x < ii; x++, k += 4) {
    const i = rgbX[x];
    sums[k] += rgbRow[i];
    sums[k + 1] += rgbRow[i + 1];
    sums[k + 2] += rgbRow[i + 2];
  }
}
function sumTransparentRow(sums, rgbRow, rgbX, alpha, alphaOffset, alphaX) {
  for (let x = 0, k = 0, ii = rgbX.length; x < ii; x++, k += 4) {
    const opacity = alpha[alphaOffset + alphaX[x]];
    if (opacity !== 0) {
      const i = rgbX[x];
      sums[k] += rgbRow[i] * opacity;
      sums[k + 1] += rgbRow[i + 1] * opacity;
      sums[k + 2] += rgbRow[i + 2] * opacity;
      sums[k + 3] += opacity;
    }
  }
}
function sumPreblendedRow(sums, rgbRow, rgbX, alpha, alphaOffset, alphaX, [matteR, matteG, matteB]) {
  for (let x = 0, k = 0, ii = rgbX.length; x < ii; x++, k += 4) {
    const opacity = alpha[alphaOffset + alphaX[x]];
    if (opacity !== 0) {
      const i = rgbX[x];
      sums[k] += MathClamp((rgbRow[i] - matteR) * 255 + matteR * opacity, 0, 255 * opacity);
      sums[k + 1] += MathClamp((rgbRow[i + 1] - matteG) * 255 + matteG * opacity, 0, 255 * opacity);
      sums[k + 2] += MathClamp((rgbRow[i + 2] - matteB) * 255 + matteB * opacity, 0, 255 * opacity);
      sums[k + 3] += opacity;
    }
  }
}
class PDFImage {
  constructor({
    xref,
    res,
    image,
    isInline = false,
    smask = null,
    mask = null,
    isMask = false,
    pdfFunctionFactory,
    globalColorSpaceCache,
    localColorSpaceCache
  }) {
    this.image = image;
    const dict = image.dict;
    const filter = dict.get("F", "Filter");
    let filterName;
    if (filter instanceof Name) {
      filterName = filter.name;
    } else if (Array.isArray(filter)) {
      const lastFilter = xref.fetchIfRef(filter.at(-1));
      if (lastFilter instanceof Name) {
        filterName = lastFilter.name;
      }
    }
    switch (filterName) {
      case "JPXDecode":
        ({
          width: image.width,
          height: image.height,
          componentsCount: image.numComps,
          bitsPerComponent: image.bitsPerComponent
        } = JpxImage.parseImageProperties(image.stream));
        image.stream.reset();
        const reducePower = ImageResizer.getReducePowerForJPX(image.width, image.height, image.numComps);
        this.jpxDecoderOptions = {
          numComponents: 0,
          isIndexedColormap: false,
          smaskInData: dict.get("SMaskInData") >= 1,
          reducePower
        };
        if (reducePower) {
          const factor = 2 ** reducePower;
          image.width = Math.ceil(image.width / factor);
          image.height = Math.ceil(image.height / factor);
        }
        break;
      case "JBIG2Decode":
        image.bitsPerComponent = 1;
        image.numComps = 1;
        break;
    }
    let width = dict.get("W", "Width");
    let height = dict.get("H", "Height");
    if (Number.isInteger(image.width) && image.width > 0 && Number.isInteger(image.height) && image.height > 0 && (image.width !== width || image.height !== height)) {
      warn("PDFImage - using the Width/Height of the image data, " + "rather than the image dictionary.");
      width = image.width;
      height = image.height;
    } else {
      const validWidth = typeof width === "number" && width > 0,
        validHeight = typeof height === "number" && height > 0;
      if (!validWidth || !validHeight) {
        if (!image.fallbackDims) {
          throw new FormatError(`Invalid image width: ${width} or height: ${height}`);
        }
        warn("PDFImage - using the Width/Height of the parent image, for SMask/Mask data.");
        if (!validWidth) {
          width = image.fallbackDims.width;
        }
        if (!validHeight) {
          height = image.fallbackDims.height;
        }
      }
    }
    this.width = width;
    this.height = height;
    this.interpolate = dict.get("I", "Interpolate");
    this.imageMask = dict.get("IM", "ImageMask") || false;
    this.matte = dict.get("Matte") || false;
    let bitsPerComponent = image.bitsPerComponent;
    if (!bitsPerComponent) {
      bitsPerComponent = dict.get("BPC", "BitsPerComponent");
      if (!bitsPerComponent) {
        if (this.imageMask) {
          bitsPerComponent = 1;
        } else {
          throw new FormatError(`Bits per component missing in image: ${this.imageMask}`);
        }
      }
    }
    this.bpc = bitsPerComponent;
    if (!this.imageMask) {
      let colorSpace = dict.getRaw("CS") || dict.getRaw("ColorSpace");
      const hasColorSpace = !!colorSpace;
      if (this.jpxDecoderOptions?.smaskInData && dict.get("SMaskInData") === 2) {
        this.jpxPremultiplied = true;
        if (this.matte) {
          const matteColorSpace = ColorSpaceUtils.parse({
            cs: hasColorSpace ? colorSpace : Name.get("DeviceRGB"),
            xref,
            resources: isInline ? res : null,
            pdfFunctionFactory,
            globalColorSpaceCache,
            localColorSpaceCache
          });
          this.preblendMatte = matteColorSpace.getRgb(this.matte, 0);
        }
      }
      if (!hasColorSpace) {
        if (this.jpxDecoderOptions) {
          colorSpace = Name.get("DeviceRGBA");
        } else {
          switch (image.numComps) {
            case 1:
              colorSpace = Name.get("DeviceGray");
              break;
            case 3:
              colorSpace = Name.get("DeviceRGB");
              break;
            case 4:
              colorSpace = Name.get("DeviceCMYK");
              break;
            default:
              throw new Error(`Images with ${image.numComps} color components not supported.`);
          }
        }
      } else if (this.jpxDecoderOptions?.smaskInData) {
        colorSpace = Name.get("DeviceRGBA");
      }
      this.colorSpace = ColorSpaceUtils.parse({
        cs: colorSpace,
        xref,
        resources: isInline ? res : null,
        pdfFunctionFactory,
        globalColorSpaceCache,
        localColorSpaceCache
      });
      this.numComps = this.colorSpace.numComps;
      if (this.jpxDecoderOptions) {
        this.jpxDecoderOptions.numComponents = this.colorSpace.name === "DeviceRGBA" ? 0 : this.numComps;
        this.jpxDecoderOptions.isIndexedColormap = this.colorSpace.name === "Indexed";
      }
    } else {
      this.numComps = 1;
    }
    this.decode = dict.getArray("D", "Decode");
    this.needsDecode = false;
    if (this.decode && (this.colorSpace && !this.colorSpace.isDefaultDecode(this.decode, bitsPerComponent) || isMask && !ColorSpace.isDefaultDecode(this.decode, 1))) {
      this.needsDecode = true;
      const max = (1 << bitsPerComponent) - 1;
      this.decodeCoefficients = [];
      this.decodeAddends = [];
      const isIndexed = this.colorSpace?.name === "Indexed";
      for (let i = 0, j = 0; i < this.decode.length; i += 2, ++j) {
        const dmin = this.decode[i];
        const dmax = this.decode[i + 1];
        this.decodeCoefficients[j] = isIndexed ? (dmax - dmin) / max : dmax - dmin;
        this.decodeAddends[j] = isIndexed ? dmin : max * dmin;
      }
    }
    if (smask) {
      smask.fallbackDims ??= {
        width,
        height
      };
      this.smask = new PDFImage({
        xref,
        res,
        image: smask,
        isInline,
        pdfFunctionFactory,
        globalColorSpaceCache,
        localColorSpaceCache
      });
    } else if (mask) {
      if (mask instanceof BaseStream) {
        const maskDict = mask.dict,
          imageMask = maskDict.get("IM", "ImageMask");
        if (!imageMask) {
          warn("Ignoring /Mask in image without /ImageMask.");
        } else {
          mask.fallbackDims ??= {
            width,
            height
          };
          this.mask = new PDFImage({
            xref,
            res,
            image: mask,
            isInline,
            isMask: true,
            pdfFunctionFactory,
            globalColorSpaceCache,
            localColorSpaceCache
          });
        }
      } else {
        this.mask = mask;
      }
    }
  }
  static async buildImage({
    xref,
    res,
    image,
    isInline = false,
    pdfFunctionFactory,
    globalColorSpaceCache,
    localColorSpaceCache
  }) {
    const imageData = image;
    let smaskData = null;
    let maskData = null;
    const smask = image.dict.get("SMask");
    const mask = image.dict.get("Mask");
    if (smask) {
      if (smask instanceof BaseStream) {
        smaskData = smask;
      } else {
        warn("Unsupported /SMask format.");
      }
    } else if (mask) {
      if (mask instanceof BaseStream || Array.isArray(mask)) {
        maskData = mask;
      } else {
        warn("Unsupported /Mask format.");
      }
    }
    return new PDFImage({
      xref,
      res,
      image: imageData,
      isInline,
      smask: smaskData,
      mask: maskData,
      pdfFunctionFactory,
      globalColorSpaceCache,
      localColorSpaceCache
    });
  }
  static async createMask({
    image,
    isOffscreenCanvasSupported = false
  }) {
    const {
      dict
    } = image;
    const width = dict.get("W", "Width");
    const height = dict.get("H", "Height");
    const interpolate = dict.get("I", "Interpolate");
    const decode = dict.getArray("D", "Decode");
    const inverseDecode = decode?.[0] > 0;
    const computedLength = (width + 7 >> 3) * height;
    const imgArray = await image.getImageData(computedLength);
    const isSingleOpaquePixel = width === 1 && height === 1 && inverseDecode === (imgArray.length === 0 || !!(imgArray[0] & 128));
    if (isSingleOpaquePixel) {
      return {
        isSingleOpaquePixel
      };
    }
    if (isOffscreenCanvasSupported) {
      if (ImageResizer.needsToBeResized(width, height)) {
        const data = new Uint8ClampedArray(width * height * 4);
        convertBlackAndWhiteToRGBA({
          src: imgArray,
          dest: data,
          width,
          height,
          nonBlackColor: 0,
          inverseDecode
        });
        return ImageResizer.createImage({
          kind: ImageKind.RGBA_32BPP,
          data,
          width,
          height,
          interpolate
        });
      }
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      const imgData = ctx.createImageData(width, height);
      convertBlackAndWhiteToRGBA({
        src: imgArray,
        dest: imgData.data,
        width,
        height,
        nonBlackColor: 0,
        inverseDecode
      });
      ctx.putImageData(imgData, 0, 0);
      const bitmap = canvas.transferToImageBitmap();
      return {
        data: null,
        width,
        height,
        interpolate,
        bitmap
      };
    }
    const actualLength = imgArray.byteLength;
    const haveFullData = computedLength === actualLength;
    let data;
    if (image instanceof DecodeStream && (!inverseDecode || haveFullData)) {
      data = imgArray;
    } else if (!inverseDecode) {
      data = new Uint8Array(imgArray);
    } else {
      data = new Uint8Array(computedLength);
      data.set(imgArray);
      data.fill(0xff, actualLength);
    }
    if (inverseDecode) {
      for (let i = 0; i < actualLength; i++) {
        data[i] ^= 0xff;
      }
    }
    return {
      data,
      width,
      height,
      interpolate
    };
  }
  get drawWidth() {
    return Math.max(this.width, this.smask?.width || 0, this.mask?.width || 0);
  }
  get drawHeight() {
    return Math.max(this.height, this.smask?.height || 0, this.mask?.height || 0);
  }
  decodeBuffer(buffer) {
    const bpc = this.bpc;
    const numComps = this.numComps;
    const decodeAddends = this.decodeAddends;
    const decodeCoefficients = this.decodeCoefficients;
    const max = (1 << bpc) - 1;
    let i, ii;
    if (bpc === 1) {
      for (i = 0, ii = buffer.length; i < ii; i++) {
        buffer[i] = +!buffer[i];
      }
      return;
    }
    let index = 0;
    for (i = 0, ii = this.width * this.height; i < ii; i++) {
      for (let j = 0; j < numComps; j++) {
        buffer[index] = MathClamp(decodeAddends[j] + buffer[index] * decodeCoefficients[j], 0, max);
        index++;
      }
    }
  }
  getComponents(buffer) {
    const bpc = this.bpc;
    if (bpc === 8) {
      return buffer;
    }
    const width = this.width;
    const height = this.height;
    const numComps = this.numComps;
    const length = width * height * numComps;
    let bufferPos = 0;
    let output;
    if (bpc <= 8) {
      output = new Uint8Array(length);
    } else if (bpc <= 16) {
      output = new Uint16Array(length);
    } else {
      output = new Uint32Array(length);
    }
    const rowComps = width * numComps;
    const max = (1 << bpc) - 1;
    let i = 0,
      buf;
    if (bpc === 1) {
      let mask, loop1End, loop2End;
      for (let j = 0; j < height; j++) {
        loop1End = i + (rowComps & ~7);
        loop2End = i + rowComps;
        while (i < loop1End) {
          buf = buffer[bufferPos++];
          output[i] = buf >> 7 & 1;
          output[i + 1] = buf >> 6 & 1;
          output[i + 2] = buf >> 5 & 1;
          output[i + 3] = buf >> 4 & 1;
          output[i + 4] = buf >> 3 & 1;
          output[i + 5] = buf >> 2 & 1;
          output[i + 6] = buf >> 1 & 1;
          output[i + 7] = buf & 1;
          i += 8;
        }
        if (i < loop2End) {
          buf = buffer[bufferPos++];
          mask = 128;
          while (i < loop2End) {
            output[i++] = +!!(buf & mask);
            mask >>= 1;
          }
        }
      }
    } else {
      let bits = 0;
      buf = 0;
      for (i = 0; i < length; ++i) {
        if (i % rowComps === 0) {
          buf = 0;
          bits = 0;
        }
        while (bits < bpc) {
          buf = buf << 8 | buffer[bufferPos++];
          bits += 8;
        }
        const remainingBits = bits - bpc;
        output[i] = MathClamp(buf >> remainingBits, 0, max);
        buf &= (1 << remainingBits) - 1;
        bits = remainingBits;
      }
    }
    return output;
  }
  async fillOpacity(rgbaBuf, width, height, actualHeight, image) {
    let apply;
    if (this.smask) {
      apply = (buffer, options) => this.smask.fillGrayBuffer(buffer, {
        ...options,
        destWidth: width,
        destHeight: height
      });
    } else if (this.mask) {
      if (this.mask instanceof PDFImage) {
        apply = (buffer, options) => this.mask.fillGrayBuffer(buffer, {
          ...options,
          invertOutput: true,
          destWidth: width,
          destHeight: height
        });
      } else if (Array.isArray(this.mask)) {
        apply = (buffer, {
          maxRows,
          offset,
          stride
        }) => {
          for (let i = 0, ii = width * maxRows; i < ii; ++i) {
            let opacity = 0;
            const imageOffset = i * this.numComps;
            for (let j = 0; j < this.numComps; ++j) {
              const color = image[imageOffset + j];
              const maskOffset = j * 2;
              if (color < this.mask[maskOffset] || color > this.mask[maskOffset + 1]) {
                opacity = 255;
                break;
              }
            }
            buffer[i * stride + offset] = opacity;
          }
        };
      } else {
        throw new FormatError("Unknown mask format.");
      }
    } else {
      apply = (buffer, {
        maxRows,
        offset,
        stride
      }) => {
        for (let i = 0, ii = width * maxRows; i < ii; ++i) {
          buffer[i * stride + offset] = 255;
        }
      };
    }
    await apply(rgbaBuf, {
      maxRows: actualHeight,
      offset: 3,
      stride: 4
    });
  }
  static #undoPreblend(buffer, length, matteR, matteG, matteB) {
    for (let i = 0; i < length; i += 4) {
      const alpha = buffer[i + 3];
      if (alpha === 0) {
        buffer[i] = 255;
        buffer[i + 1] = 255;
        buffer[i + 2] = 255;
        continue;
      }
      const k = 255 / alpha;
      buffer[i] = (buffer[i] - matteR) * k + matteR;
      buffer[i + 1] = (buffer[i + 1] - matteG) * k + matteG;
      buffer[i + 2] = (buffer[i + 2] - matteB) * k + matteB;
    }
  }
  undoPreblend(buffer, width, height) {
    const matte = this.smask?.matte;
    if (!matte) {
      return;
    }
    const matteRgb = this.colorSpace.getRgb(matte, 0);
    PDFImage.#undoPreblend(buffer, width * height * 4, matteRgb[0], matteRgb[1], matteRgb[2]);
  }
  async createImageData(forceRGBA = false, isOffscreenCanvasSupported = false) {
    const drawWidth = this.drawWidth;
    const drawHeight = this.drawHeight;
    const imgData = {
      width: drawWidth,
      height: drawHeight,
      interpolate: this.interpolate,
      kind: 0,
      data: null
    };
    const numComps = this.numComps;
    const originalWidth = this.width;
    const originalHeight = this.height;
    const bpc = this.bpc;
    const rowBytes = originalWidth * numComps * bpc + 7 >> 3;
    const mustBeResized = isOffscreenCanvasSupported && ImageResizer.needsToBeResized(drawWidth, drawHeight);
    if (!this.smask && !this.mask && this.colorSpace.name === "DeviceRGBA") {
      imgData.kind = ImageKind.RGBA_32BPP;
      const imgArray = imgData.data = await this.getImageBytes(originalHeight * originalWidth * 4, {
        internal: isOffscreenCanvasSupported && mustBeResized
      });
      if (this.jpxPremultiplied) {
        const matteRgb = this.preblendMatte;
        PDFImage.#undoPreblend(imgArray, imgArray.length, matteRgb?.[0] ?? 0, matteRgb?.[1] ?? 0, matteRgb?.[2] ?? 0);
      }
      if (isOffscreenCanvasSupported) {
        if (!mustBeResized) {
          return this.createBitmap(ImageKind.RGBA_32BPP, drawWidth, drawHeight, imgArray);
        }
        return ImageResizer.createImage(imgData, false);
      }
      return imgData;
    }
    if (!forceRGBA && !this.smask && !this.mask) {
      let kind;
      if (this.colorSpace.name === "DeviceGray" && bpc === 1) {
        kind = ImageKind.GRAYSCALE_1BPP;
      } else if (this.colorSpace.name === "DeviceRGB" && bpc === 8 && !this.needsDecode) {
        kind = ImageKind.RGB_24BPP;
      }
      if (kind && drawWidth === originalWidth && drawHeight === originalHeight) {
        const image = await this.#getImage(originalWidth, originalHeight);
        if (image) {
          return image;
        }
        const data = await this.getImageBytes(originalHeight * rowBytes, {
          internal: isOffscreenCanvasSupported && mustBeResized
        });
        if (isOffscreenCanvasSupported) {
          if (mustBeResized) {
            return ImageResizer.createImage({
              data,
              kind,
              width: drawWidth,
              height: drawHeight,
              interpolate: this.interpolate
            }, this.needsDecode);
          }
          return this.createBitmap(kind, originalWidth, originalHeight, data);
        }
        imgData.kind = kind;
        imgData.data = data;
        if (this.needsDecode) {
          assert(kind === ImageKind.GRAYSCALE_1BPP, "PDFImage.createImageData: The image must be grayscale.");
          const buffer = imgData.data;
          for (let i = 0, ii = buffer.length; i < ii; i++) {
            buffer[i] ^= 0xff;
          }
        }
        return imgData;
      }
      if (this.image instanceof JpegStream && !this.needsDecode) {
        let isHandled = false;
        switch (this.colorSpace.name) {
          case "DeviceGray":
          case "DeviceRGB":
          case "DeviceCMYK":
            isHandled = true;
            break;
        }
        if (isHandled) {
          if (isOffscreenCanvasSupported) {
            const image = await this.#getImage(drawWidth, drawHeight);
            if (image) {
              return image;
            }
          }
          let imageLength = originalHeight * rowBytes;
          if (isOffscreenCanvasSupported && !mustBeResized) {
            switch (this.colorSpace.name) {
              case "DeviceGray":
                imageLength *= 4;
                break;
              case "DeviceRGB":
                imageLength = imageLength / 3 * 4;
                break;
            }
            const rgba = await this.getImageBytes(imageLength, {
              drawWidth,
              drawHeight,
              forceRGBA: true,
              internal: true
            });
            return this.createBitmap(ImageKind.RGBA_32BPP, drawWidth, drawHeight, rgba);
          }
          if (this.colorSpace.name === "DeviceGray") {
            imageLength *= 3;
          }
          imgData.kind = ImageKind.RGB_24BPP;
          imgData.data = await this.getImageBytes(imageLength, {
            drawWidth,
            drawHeight,
            forceRGB: true,
            internal: mustBeResized
          });
          return mustBeResized ? ImageResizer.createImage(imgData) : imgData;
        }
      }
    }
    if (mustBeResized && !Array.isArray(this.mask)) {
      const reducePower = ImageResizer.getReducePower(drawWidth, drawHeight);
      const width = Math.max(1, drawWidth >> reducePower);
      const height = Math.max(1, drawHeight >> reducePower);
      if (!ImageResizer.needsToBeResized(width, height)) {
        const rgba = new Uint8ClampedArray(width * height * 4);
        await this._fillDownscaledRgba(rgba, width, height);
        return this.createBitmap(ImageKind.RGBA_32BPP, width, height, rgba);
      }
    }
    const imgArray = await this.getImageBytes(originalHeight * rowBytes, {
      internal: true
    });
    const actualHeight = 0 | imgArray.length / rowBytes * drawHeight / originalHeight;
    const comps = this.getComponents(imgArray);
    let alpha01, maybeUndoPreblend;
    let canvas, ctx, canvasImgData, data;
    if (isOffscreenCanvasSupported && !mustBeResized) {
      canvas = new OffscreenCanvas(drawWidth, drawHeight);
      ctx = canvas.getContext("2d");
      canvasImgData = ctx.createImageData(drawWidth, drawHeight);
      data = canvasImgData.data;
    }
    imgData.kind = ImageKind.RGBA_32BPP;
    if (!forceRGBA && !this.smask && !this.mask) {
      if (!isOffscreenCanvasSupported || mustBeResized) {
        imgData.kind = ImageKind.RGB_24BPP;
        data = new Uint8ClampedArray(drawWidth * drawHeight * 3);
        alpha01 = 0;
      } else {
        const arr = new Uint32Array(data.buffer);
        arr.fill(FeatureTest.isLittleEndian ? 0xff000000 : 0x000000ff);
        alpha01 = 1;
      }
      maybeUndoPreblend = false;
    } else {
      if (!isOffscreenCanvasSupported || mustBeResized) {
        data = new Uint8ClampedArray(drawWidth * drawHeight * 4);
      }
      alpha01 = 1;
      maybeUndoPreblend = true;
      await this.fillOpacity(data, drawWidth, drawHeight, actualHeight, comps);
    }
    if (this.needsDecode) {
      this.decodeBuffer(comps);
    }
    this.colorSpace.fillRgb(data, originalWidth, originalHeight, drawWidth, drawHeight, actualHeight, bpc, comps, alpha01);
    if (maybeUndoPreblend) {
      this.undoPreblend(data, drawWidth, actualHeight);
    }
    if (isOffscreenCanvasSupported && !mustBeResized) {
      ctx.putImageData(canvasImgData, 0, 0);
      const bitmap = canvas.transferToImageBitmap();
      return {
        data: null,
        width: drawWidth,
        height: drawHeight,
        bitmap,
        interpolate: this.interpolate
      };
    }
    imgData.data = data;
    return mustBeResized ? ImageResizer.createImage(imgData) : imgData;
  }
  async fillGrayBuffer(buffer, {
    destWidth,
    destHeight,
    invertOutput,
    maxRows,
    offset = 0,
    stride = 1
  } = {}) {
    const numComps = this.numComps;
    if (numComps !== 1) {
      throw new FormatError(`Reading gray scale from a color image: ${numComps}`);
    }
    const srcWidth = this.width;
    const srcHeight = this.height;
    const bpc = this.bpc;
    const rowBytes = srcWidth * numComps * bpc + 7 >> 3;
    const imgArray = await this.getImageBytes(srcHeight * rowBytes, {
      internal: true
    });
    const comps = this.getComponents(imgArray);
    const resolvedDestWidth = destWidth ?? srcWidth;
    const resolvedDestHeight = destHeight ?? srcHeight;
    const needsResampling = resolvedDestWidth !== srcWidth || resolvedDestHeight !== srcHeight;
    const rows = maxRows === undefined ? resolvedDestHeight : Math.min(resolvedDestHeight, maxRows);
    let outputWidth = srcWidth;
    let yRatio = 0;
    let xScaled = null;
    if (needsResampling) {
      outputWidth = resolvedDestWidth;
      yRatio = srcHeight / resolvedDestHeight;
      const xRatio = srcWidth / resolvedDestWidth;
      xScaled = new Uint32Array(resolvedDestWidth);
      for (let i = 0; i < resolvedDestWidth; i++) {
        xScaled[i] = Math.floor(i * xRatio);
      }
    }
    const mask = invertOutput ? 0xff : 0;
    if (bpc === 1) {
      if (xScaled) {
        const xMap = xScaled;
        let destIndex = offset;
        if (this.needsDecode) {
          for (let row = 0; row < rows; row++) {
            const py = Math.floor(row * yRatio) * srcWidth;
            for (let col = 0; col < outputWidth; col++) {
              buffer[destIndex] = comps[py + xMap[col]] - 1 & 255 ^ mask;
              destIndex += stride;
            }
          }
        } else {
          for (let row = 0; row < rows; row++) {
            const py = Math.floor(row * yRatio) * srcWidth;
            for (let col = 0; col < outputWidth; col++) {
              buffer[destIndex] = -comps[py + xMap[col]] & 255 ^ mask;
              destIndex += stride;
            }
          }
        }
      } else {
        const length = outputWidth * rows;
        if (this.needsDecode) {
          for (let i = 0; i < length; ++i) {
            buffer[i * stride + offset] = comps[i] - 1 & 255 ^ mask;
          }
        } else {
          for (let i = 0; i < length; ++i) {
            buffer[i * stride + offset] = -comps[i] & 255 ^ mask;
          }
        }
      }
      return;
    }
    if (this.needsDecode) {
      this.decodeBuffer(comps);
    }
    const scale = 255 / ((1 << bpc) - 1);
    if (xScaled) {
      const xMap = xScaled;
      let destIndex = offset;
      for (let row = 0; row < rows; row++) {
        const py = Math.floor(row * yRatio) * srcWidth;
        for (let col = 0; col < outputWidth; col++) {
          buffer[destIndex] = scale * comps[py + xMap[col]] ^ mask;
          destIndex += stride;
        }
      }
    } else {
      const length = outputWidth * rows;
      for (let i = 0; i < length; ++i) {
        buffer[i * stride + offset] = scale * comps[i] ^ mask;
      }
    }
  }
  #fillDownscaledColorMapImage(dest, comps, width, height, rows) {
    const {
      width: srcWidth,
      height: srcHeight,
      bpc,
      colorSpace
    } = this;
    const colorMap = colorSpace.getColorMap(bpc);
    const xBounds = new Uint32Array(width + 1);
    for (let x = 0; x <= width; x++) {
      xBounds[x] = Math.floor(x * srcWidth / width);
    }
    let destIndex = 0;
    for (let row = 0; row < rows; row++) {
      const y0 = Math.floor(row * srcHeight / height);
      const y1 = Math.floor((row + 1) * srcHeight / height);
      for (let col = 0; col < width; col++, destIndex += 4) {
        const x0 = xBounds[col],
          x1 = xBounds[col + 1];
        let r = 0,
          g = 0,
          b = 0;
        for (let y = y0; y < y1; y++) {
          const offset = y * srcWidth;
          for (let x = offset + x0, end = offset + x1; x < end; x++) {
            const i = comps[x] * 3;
            r += colorMap[i];
            g += colorMap[i + 1];
            b += colorMap[i + 2];
          }
        }
        const area = (y1 - y0) * (x1 - x0);
        dest[destIndex] = r / area;
        dest[destIndex + 1] = g / area;
        dest[destIndex + 2] = b / area;
        dest[destIndex + 3] = 255;
      }
    }
  }
  async _fillDownscaledRgba(dest, width, height) {
    const {
      width: srcWidth,
      height: srcHeight,
      numComps,
      bpc,
      colorSpace
    } = this;
    const fullWidth = this.drawWidth;
    const fullHeight = this.drawHeight;
    const rowBytes = srcWidth * numComps * bpc + 7 >> 3;
    const imgArray = await this.getImageBytes(srcHeight * rowBytes, {
      internal: true
    });
    const rows = Math.min(height, imgArray.length / rowBytes * height / srcHeight | 0);
    const comps = this.getComponents(imgArray);
    if (this.needsDecode) {
      this.decodeBuffer(comps);
    }
    if (!this.smask && !this.mask && numComps === 1 && bpc <= 8) {
      this.#fillDownscaledColorMapImage(dest, comps, width, height, rows);
      return;
    }
    const alphaImage = this.smask || this.mask;
    let alpha = null,
      alphaWidth = 0,
      alphaHeight = 0;
    if (alphaImage) {
      ({
        width: alphaWidth,
        height: alphaHeight
      } = alphaImage);
      alpha = new Uint8ClampedArray(alphaWidth * alphaHeight);
      await alphaImage.fillGrayBuffer(alpha, {
        invertOutput: !this.smask
      });
    }
    const matte = this.smask?.matte;
    const matteRgb = matte ? colorSpace.getRgb(matte, 0) : null;
    const rgbX = new Uint32Array(fullWidth);
    const alphaX = new Uint32Array(alpha ? fullWidth : 0);
    for (let x = 0; x < fullWidth; x++) {
      rgbX[x] = Math.floor(x * srcWidth / fullWidth) * 3;
    }
    for (let x = 0, ii = alphaX.length; x < ii; x++) {
      alphaX[x] = Math.floor(x * alphaWidth / fullWidth);
    }
    const xBounds = new Uint32Array(width + 1);
    for (let i = 0; i <= width; i++) {
      xBounds[i] = Math.floor(i * fullWidth / width);
    }
    const rowComps = srcWidth * numComps;
    const chunkRows = Math.min(srcHeight, Math.ceil(2 ** 20 / srcWidth));
    const rgbChunk = new Uint8ClampedArray(chunkRows * srcWidth * 3);
    let chunkStart = 0,
      chunkEnd = 0;
    const sums = new Float64Array(fullWidth * 4);
    let destIndex = 0;
    for (let row = 0; row < rows; row++) {
      const y0 = Math.floor(row * fullHeight / height);
      const y1 = Math.floor((row + 1) * fullHeight / height);
      sums.fill(0);
      for (let y = y0; y < y1; y++) {
        const srcY = Math.floor(y * srcHeight / fullHeight);
        if (srcY >= chunkEnd) {
          chunkStart = srcY;
          chunkEnd = Math.min(srcY + chunkRows, srcHeight);
          const n = chunkEnd - chunkStart;
          colorSpace.fillRgb(rgbChunk, srcWidth, n, srcWidth, n, n, bpc, comps.subarray(chunkStart * rowComps, chunkEnd * rowComps), 0);
        }
        const rgbRow = rgbChunk.subarray((srcY - chunkStart) * srcWidth * 3);
        if (!alpha) {
          sumOpaqueRow(sums, rgbRow, rgbX);
          continue;
        }
        const alphaOffset = Math.floor(y * alphaHeight / fullHeight) * alphaWidth;
        if (matteRgb) {
          sumPreblendedRow(sums, rgbRow, rgbX, alpha, alphaOffset, alphaX, matteRgb);
        } else {
          sumTransparentRow(sums, rgbRow, rgbX, alpha, alphaOffset, alphaX);
        }
      }
      for (let i = 0; i < width; i++, destIndex += 4) {
        const xStart = xBounds[i],
          xEnd = xBounds[i + 1];
        let r = 0,
          g = 0,
          b = 0,
          a = 0;
        for (let k = xStart * 4, kEnd = xEnd * 4; k < kEnd; k += 4) {
          r += sums[k];
          g += sums[k + 1];
          b += sums[k + 2];
          a += sums[k + 3];
        }
        const area = (y1 - y0) * (xEnd - xStart);
        if (!alpha) {
          dest[destIndex] = r / area;
          dest[destIndex + 1] = g / area;
          dest[destIndex + 2] = b / area;
          dest[destIndex + 3] = 255;
        } else if (a > 0) {
          dest[destIndex] = r / a;
          dest[destIndex + 1] = g / a;
          dest[destIndex + 2] = b / a;
          dest[destIndex + 3] = a / area;
        }
      }
    }
  }
  createBitmap(kind, width, height, src) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    let imgData;
    if (kind === ImageKind.RGBA_32BPP) {
      imgData = new ImageData(src, width, height);
    } else {
      imgData = ctx.createImageData(width, height);
      convertToRGBA({
        kind,
        src,
        dest: new Uint32Array(imgData.data.buffer),
        width,
        height,
        inverseDecode: this.needsDecode
      });
    }
    ctx.putImageData(imgData, 0, 0);
    const bitmap = canvas.transferToImageBitmap();
    return {
      data: null,
      width,
      height,
      bitmap,
      interpolate: this.interpolate
    };
  }
  async #getImage(width, height) {
    const bitmap = await this.image.getTransferableImage(width, height);
    if (!bitmap) {
      return null;
    }
    return {
      data: null,
      width: bitmap.displayWidth ?? width,
      height: bitmap.displayHeight ?? height,
      bitmap,
      interpolate: this.interpolate
    };
  }
  async getImageBytes(length, {
    drawWidth,
    drawHeight,
    forceRGBA = false,
    forceRGB = false,
    internal = false
  }) {
    this.image.reset();
    this.image.drawWidth = drawWidth || this.width;
    this.image.drawHeight = drawHeight || this.height;
    this.image.forceRGBA = !!forceRGBA;
    this.image.forceRGB = !!forceRGB;
    const imageBytes = await this.image.getImageData(length, this.jpxDecoderOptions);
    if (internal || this.image instanceof DecodeStream) {
      return imageBytes;
    }
    assert(imageBytes instanceof Uint8Array, 'PDFImage.getImageBytes: Unsupported "imageBytes" type.');
    return new Uint8Array(imageBytes);
  }
}
export { PDFImage };