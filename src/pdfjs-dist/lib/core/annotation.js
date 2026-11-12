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
import "core-js/modules/es.array.includes.js";
import "core-js/modules/es.array.push.js";
import "core-js/modules/es.iterator.constructor.js";
import "core-js/modules/es.iterator.every.js";
import "core-js/modules/es.iterator.filter.js";
import "core-js/modules/es.iterator.find.js";
import "core-js/modules/es.iterator.map.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import "core-js/modules/es.math.sum-precise.js";
import "core-js/modules/es.typed-array.with.js";
import { AnnotationActionEventType, AnnotationBorderStyleType, AnnotationEditorType, AnnotationFieldFlag, AnnotationFlag, AnnotationRenditionOperation, AnnotationReplyType, AnnotationType, assert, BASELINE_FACTOR, BBOX_INIT, F32_BBOX_INIT, info, isArrayEqual, LINE_DESCENT_FACTOR, LINE_FACTOR, OPS, RenderingIntentFlag, shadow, unreachable, Util, warn } from "../shared/util.js";
import { collectActions, escapeString, getInheritableProperty, getModificationDate, getParentToUpdate, getRotationMatrix, IDENTITY_MATRIX, isNumberArray, lookupMatrix, lookupNormalRect, lookupRect, MissingDataException, numberToString, RESOURCES_KEYS_OPERATOR_LIST, RESOURCES_KEYS_TEXT_CONTENT } from "./core_utils.js";
import { createDefaultAppearance, FakeUnicodeFont, getPdfColor, parseAppearanceStream, parseDefaultAppearance } from "./default_appearance.js";
import { DateFormats, TimeFormats } from "../shared/scripting_utils.js";
import { Dict, isName, isRefsEqual, Name, Ref, RefSet } from "./primitives.js";
import { stringToAsciiOrUTF16BE, stringToPDFString, stringToUTF16String } from "./string_utils.js";
import { BaseStream } from "./base_stream.js";
import { bidi } from "./bidi.js";
import { Catalog } from "./catalog.js";
import { ColorSpaceUtils } from "./colorspace_utils.js";
import { createImage } from "./editor/pdf_images.js";
import { FileSpec } from "./file_spec.js";
import { getMetrics } from "./metrics.js";
import { getSoundFormat } from "./sound.js";
import { JpegStream } from "./jpeg_stream.js";
import { MathClamp } from "../shared/math_clamp.js";
import { ObjectLoader } from "./object_loader.js";
import { OperatorList } from "./operator_list.js";
import { parseMarkedContentProps } from "./evaluator_utils.js";
import { StringStream } from "./stream.js";
import { XFAFactory } from "./xfa/factory.js";
import { ZapfDingbatsEncoding } from "./encodings.js";
class AnnotationFactory {
  static createGlobals(pdfManager) {
    return Promise.all([pdfManager.ensureCatalog("acroForm"), pdfManager.ensureDoc("xfaDatasets"), pdfManager.ensureCatalog("structTreeRoot"), pdfManager.ensureCatalog("baseUrl"), pdfManager.ensureCatalog("attachments"), pdfManager.ensureCatalog("globalColorSpaceCache")]).then(([acroForm, xfaDatasets, structTreeRoot, baseUrl, attachments, globalColorSpaceCache]) => ({
      pdfManager,
      catalog: pdfManager.pdfDocument.catalog,
      acroForm: acroForm instanceof Dict ? acroForm : Dict.empty,
      xfaDatasets,
      structTreeRoot,
      baseUrl,
      attachments,
      globalColorSpaceCache
    }), reason => {
      warn(`createGlobals: "${reason}".`);
      return null;
    });
  }
  static async create(xref, ref, annotationGlobals, idFactory, collectFields, orphanFields, collectByType, pageRef) {
    const pageIndex = collectFields ? await this._getPageIndex(xref, ref, annotationGlobals.pdfManager) : null;
    return annotationGlobals.pdfManager.ensure(this, "_create", [xref, ref, annotationGlobals, idFactory, collectFields, orphanFields, collectByType, pageIndex, pageRef]);
  }
  static _create(xref, ref, annotationGlobals, idFactory, collectFields = false, orphanFields = null, collectByType = null, pageIndex = null, pageRef = null) {
    const dict = xref.fetchIfRef(ref);
    if (!(dict instanceof Dict)) {
      return undefined;
    }
    let subtype = dict.get("Subtype");
    subtype = subtype instanceof Name ? subtype.name : null;
    if (collectByType && !collectByType.has(AnnotationType[subtype?.toUpperCase()])) {
      return null;
    }
    const {
      acroForm,
      pdfManager
    } = annotationGlobals;
    const id = ref instanceof Ref ? ref.toString() : `annot_${idFactory.createObjId()}`;
    const parameters = {
      xref,
      ref,
      dict,
      subtype,
      id,
      annotationGlobals,
      collectFields,
      orphanFields,
      needAppearances: !collectFields && acroForm.get("NeedAppearances") === true,
      pageIndex,
      evaluatorOptions: pdfManager.evaluatorOptions,
      pageRef
    };
    switch (subtype) {
      case "Link":
        return new LinkAnnotation(parameters);
      case "Text":
        return new TextAnnotation(parameters);
      case "Widget":
        let fieldType = getInheritableProperty({
          dict,
          key: "FT"
        });
        fieldType = fieldType instanceof Name ? fieldType.name : null;
        switch (fieldType) {
          case "Tx":
            return new TextWidgetAnnotation(parameters);
          case "Btn":
            return new ButtonWidgetAnnotation(parameters);
          case "Ch":
            return new ChoiceWidgetAnnotation(parameters);
          case "Sig":
            return new SignatureWidgetAnnotation(parameters);
        }
        warn(`Unimplemented widget field type "${fieldType}", ` + "falling back to base field type.");
        return new WidgetAnnotation(parameters);
      case "Popup":
        return new PopupAnnotation(parameters);
      case "FreeText":
        return new FreeTextAnnotation(parameters);
      case "Line":
        return new LineAnnotation(parameters);
      case "Square":
        return new SquareAnnotation(parameters);
      case "Circle":
        return new CircleAnnotation(parameters);
      case "PolyLine":
        return new PolylineAnnotation(parameters);
      case "Polygon":
        return new PolygonAnnotation(parameters);
      case "Caret":
        return new CaretAnnotation(parameters);
      case "Ink":
        return new InkAnnotation(parameters);
      case "Highlight":
        return new HighlightAnnotation(parameters);
      case "Underline":
        return new UnderlineAnnotation(parameters);
      case "Squiggly":
        return new SquigglyAnnotation(parameters);
      case "StrikeOut":
        return new StrikeOutAnnotation(parameters);
      case "Stamp":
        return new StampAnnotation(parameters);
      case "FileAttachment":
        return new FileAttachmentAnnotation(parameters);
      case "RichMedia":
        return new RichMediaAnnotation(parameters);
      case "Screen":
        return new ScreenAnnotation(parameters);
      case "Sound":
        return new SoundAnnotation(parameters);
      default:
        if (!collectFields) {
          if (!subtype) {
            warn("Annotation is missing the required /Subtype.");
          } else {
            warn(`Unimplemented annotation type "${subtype}", ` + "falling back to base annotation.");
          }
        }
        return new Annotation(parameters);
    }
  }
  static async _getPageIndex(xref, ref, pdfManager) {
    try {
      const annotDict = await xref.fetchIfRefAsync(ref);
      if (!(annotDict instanceof Dict)) {
        return -1;
      }
      const pageRef = annotDict.getRaw("P");
      if (pageRef instanceof Ref) {
        try {
          return await pdfManager.ensureCatalog("getPageIndex", [pageRef]);
        } catch (ex) {
          info(`_getPageIndex -- not a valid page reference: "${ex}".`);
        }
      }
      if (annotDict.has("Kids")) {
        return -1;
      }
      const numPages = await pdfManager.ensureDoc("numPages");
      for (let pageIndex = 0; pageIndex < numPages; pageIndex++) {
        const page = await pdfManager.getPage(pageIndex);
        const annotations = await pdfManager.ensure(page, "annotations");
        for (const annotRef of annotations) {
          if (annotRef instanceof Ref && isRefsEqual(annotRef, ref)) {
            return pageIndex;
          }
        }
      }
    } catch (ex) {
      warn(`_getPageIndex: "${ex}".`);
    }
    return -1;
  }
  static generateImages(annotations, xref, isOffscreenCanvasSupported) {
    if (!isOffscreenCanvasSupported) {
      warn("generateImages: OffscreenCanvas is not supported, cannot save or print some annotations with images.");
      return null;
    }
    let imagePromises;
    for (const {
      bitmapId,
      bitmap
    } of annotations) {
      if (!bitmap) {
        continue;
      }
      imagePromises ||= new Map();
      imagePromises.set(bitmapId, createImage(bitmap, xref));
    }
    return imagePromises;
  }
  static getPrintData(annotation) {
    throw new Error("Not implemented: getPrintData");
  }
  static async saveNewAnnotations(evaluator, xref, task, annotations, imagePromises, changes) {
    let baseFontRef;
    const promises = [];
    const {
      isOffscreenCanvasSupported
    } = evaluator.options;
    for (const annotation of annotations) {
      if (annotation.deleted) {
        continue;
      }
      switch (annotation.annotationType) {
        case AnnotationEditorType.FREETEXT:
          if (!annotation.appearanceRef && !baseFontRef) {
            const baseFont = new Dict(xref);
            baseFont.setIfName("BaseFont", "Helvetica");
            baseFont.setIfName("Type", "Font");
            baseFont.setIfName("Subtype", "Type1");
            baseFont.setIfName("Encoding", "WinAnsiEncoding");
            baseFontRef = xref.getNewTemporaryRef();
            changes.put(baseFontRef, {
              data: baseFont
            });
          }
          promises.push(FreeTextAnnotation.createNewAnnotation(xref, annotation, changes, {
            evaluator,
            task,
            baseFontRef
          }));
          break;
        case AnnotationEditorType.HIGHLIGHT:
          if (annotation.quadPoints) {
            promises.push(HighlightAnnotation.createNewAnnotation(xref, annotation, changes));
          } else {
            promises.push(InkAnnotation.createNewAnnotation(xref, annotation, changes));
          }
          break;
        case AnnotationEditorType.INK:
          promises.push(InkAnnotation.createNewAnnotation(xref, annotation, changes));
          break;
        case AnnotationEditorType.STAMP:
          const image = isOffscreenCanvasSupported ? await imagePromises?.get(annotation.bitmapId) : null;
          if (image?.imageStream) {
            const {
              imageStream,
              smaskStream
            } = image;
            if (smaskStream) {
              const smaskRef = xref.getNewTemporaryRef();
              changes.put(smaskRef, {
                data: smaskStream
              });
              imageStream.dict.set("SMask", smaskRef);
            }
            const imageRef = image.imageRef = xref.getNewTemporaryRef();
            changes.put(imageRef, {
              data: imageStream
            });
            image.imageStream = null;
            image.imageRenderStream = null;
            image.smaskStream = null;
            image.smaskRenderStream = null;
          }
          promises.push(StampAnnotation.createNewAnnotation(xref, annotation, changes, {
            image
          }));
          break;
        case AnnotationEditorType.SIGNATURE:
          promises.push(StampAnnotation.createNewAnnotation(xref, annotation, changes, {}));
          break;
      }
    }
    return {
      annotations: (await Promise.all(promises)).flat()
    };
  }
  static async printNewAnnotations(annotationGlobals, evaluator, task, annotations, imagePromises) {
    if (!annotations) {
      return null;
    }
    const {
      options,
      xref
    } = evaluator;
    const promises = [];
    for (const annotation of annotations) {
      if (annotation.deleted) {
        continue;
      }
      switch (annotation.annotationType) {
        case AnnotationEditorType.FREETEXT:
          promises.push(FreeTextAnnotation.createNewPrintAnnotation(annotationGlobals, xref, annotation, {
            evaluator,
            task,
            evaluatorOptions: options
          }));
          break;
        case AnnotationEditorType.HIGHLIGHT:
          if (annotation.quadPoints) {
            promises.push(HighlightAnnotation.createNewPrintAnnotation(annotationGlobals, xref, annotation, {
              evaluatorOptions: options
            }));
          } else {
            promises.push(InkAnnotation.createNewPrintAnnotation(annotationGlobals, xref, annotation, {
              evaluatorOptions: options
            }));
          }
          break;
        case AnnotationEditorType.INK:
          promises.push(InkAnnotation.createNewPrintAnnotation(annotationGlobals, xref, annotation, {
            evaluatorOptions: options
          }));
          break;
        case AnnotationEditorType.STAMP:
          const image = options.isOffscreenCanvasSupported ? await imagePromises?.get(annotation.bitmapId) : null;
          if (image?.imageStream) {
            const {
              imageStream,
              imageRenderStream,
              smaskStream,
              smaskRenderStream
            } = image;
            const imageRef = imageRenderStream || new JpegStream(imageStream, imageStream.length);
            if (smaskStream || smaskRenderStream) {
              imageRef.dict.set("SMask", smaskRenderStream || smaskStream);
            }
            image.imageRef = imageRef;
            image.imageStream = null;
            image.imageRenderStream = null;
            image.smaskStream = null;
            image.smaskRenderStream = null;
          }
          promises.push(StampAnnotation.createNewPrintAnnotation(annotationGlobals, xref, annotation, {
            image,
            evaluatorOptions: options
          }));
          break;
        case AnnotationEditorType.SIGNATURE:
          promises.push(StampAnnotation.createNewPrintAnnotation(annotationGlobals, xref, annotation, {
            evaluatorOptions: options
          }));
          break;
      }
    }
    return Promise.all(promises);
  }
}
function getRgbColor(color, defaultColor = new Uint8ClampedArray(3)) {
  if (!Array.isArray(color)) {
    return defaultColor;
  }
  const rgbColor = defaultColor || new Uint8ClampedArray(3);
  switch (color.length) {
    case 0:
      return null;
    case 1:
      ColorSpaceUtils.gray.getRgbItem(color, 0, rgbColor, 0);
      return rgbColor;
    case 3:
      ColorSpaceUtils.rgb.getRgbItem(color, 0, rgbColor, 0);
      return rgbColor;
    case 4:
      ColorSpaceUtils.cmyk.getRgbItem(color, 0, rgbColor, 0);
      return rgbColor;
    default:
      return defaultColor;
  }
}
function getPdfColorArray(color, defaultValue = null) {
  return color && Array.from(color, c => c / 255) || defaultValue;
}
function getQuadPoints(dict, rect) {
  const quadPoints = dict.getArray("QuadPoints");
  if (!isNumberArray(quadPoints, null) || quadPoints.length === 0 || quadPoints.length % 8 > 0) {
    return null;
  }
  const newQuadPoints = new Float32Array(quadPoints.length);
  for (let i = 0, ii = quadPoints.length; i < ii; i += 8) {
    const [x1, y1, x2, y2, x3, y3, x4, y4] = quadPoints.slice(i, i + 8);
    const minX = Math.min(x1, x2, x3, x4);
    const maxX = Math.max(x1, x2, x3, x4);
    const minY = Math.min(y1, y2, y3, y4);
    const maxY = Math.max(y1, y2, y3, y4);
    if (rect !== null && (minX < rect[0] || maxX > rect[2] || minY < rect[1] || maxY > rect[3])) {
      return null;
    }
    newQuadPoints.set([minX, maxY, maxX, maxY, minX, minY, maxX, minY], i);
  }
  return newQuadPoints;
}
function getTransformMatrix(rect, bbox, matrix) {
  const minMax = F32_BBOX_INIT.slice();
  Util.axialAlignedBoundingBox(bbox, matrix, minMax);
  const [minX, minY, maxX, maxY] = minMax;
  if (minX === maxX || minY === maxY) {
    return [1, 0, 0, 1, rect[0], rect[1]];
  }
  const xRatio = (rect[2] - rect[0]) / (maxX - minX);
  const yRatio = (rect[3] - rect[1]) / (maxY - minY);
  return [xRatio, 0, 0, yRatio, rect[0] - minX * xRatio, rect[1] - minY * yRatio];
}
function writeLineToCurveToAppearance(data, buffer, maybeClose = false) {
  buffer.push(`${numberToString(data[4])} ${numberToString(data[5])} m`);
  for (let i = 6, ii = data.length; i < ii; i += 6) {
    if (isNaN(data[i])) {
      buffer.push(`${numberToString(data[i + 4])} ${numberToString(data[i + 5])} l`);
    } else {
      const curve = data.slice(i, i + 6);
      buffer.push(`${curve.map(numberToString).join(" ")} c`);
    }
  }
  if (maybeClose && data.length === 6) {
    buffer.push(`${numberToString(data[4])} ${numberToString(data[5])} l`);
  }
}
class Annotation {
  appearance = null;
  _oc = undefined;
  constructor(params) {
    const {
      annotationGlobals,
      dict,
      orphanFields,
      ref,
      subtype,
      xref
    } = params;
    const parentRef = orphanFields?.get(ref);
    if (parentRef) {
      dict.set("Parent", parentRef);
    }
    this.setTitle(dict.get("T"));
    this.setContents(dict.get("Contents"));
    this.setModificationDate(dict.get("M"));
    this.setFlags(dict.get("F"));
    this.setRectangle(dict.getArray("Rect"));
    this.setColor(dict.getArray("C"));
    this.setBorderStyle(dict);
    this.setAppearance(dict);
    this.#setOptionalContent(xref, dict);
    const MK = dict.get("MK");
    this.setBorderAndBackgroundColors(MK);
    this.setRotation(MK, dict);
    this.ref = params.ref instanceof Ref ? params.ref : null;
    this._streams = [];
    if (this.appearance) {
      this._streams.push(this.appearance);
    }
    const isLocked = !!(this.flags & AnnotationFlag.LOCKED);
    const isContentLocked = !!(this.flags & AnnotationFlag.LOCKEDCONTENTS);
    this.data = {
      annotationType: AnnotationType[subtype?.toUpperCase()],
      annotationFlags: this.flags,
      borderStyle: this.borderStyle,
      color: this.color,
      backgroundColor: this.backgroundColor,
      borderColor: this.borderColor,
      rotation: this.rotation,
      contentsObj: this._contents,
      hasAppearance: !!this.appearance,
      id: params.id,
      modificationDate: this.modificationDate,
      oc: this._oc,
      rect: this.rectangle,
      subtype,
      hasOwnCanvas: false,
      noRotate: !!(this.flags & AnnotationFlag.NOROTATE),
      noHTML: isLocked && isContentLocked,
      isEditable: false,
      structParent: -1
    };
    if (annotationGlobals.structTreeRoot) {
      let structParent = dict.get("StructParent");
      this.data.structParent = structParent = Number.isInteger(structParent) && structParent >= 0 ? structParent : -1;
      annotationGlobals.structTreeRoot.addAnnotationIdToPage(params.pageRef, structParent, this.ref);
    }
    if (params.collectFields) {
      const kids = dict.get("Kids");
      if (Array.isArray(kids)) {
        const kidIds = [];
        for (const kid of kids) {
          if (kid instanceof Ref) {
            kidIds.push(kid.toString());
          }
        }
        if (kidIds.length !== 0) {
          this.data.kidIds = kidIds;
        }
      }
      this.data.actions = collectActions(xref, dict, AnnotationActionEventType);
      this.data.fieldName = this._constructFieldName(dict);
      this.data.pageIndex = params.pageIndex;
    }
    const it = dict.get("IT");
    if (it instanceof Name) {
      this.data.it = it.name;
    }
    this._isOffscreenCanvasSupported = params.evaluatorOptions.isOffscreenCanvasSupported;
    this._fallbackFontDict = null;
    this._needAppearances = false;
  }
  _getOperatorListNoAppearance() {
    return {
      opList: new OperatorList(),
      separateForm: false,
      separateCanvas: false
    };
  }
  _hasFlag(flags, flag) {
    return !!(flags & flag);
  }
  _buildFlags(noView, noPrint) {
    let {
      flags
    } = this;
    if (noView === undefined) {
      if (noPrint === undefined) {
        return undefined;
      }
      return noPrint ? flags & ~AnnotationFlag.PRINT : flags & ~AnnotationFlag.HIDDEN | AnnotationFlag.PRINT;
    }
    if (noView) {
      flags |= AnnotationFlag.PRINT;
      if (noPrint) {
        return flags & ~AnnotationFlag.NOVIEW | AnnotationFlag.HIDDEN;
      }
      return flags & ~AnnotationFlag.HIDDEN | AnnotationFlag.NOVIEW;
    }
    flags &= ~(AnnotationFlag.HIDDEN | AnnotationFlag.NOVIEW);
    if (noPrint) {
      return flags & ~AnnotationFlag.PRINT;
    }
    return flags | AnnotationFlag.PRINT;
  }
  _isViewable(flags) {
    return !this._hasFlag(flags, AnnotationFlag.INVISIBLE) && !this._hasFlag(flags, AnnotationFlag.NOVIEW);
  }
  _isPrintable(flags) {
    return this._hasFlag(flags, AnnotationFlag.PRINT) && !this._hasFlag(flags, AnnotationFlag.HIDDEN) && !this._hasFlag(flags, AnnotationFlag.INVISIBLE);
  }
  mustBeViewed(annotationStorage, _renderForms) {
    const noView = annotationStorage?.get(this.data.id)?.noView;
    return noView !== undefined ? !noView : this.viewable && !this._hasFlag(this.flags, AnnotationFlag.HIDDEN);
  }
  mustBePrinted(annotationStorage) {
    const noPrint = annotationStorage?.get(this.data.id)?.noPrint;
    return noPrint !== undefined ? !noPrint : this.printable;
  }
  mustBeViewedWhenEditing(isEditing, modifiedIds = null) {
    return isEditing ? !this.data.isEditable : !modifiedIds?.has(this.data.id);
  }
  get viewable() {
    return this.data.quadPoints !== null && (this.flags === 0 || this._isViewable(this.flags));
  }
  get printable() {
    return this.data.quadPoints !== null && this.flags !== 0 && this._isPrintable(this.flags);
  }
  _parseStringHelper(data) {
    const str = typeof data === "string" ? stringToPDFString(data) : "";
    const dir = str && bidi(str).dir === "rtl" ? "rtl" : "ltr";
    return {
      str,
      dir
    };
  }
  setDefaultAppearance(params) {
    const {
      dict,
      annotationGlobals
    } = params;
    const defaultAppearance = getInheritableProperty({
      dict,
      key: "DA"
    }) || annotationGlobals.acroForm.get("DA");
    this._defaultAppearance = typeof defaultAppearance === "string" ? defaultAppearance : "";
    this.data.defaultAppearanceData = parseDefaultAppearance(this._defaultAppearance);
  }
  setTitle(title) {
    this._title = this._parseStringHelper(title);
  }
  setContents(contents) {
    this._contents = this._parseStringHelper(contents);
  }
  setModificationDate(modificationDate) {
    this.modificationDate = typeof modificationDate === "string" ? modificationDate : null;
  }
  setFlags(flags) {
    this.flags = Number.isInteger(flags) && flags > 0 ? flags : 0;
    if (this.flags & AnnotationFlag.INVISIBLE && this.constructor.name !== "Annotation") {
      this.flags ^= AnnotationFlag.INVISIBLE;
    }
  }
  hasFlag(flag) {
    return this._hasFlag(this.flags, flag);
  }
  setRectangle(rectangle) {
    this.rectangle = lookupNormalRect(rectangle, [0, 0, 0, 0]);
  }
  setColor(color) {
    this.color = getRgbColor(color);
  }
  setLineEndings(lineEndings) {
    this.lineEndings = ["None", "None"];
    if (Array.isArray(lineEndings) && lineEndings.length === 2) {
      for (let i = 0; i < 2; i++) {
        const obj = lineEndings[i];
        if (obj instanceof Name) {
          switch (obj.name) {
            case "None":
              continue;
            case "Square":
            case "Circle":
            case "Diamond":
            case "OpenArrow":
            case "ClosedArrow":
            case "Butt":
            case "ROpenArrow":
            case "RClosedArrow":
            case "Slash":
              this.lineEndings[i] = obj.name;
              continue;
          }
        }
        warn(`Ignoring invalid lineEnding: ${obj}`);
      }
    }
  }
  setRotation(mk, dict) {
    this.rotation = 0;
    let angle = mk instanceof Dict ? mk.get("R") || 0 : dict.get("Rotate") || 0;
    if (Number.isInteger(angle) && angle !== 0) {
      angle %= 360;
      if (angle < 0) {
        angle += 360;
      }
      if (angle % 90 === 0) {
        this.rotation = angle;
      }
    }
  }
  setBorderAndBackgroundColors(mk) {
    if (mk instanceof Dict) {
      this.borderColor = getRgbColor(mk.getArray("BC"), null);
      this.backgroundColor = getRgbColor(mk.getArray("BG"), null);
    } else {
      this.borderColor = this.backgroundColor = null;
    }
  }
  setBorderStyle(borderStyle) {
    this.borderStyle = new AnnotationBorderStyle();
    if (!(borderStyle instanceof Dict)) {
      return;
    }
    if (borderStyle.has("BS")) {
      const dict = borderStyle.get("BS");
      if (dict instanceof Dict) {
        const dictType = dict.get("Type");
        if (!dictType || isName(dictType, "Border")) {
          this.borderStyle.setWidth(dict.get("W"), this.rectangle);
          this.borderStyle.setStyle(dict.get("S"));
          this.borderStyle.setDashArray(dict.getArray("D"));
        }
      }
    } else if (borderStyle.has("Border")) {
      const array = borderStyle.getArray("Border");
      if (Array.isArray(array)) {
        if (array.length >= 3) {
          this.borderStyle.setHorizontalCornerRadius(array[0]);
          this.borderStyle.setVerticalCornerRadius(array[1]);
          this.borderStyle.setWidth(array[2], this.rectangle);
          if (array.length === 4) {
            this.borderStyle.setDashArray(array[3], true);
          }
        } else if (array.length === 0) {
          this.borderStyle.setWidth(0);
        }
      }
    } else {
      this.borderStyle.setWidth(0);
      this._noBorderEntries = true;
    }
  }
  setAppearance(dict) {
    const appearanceStates = dict.get("AP");
    if (!(appearanceStates instanceof Dict)) {
      return;
    }
    const normalAppearanceState = appearanceStates.get("N");
    if (normalAppearanceState instanceof BaseStream) {
      this.appearance = normalAppearanceState;
      return;
    }
    if (!(normalAppearanceState instanceof Dict)) {
      return;
    }
    const as = dict.get("AS");
    if (!(as instanceof Name)) {
      return;
    }
    const appearance = normalAppearanceState.get(as.name);
    if (appearance instanceof BaseStream) {
      this.appearance = appearance;
    }
  }
  #setOptionalContent(xref, dict) {
    if (dict.has("OC")) {
      try {
        this._oc = parseMarkedContentProps(xref, dict.get("OC"), null);
      } catch (ex) {
        if (ex instanceof MissingDataException) {
          throw ex;
        }
        warn(`#setOptionalContent: ${ex}`);
      }
    }
  }
  async loadResources(keys, appearance) {
    const resources = await appearance.dict.getAsync("Resources");
    if (resources) {
      await ObjectLoader.load(resources, keys, resources.xref);
    }
    return resources;
  }
  get _ownCanvasRequiresForms() {
    return false;
  }
  async getOperatorList(evaluator, task, intent, annotationStorage) {
    const {
      hasOwnCanvas,
      id,
      rect
    } = this.data;
    let appearance = this.appearance;
    const isUsingOwnCanvas = !!(hasOwnCanvas && intent & RenderingIntentFlag.DISPLAY && (!this._ownCanvasRequiresForms || intent & RenderingIntentFlag.ANNOTATIONS_FORMS));
    if (isUsingOwnCanvas && !this._hasCanvasSize) {
      this.data.hasOwnCanvas = false;
      return this._getOperatorListNoAppearance();
    }
    if (!appearance) {
      if (!isUsingOwnCanvas) {
        return this._getOperatorListNoAppearance();
      }
      appearance = new StringStream("", new Dict());
    }
    const appearanceDict = appearance.dict;
    const resources = await this.loadResources(RESOURCES_KEYS_OPERATOR_LIST, appearance);
    const bbox = lookupRect(appearanceDict.getArray("BBox"), [0, 0, this.width, this.height]);
    const matrix = lookupMatrix(appearanceDict.getArray("Matrix"), IDENTITY_MATRIX);
    const transform = getTransformMatrix(rect, bbox, matrix);
    const opList = new OperatorList();
    const optionalContent = this._oc;
    if (optionalContent !== undefined) {
      opList.addOp(OPS.beginMarkedContentProps, ["OC", optionalContent]);
    }
    opList.addOp(OPS.beginAnnotation, [id, rect, transform, matrix, isUsingOwnCanvas]);
    await evaluator.getOperatorList({
      stream: appearance,
      task,
      resources,
      operatorList: opList,
      fallbackFontDict: this._fallbackFontDict
    });
    opList.addOp(OPS.endAnnotation, []);
    if (optionalContent !== undefined) {
      opList.addOp(OPS.endMarkedContent, []);
    }
    this.reset();
    return {
      opList,
      separateForm: false,
      separateCanvas: isUsingOwnCanvas
    };
  }
  async save(evaluator, task, annotationStorage, changes) {
    return null;
  }
  get overlaysTextContent() {
    return false;
  }
  get hasTextContent() {
    return false;
  }
  async extractTextContent(evaluator, task, viewBox) {
    if (!this.appearance) {
      return;
    }
    const resources = await this.loadResources(RESOURCES_KEYS_TEXT_CONTENT, this.appearance);
    const text = [];
    const buffer = [];
    let firstPositionX = Infinity;
    let firstPositionY = Infinity;
    let firstPosition = null;
    const sink = {
      desiredSize: Math.Infinity,
      ready: true,
      enqueue(chunk, size) {
        for (const item of chunk.items) {
          if (item.str === undefined) {
            continue;
          }
          firstPositionX = Math.min(firstPositionX, item.transform[4]);
          firstPositionY = Math.min(firstPositionY, item.transform[5]);
          buffer.push(item.str);
          if (item.hasEOL) {
            text.push(buffer.join("").trimEnd());
            buffer.length = 0;
          }
        }
      }
    };
    await evaluator.getTextContent({
      stream: this.appearance,
      task,
      resources,
      includeMarkedContent: true,
      keepWhiteSpace: true,
      sink,
      viewBox
    });
    this.reset();
    if (firstPositionX !== Infinity) {
      firstPosition = [firstPositionX, firstPositionY];
    }
    if (buffer.length) {
      text.push(buffer.join("").trimEnd());
    }
    if (text.length > 1 || text[0]) {
      const appearanceDict = this.appearance.dict;
      const bbox = lookupRect(appearanceDict.getArray("BBox"), null);
      const matrix = lookupMatrix(appearanceDict.getArray("Matrix"), null);
      this.data.textPosition = this._transformPoint(firstPosition, bbox, matrix);
      this.data.textContent = text;
    }
  }
  _transformPoint(coords, bbox, matrix) {
    const {
      rect
    } = this.data;
    bbox ||= [0, 0, 1, 1];
    matrix ||= [1, 0, 0, 1, 0, 0];
    const transform = getTransformMatrix(rect, bbox, matrix);
    transform[4] -= rect[0];
    transform[5] -= rect[1];
    const p = coords.slice();
    Util.applyTransform(p, transform);
    Util.applyTransform(p, matrix);
    return p;
  }
  getFieldObject() {
    if (this.data.kidIds) {
      return {
        id: this.data.id,
        actions: this.data.actions,
        name: this.data.fieldName,
        strokeColor: this.data.borderColor,
        fillColor: this.data.backgroundColor,
        type: "",
        kidIds: this.data.kidIds,
        page: this.data.pageIndex,
        rotation: this.rotation
      };
    }
    return null;
  }
  reset() {
    for (const stream of this._streams) {
      stream.reset();
    }
  }
  _constructFieldName(dict) {
    if (!dict.has("T") && !dict.has("Parent")) {
      warn("Unknown field name, falling back to empty field name.");
      return "";
    }
    if (!dict.has("Parent")) {
      return stringToPDFString(dict.get("T"));
    }
    const fieldName = [];
    if (dict.has("T")) {
      fieldName.unshift(stringToPDFString(dict.get("T")));
    }
    let loopDict = dict;
    const visited = new RefSet();
    if (dict.objId) {
      visited.put(dict.objId);
    }
    while (loopDict.has("Parent")) {
      loopDict = loopDict.get("Parent");
      if (!(loopDict instanceof Dict) || loopDict.objId && visited.has(loopDict.objId)) {
        break;
      }
      if (loopDict.objId) {
        visited.put(loopDict.objId);
      }
      if (loopDict.has("T")) {
        fieldName.unshift(stringToPDFString(loopDict.get("T")));
      }
    }
    return fieldName.join(".");
  }
  _getAttachmentId(fsDict, fsRef, annotationGlobals, isSound = false) {
    if (!(fsDict instanceof Dict)) {
      return undefined;
    }
    if (!(fsRef instanceof Ref)) {
      fsRef = FileSpec.pickPlatformItem(fsDict.get("EF"), true);
    }
    return fsRef instanceof Ref ? annotationGlobals.catalog.getAttachmentIdForAnnotation(fsRef, isSound) : undefined;
  }
  get width() {
    return this.data.rect[2] - this.data.rect[0];
  }
  get height() {
    return this.data.rect[3] - this.data.rect[1];
  }
  get _hasCanvasSize() {
    const {
      width,
      height
    } = this;
    return width > 0 && height > 0 && Number.isFinite(width + height);
  }
}
class AnnotationBorderStyle {
  width = 1;
  rawWidth = 1;
  style = AnnotationBorderStyleType.SOLID;
  dashArray = [3];
  horizontalCornerRadius = 0;
  verticalCornerRadius = 0;
  setWidth(width, rect = [0, 0, 0, 0]) {
    if (width instanceof Name) {
      this.width = 0;
      return;
    }
    if (typeof width === "number") {
      if (width > 0) {
        this.rawWidth = width;
        const maxWidth = (rect[2] - rect[0]) / 2;
        const maxHeight = (rect[3] - rect[1]) / 2;
        if (maxWidth > 0 && maxHeight > 0 && (width > maxWidth || width > maxHeight)) {
          warn(`AnnotationBorderStyle.setWidth - ignoring width: ${width}`);
          width = 1;
        }
      }
      this.width = width;
    }
  }
  setStyle(style) {
    if (!(style instanceof Name)) {
      return;
    }
    switch (style.name) {
      case "S":
        this.style = AnnotationBorderStyleType.SOLID;
        break;
      case "D":
        this.style = AnnotationBorderStyleType.DASHED;
        break;
      case "B":
        this.style = AnnotationBorderStyleType.BEVELED;
        break;
      case "I":
        this.style = AnnotationBorderStyleType.INSET;
        break;
      case "U":
        this.style = AnnotationBorderStyleType.UNDERLINE;
        break;
      default:
        break;
    }
  }
  setDashArray(dashArray, forceStyle = false) {
    if (Array.isArray(dashArray)) {
      let isValid = true;
      let allZeros = true;
      for (const element of dashArray) {
        const validNumber = +element >= 0;
        if (!validNumber) {
          isValid = false;
          break;
        } else if (element > 0) {
          allZeros = false;
        }
      }
      if (dashArray.length === 0 || isValid && !allZeros) {
        this.dashArray = dashArray;
        if (forceStyle) {
          this.setStyle(Name.get("D"));
        }
      } else {
        this.width = 0;
      }
    } else if (dashArray) {
      this.width = 0;
    }
  }
  setHorizontalCornerRadius(radius) {
    if (Number.isInteger(radius)) {
      this.horizontalCornerRadius = radius;
    }
  }
  setVerticalCornerRadius(radius) {
    if (Number.isInteger(radius)) {
      this.verticalCornerRadius = radius;
    }
  }
}
class MarkupAnnotation extends Annotation {
  constructor(params) {
    super(params);
    const {
      dict
    } = params;
    if (dict.has("IRT")) {
      const rawIRT = dict.getRaw("IRT");
      this.data.inReplyTo = rawIRT instanceof Ref ? rawIRT.toString() : null;
      const rt = dict.get("RT");
      this.data.replyType = rt instanceof Name ? rt.name : AnnotationReplyType.REPLY;
    }
    let popupRef = null;
    if (this.data.replyType === AnnotationReplyType.GROUP) {
      const parent = dict.get("IRT");
      this.setTitle(parent.get("T"));
      this.data.titleObj = this._title;
      this.setContents(parent.get("Contents"));
      this.data.contentsObj = this._contents;
      if (!parent.has("CreationDate")) {
        this.data.creationDate = null;
      } else {
        this.setCreationDate(parent.get("CreationDate"));
        this.data.creationDate = this.creationDate;
      }
      if (!parent.has("M")) {
        this.data.modificationDate = null;
      } else {
        this.setModificationDate(parent.get("M"));
        this.data.modificationDate = this.modificationDate;
      }
      popupRef = parent.getRaw("Popup");
      if (!parent.has("C")) {
        this.data.color = null;
      } else {
        this.setColor(parent.getArray("C"));
        this.data.color = this.color;
      }
    } else {
      this.data.titleObj = this._title;
      this.setCreationDate(dict.get("CreationDate"));
      this.data.creationDate = this.creationDate;
      popupRef = dict.getRaw("Popup");
      if (!dict.has("C")) {
        this.data.color = null;
      }
    }
    this.data.popupRef = popupRef instanceof Ref ? popupRef.toString() : null;
    if (dict.has("RC")) {
      this.data.richText = XFAFactory.getRichTextAsHtml(dict.get("RC"));
    }
  }
  setCreationDate(creationDate) {
    this.creationDate = typeof creationDate === "string" ? creationDate : null;
  }
  _setDefaultAppearance({
    xref,
    extra,
    strokeColor,
    fillColor,
    blendMode,
    strokeAlpha,
    fillAlpha,
    pointsCallback
  }) {
    const bbox = this.data.rect = BBOX_INIT.slice();
    const buffer = ["q"];
    if (extra) {
      buffer.push(extra);
    }
    if (strokeColor) {
      buffer.push(`${strokeColor[0]} ${strokeColor[1]} ${strokeColor[2]} RG`);
    }
    if (fillColor) {
      buffer.push(`${fillColor[0]} ${fillColor[1]} ${fillColor[2]} rg`);
    }
    const pointsArray = this.data.quadPoints || Float32Array.from([this.rectangle[0], this.rectangle[3], this.rectangle[2], this.rectangle[3], this.rectangle[0], this.rectangle[1], this.rectangle[2], this.rectangle[1]]);
    for (let i = 0, ii = pointsArray.length; i < ii; i += 8) {
      const points = pointsCallback(buffer, pointsArray.subarray(i, i + 8));
      Util.rectBoundingBox(...points, bbox);
    }
    buffer.push("Q");
    const formDict = new Dict(xref);
    const appearanceStreamDict = new Dict(xref);
    appearanceStreamDict.setIfName("Subtype", "Form");
    const appearanceStream = new StringStream(buffer.join(" "), appearanceStreamDict);
    formDict.set("Fm0", appearanceStream);
    const gsDict = new Dict(xref);
    if (blendMode) {
      gsDict.setIfName("BM", blendMode);
    }
    gsDict.setIfNumber("CA", strokeAlpha);
    gsDict.setIfNumber("ca", fillAlpha);
    const stateDict = new Dict(xref);
    stateDict.set("GS0", gsDict);
    const resources = new Dict(xref);
    resources.set("ExtGState", stateDict);
    resources.set("XObject", formDict);
    const appearanceDict = new Dict(xref);
    appearanceDict.set("Resources", resources);
    appearanceDict.set("BBox", bbox);
    this.appearance = new StringStream("/GS0 gs /Fm0 Do", appearanceDict);
    this._streams.push(this.appearance, appearanceStream);
  }
  static async createNewAnnotation(xref, annotation, changes, params) {
    const annotationRef = annotation.ref ||= xref.getNewTemporaryRef();
    const ap = await this.createNewAppearanceStream(annotation, xref, params);
    let apRef = annotation.appearanceRef ?? null;
    if (ap) {
      changes.put(apRef = xref.getNewTemporaryRef(), {
        data: ap
      });
    }
    const annotationDict = this.createNewDict(annotation, xref, {
      apRef
    });
    if (Number.isInteger(annotation.parentTreeId)) {
      annotationDict.set("StructParent", annotation.parentTreeId);
    }
    changes.put(annotationRef, {
      data: annotationDict
    });
    const retRef = {
      ref: annotationRef
    };
    const {
      popup
    } = annotation;
    if (popup) {
      if (popup.deleted) {
        annotationDict.delete("Popup");
        annotationDict.delete("Contents");
        annotationDict.delete("RC");
        return retRef;
      }
      const popupRef = popup.ref ||= xref.getNewTemporaryRef();
      popup.parent = annotationRef;
      const popupDict = PopupAnnotation.createNewDict(popup, xref);
      changes.put(popupRef, {
        data: popupDict
      });
      annotationDict.setIfDefined("Contents", stringToAsciiOrUTF16BE(popup.contents));
      annotationDict.set("Popup", popupRef);
      return [retRef, {
        ref: popupRef
      }];
    }
    return retRef;
  }
  static async createNewPrintAnnotation(annotationGlobals, xref, annotation, params) {
    const ap = await this.createNewAppearanceStream(annotation, xref, params);
    const annotationDict = this.createNewDict(annotation, xref, ap ? {
      ap
    } : {});
    const newAnnotation = new this.prototype.constructor({
      dict: annotationDict,
      xref,
      annotationGlobals,
      evaluatorOptions: params.evaluatorOptions
    });
    if (annotation.ref) {
      newAnnotation.ref = newAnnotation.refToReplace = annotation.ref;
    }
    return newAnnotation;
  }
}
class WidgetAnnotation extends Annotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref,
      annotationGlobals
    } = params;
    const data = this.data;
    this._needAppearances = params.needAppearances;
    if (data.fieldName === undefined) {
      data.fieldName = this._constructFieldName(dict);
    }
    if (data.actions === undefined) {
      data.actions = collectActions(xref, dict, AnnotationActionEventType);
    }
    let fieldValue = getInheritableProperty({
      dict,
      key: "V",
      getArray: true
    });
    data.fieldValue = this._decodeFormValue(fieldValue);
    const defaultFieldValue = getInheritableProperty({
      dict,
      key: "DV",
      getArray: true
    });
    data.defaultFieldValue = this._decodeFormValue(defaultFieldValue);
    if (fieldValue === undefined && annotationGlobals.xfaDatasets) {
      const path = this._title.str;
      if (path) {
        this._hasValueFromXFA = true;
        data.fieldValue = fieldValue = annotationGlobals.xfaDatasets.getValue(path);
      }
    }
    if (fieldValue === undefined && data.defaultFieldValue !== null) {
      data.fieldValue = data.defaultFieldValue;
    }
    data.alternativeText = stringToPDFString(dict.get("TU") || "");
    this.setDefaultAppearance(params);
    data.hasAppearance ||= this._needAppearances && data.fieldValue !== undefined && data.fieldValue !== null;
    const fieldType = getInheritableProperty({
      dict,
      key: "FT"
    });
    data.fieldType = fieldType instanceof Name ? fieldType.name : null;
    const localResources = getInheritableProperty({
      dict,
      key: "DR"
    });
    const acroFormResources = annotationGlobals.acroForm.get("DR");
    const appearanceResources = this.appearance?.dict.get("Resources");
    this._fieldResources = {
      localResources,
      acroFormResources,
      appearanceResources,
      mergedResources: Dict.merge({
        xref,
        dictArray: [localResources, appearanceResources, acroFormResources],
        mergeSubDicts: true
      })
    };
    data.fieldFlags = getInheritableProperty({
      dict,
      key: "Ff"
    });
    if (!Number.isInteger(data.fieldFlags) || data.fieldFlags < 0) {
      data.fieldFlags = 0;
    }
    data.password = this.hasFieldFlag(AnnotationFieldFlag.PASSWORD);
    data.readOnly = this.hasFieldFlag(AnnotationFieldFlag.READONLY);
    data.required = this.hasFieldFlag(AnnotationFieldFlag.REQUIRED);
    data.hidden = this._hasFlag(data.annotationFlags, AnnotationFlag.HIDDEN) || this._hasFlag(data.annotationFlags, AnnotationFlag.NOVIEW);
  }
  _decodeFormValue(formValue) {
    if (Array.isArray(formValue)) {
      const arr = formValue.map(item => this._decodeFormValue(item)).filter(item => item !== null);
      return arr.length > 0 ? arr : null;
    } else if (formValue instanceof Name) {
      return formValue.name;
    } else if (typeof formValue === "string") {
      return stringToPDFString(formValue);
    }
    return null;
  }
  hasFieldFlag(flag) {
    return !!(this.data.fieldFlags & flag);
  }
  _isViewable(flags) {
    return true;
  }
  mustBeViewed(annotationStorage, renderForms) {
    if (renderForms) {
      return this.viewable;
    }
    return super.mustBeViewed(annotationStorage, renderForms) && !this._hasFlag(this.flags, AnnotationFlag.NOVIEW);
  }
  getRotationMatrix(annotationStorage) {
    let rotation = annotationStorage?.get(this.data.id)?.rotation;
    if (rotation === undefined) {
      rotation = this.rotation;
    }
    return rotation === 0 ? IDENTITY_MATRIX : getRotationMatrix(rotation, this.width, this.height);
  }
  getBorderAndBackgroundAppearances(annotationStorage, isCircle = false) {
    let rotation = annotationStorage?.get(this.data.id)?.rotation;
    if (rotation === undefined) {
      rotation = this.rotation;
    }
    if (!this.backgroundColor && !this.borderColor) {
      return "";
    }
    const [width, height] = rotation === 0 || rotation === 180 ? [this.width, this.height] : [this.height, this.width];
    const borderWidth = this.borderColor ? this.borderStyle.width || (this._noBorderEntries ? 1 : 0) : 0;
    let path;
    if (isCircle) {
      const r = (Math.min(width, height) - borderWidth) / 2;
      const k = r * (4 / 3) * Math.tan(Math.PI / 8);
      const cx = width / 2;
      const cy = height / 2;
      const p = (x, y) => `${numberToString(x)} ${numberToString(y)}`;
      path = `${p(cx + r, cy)} m ` + `${p(cx + r, cy + k)} ${p(cx + k, cy + r)} ${p(cx, cy + r)} c ` + `${p(cx - k, cy + r)} ${p(cx - r, cy + k)} ${p(cx - r, cy)} c ` + `${p(cx - r, cy - k)} ${p(cx - k, cy - r)} ${p(cx, cy - r)} c ` + `${p(cx + k, cy - r)} ${p(cx + r, cy - k)} ${p(cx + r, cy)} c h`;
    } else {
      path = `0 0 ${width} ${height} re`;
    }
    let str = "";
    if (this.backgroundColor) {
      str = `${getPdfColor(this.backgroundColor, true)} ${path} f `;
    }
    if (borderWidth > 0) {
      str += `${borderWidth} w ${getPdfColor(this.borderColor, false)} ${path} S `;
    }
    return str;
  }
  async getOperatorList(evaluator, task, intent, annotationStorage) {
    if (intent & RenderingIntentFlag.ANNOTATIONS_FORMS && !(this instanceof SignatureWidgetAnnotation) && !this.data.noHTML && !this.data.hasOwnCanvas) {
      const list = this._getOperatorListNoAppearance();
      list.separateForm = true;
      return list;
    }
    if (!this._hasText) {
      return super.getOperatorList(evaluator, task, intent, annotationStorage);
    }
    const isUsingOwnCanvas = !!(this.data.hasOwnCanvas && intent & RenderingIntentFlag.DISPLAY);
    if (isUsingOwnCanvas && !this._hasCanvasSize) {
      this.data.hasOwnCanvas = false;
      return this._getOperatorListNoAppearance();
    }
    const content = await this._getAppearance(evaluator, task, intent, annotationStorage);
    if (this.appearance && content === null) {
      return super.getOperatorList(evaluator, task, intent, annotationStorage);
    }
    const opList = new OperatorList();
    if (!this._defaultAppearance || content === null) {
      return {
        opList,
        separateForm: false,
        separateCanvas: false
      };
    }
    const matrix = [1, 0, 0, 1, 0, 0];
    const bbox = [0, 0, this.width, this.height];
    const transform = getTransformMatrix(this.data.rect, bbox, matrix);
    const optionalContent = this._oc;
    if (optionalContent !== undefined) {
      opList.addOp(OPS.beginMarkedContentProps, ["OC", optionalContent]);
    }
    opList.addOp(OPS.beginAnnotation, [this.data.id, this.data.rect, transform, this.getRotationMatrix(annotationStorage), isUsingOwnCanvas]);
    const stream = new StringStream(content);
    await evaluator.getOperatorList({
      stream,
      task,
      resources: this._fieldResources.mergedResources,
      operatorList: opList
    });
    opList.addOp(OPS.endAnnotation, []);
    if (optionalContent !== undefined) {
      opList.addOp(OPS.endMarkedContent, []);
    }
    return {
      opList,
      separateForm: false,
      separateCanvas: isUsingOwnCanvas
    };
  }
  _setMKDict(dict, rotation) {
    const oldMK = dict.get("MK");
    const mk = oldMK instanceof Dict ? oldMK.clone() : new Dict(null);
    if (rotation) {
      mk.set("R", rotation);
    } else {
      mk.delete("R");
    }
    mk.setIfArray("BC", getPdfColorArray(this.borderColor));
    mk.setIfArray("BG", getPdfColorArray(this.backgroundColor));
    if (mk.size > 0) {
      dict.set("MK", mk);
    } else {
      dict.delete("MK");
    }
  }
  amendSavedDict(annotationStorage, dict) {}
  setValue(dict, value, xref, changes) {
    const {
      dict: parentDict,
      ref: parentRef
    } = getParentToUpdate(dict, this.ref, xref);
    if (!parentDict) {
      dict.set("V", value);
    } else if (!changes.has(parentRef)) {
      const newParentDict = parentDict.clone();
      newParentDict.set("V", value);
      changes.put(parentRef, {
        data: newParentDict
      });
      return newParentDict;
    }
    return null;
  }
  async save(evaluator, task, annotationStorage, changes) {
    const storageEntry = annotationStorage?.get(this.data.id);
    const flags = this._buildFlags(storageEntry?.noView, storageEntry?.noPrint);
    let value = storageEntry?.value,
      rotation = storageEntry?.rotation;
    if (value === this.data.fieldValue || value === undefined) {
      if (!this._hasValueFromXFA && rotation === undefined && flags === undefined) {
        return;
      }
      value ||= this.data.fieldValue;
    }
    if (rotation === undefined && !this._hasValueFromXFA && Array.isArray(value) && Array.isArray(this.data.fieldValue) && isArrayEqual(value, this.data.fieldValue) && flags === undefined) {
      return;
    }
    if (rotation === undefined) {
      rotation = this.rotation;
    }
    let appearance = null;
    if (!this._needAppearances) {
      appearance = await this._getAppearance(evaluator, task, RenderingIntentFlag.SAVE, annotationStorage);
      if (appearance === null && flags === undefined) {
        return;
      }
    } else {}
    let needAppearances = false;
    if (appearance?.needAppearances) {
      needAppearances = true;
      appearance = null;
    }
    const {
      xref
    } = evaluator;
    const originalDict = xref.fetchIfRef(this.ref);
    if (!(originalDict instanceof Dict)) {
      return;
    }
    const dict = new Dict(xref);
    for (const [key, rawVal] of originalDict.getRawEntries()) {
      if (key !== "AP") {
        dict.set(key, rawVal);
      }
    }
    if (flags !== undefined) {
      dict.set("F", flags);
      if (appearance === null && !needAppearances) {
        const ap = originalDict.getRaw("AP");
        if (ap) {
          dict.set("AP", ap);
        }
      }
    }
    const xfa = {
      path: this.data.fieldName,
      value
    };
    const newParentDict = this.setValue(dict, Array.isArray(value) ? value.map(stringToAsciiOrUTF16BE) : stringToAsciiOrUTF16BE(value), xref, changes);
    this.amendSavedDict(annotationStorage, newParentDict || dict);
    this._setMKDict(dict, rotation);
    changes.put(this.ref, {
      data: dict,
      xfa,
      needAppearances
    });
    if (appearance !== null) {
      const newRef = xref.getNewTemporaryRef();
      const AP = new Dict(xref);
      dict.set("AP", AP);
      AP.set("N", newRef);
      const resources = this._getSaveFieldResources(xref),
        appearanceDict = new Dict(xref);
      appearanceDict.setIfName("Subtype", "Form");
      appearanceDict.set("Resources", resources);
      const bbox = rotation % 180 === 0 ? [0, 0, this.width, this.height] : [0, 0, this.height, this.width];
      appearanceDict.set("BBox", bbox);
      const appearanceStream = new StringStream(appearance, appearanceDict);
      const rotationMatrix = this.getRotationMatrix(annotationStorage);
      if (rotationMatrix !== IDENTITY_MATRIX) {
        appearanceDict.set("Matrix", rotationMatrix);
      }
      changes.put(newRef, {
        data: appearanceStream,
        xfa: null,
        needAppearances: false
      });
    }
    dict.set("M", `D:${getModificationDate()}`);
  }
  async _getAppearance(evaluator, task, intent, annotationStorage) {
    if (this.data.password) {
      return null;
    }
    const storageEntry = annotationStorage?.get(this.data.id);
    let value, rotation;
    if (storageEntry) {
      value = storageEntry.formattedValue || storageEntry.value;
      rotation = storageEntry.rotation;
    }
    if (rotation === undefined && value === undefined && !this._needAppearances) {
      if (!this._hasValueFromXFA || this.appearance) {
        return null;
      }
    }
    const colors = this.getBorderAndBackgroundAppearances(annotationStorage);
    if (value === undefined) {
      value = this.data.fieldValue;
      if (!value) {
        return `/Tx BMC q ${colors}Q EMC`;
      }
    }
    if (Array.isArray(value) && value.length === 1) {
      value = value[0];
    }
    assert(typeof value === "string", "Expected `value` to be a string.");
    value = value.trimEnd();
    if (this.data.combo) {
      const option = this.data.options.find(({
        exportValue
      }) => value === exportValue);
      value = option?.displayValue || value;
    }
    if (value === "") {
      return `/Tx BMC q ${colors}Q EMC`;
    }
    if (rotation === undefined) {
      rotation = this.rotation;
    }
    let lineCount = -1;
    let lines;
    if (this.data.multiLine) {
      lines = value.split(/\r\n?|\n/).map(line => line.normalize("NFC"));
      lineCount = lines.length;
    } else {
      lines = [value.replace(/\r\n?|\n/, "").normalize("NFC")];
    }
    const defaultPadding = 1;
    const defaultHPadding = 2;
    let {
      width: totalWidth,
      height: totalHeight
    } = this;
    if (rotation === 90 || rotation === 270) {
      [totalWidth, totalHeight] = [totalHeight, totalWidth];
    }
    if (!this._defaultAppearance) {
      this.data.defaultAppearanceData = parseDefaultAppearance(this._defaultAppearance = "/Helvetica 0 Tf 0 g");
    }
    if (!this.data.defaultAppearanceData.fontSize && (totalWidth <= 2 * defaultHPadding || totalHeight <= 2 * defaultPadding)) {
      return `/Tx BMC q ${colors}Q EMC`;
    }
    let font = await WidgetAnnotation._getFontData(evaluator, task, this.data.defaultAppearanceData, this._fieldResources.mergedResources);
    let defaultAppearance, fontSize, lineHeight;
    const encodedLines = [];
    let encodingError = false;
    for (const line of lines) {
      const encodedString = font.encodeString(line);
      if (encodedString.length > 1) {
        encodingError = true;
      }
      encodedLines.push(encodedString.join(""));
    }
    if (encodingError && intent & RenderingIntentFlag.SAVE) {
      return {
        needAppearances: true
      };
    }
    if (encodingError && this._isOffscreenCanvasSupported) {
      const fontFamily = this.data.comb ? "monospace" : "sans-serif";
      const fakeUnicodeFont = new FakeUnicodeFont(evaluator.xref, fontFamily);
      const resources = fakeUnicodeFont.createFontResources(lines.join(""));
      const newFont = resources.getRaw("Font");
      if (this._fieldResources.mergedResources.has("Font")) {
        const oldFont = this._fieldResources.mergedResources.get("Font");
        for (const [key, rawVal] of newFont.getRawEntries()) {
          oldFont.set(key, rawVal);
        }
      } else {
        this._fieldResources.mergedResources.set("Font", newFont);
      }
      const fontName = fakeUnicodeFont.fontName.name;
      font = await WidgetAnnotation._getFontData(evaluator, task, {
        fontName,
        fontSize: 0
      }, resources);
      for (let i = 0, ii = encodedLines.length; i < ii; i++) {
        encodedLines[i] = stringToUTF16String(lines[i]);
      }
      const savedDefaultAppearance = Object.assign(Object.create(null), this.data.defaultAppearanceData);
      this.data.defaultAppearanceData.fontSize = 0;
      this.data.defaultAppearanceData.fontName = fontName;
      [defaultAppearance, fontSize, lineHeight] = this._computeFontSize(totalHeight - 2 * defaultPadding, totalWidth - 2 * defaultHPadding, value, font, lineCount, totalWidth - defaultHPadding);
      this.data.defaultAppearanceData = savedDefaultAppearance;
    } else {
      if (!this._isOffscreenCanvasSupported) {
        warn("_getAppearance: OffscreenCanvas is not supported, annotation may not render correctly.");
      }
      [defaultAppearance, fontSize, lineHeight] = this._computeFontSize(totalHeight - 2 * defaultPadding, totalWidth - 2 * defaultHPadding, value, font, lineCount, totalWidth - defaultHPadding);
    }
    let descent = font.descent;
    if (isNaN(descent)) {
      descent = BASELINE_FACTOR * lineHeight;
    } else {
      descent = Math.max(BASELINE_FACTOR * lineHeight, Math.abs(descent) * fontSize);
    }
    const defaultVPadding = Math.min(Math.floor((totalHeight - fontSize) / 2), defaultPadding);
    const alignment = this.data.textAlignment;
    let {
      ascent: fontAscent,
      descent: fontDescent
    } = font;
    if (isNaN(fontAscent) || isNaN(fontDescent) || !fontAscent && !fontDescent) {
      fontAscent = LINE_FACTOR - LINE_DESCENT_FACTOR;
      fontDescent = LINE_DESCENT_FACTOR;
    } else {
      fontDescent = Math.abs(fontDescent);
    }
    const vShift = (totalHeight - (fontAscent + fontDescent) * fontSize) / 2 + fontDescent * fontSize;
    if (this.data.multiLine) {
      return this._getMultilineAppearance(defaultAppearance, encodedLines, font, fontSize, totalWidth, totalHeight, alignment, defaultHPadding, defaultVPadding, descent, lineHeight, annotationStorage);
    }
    if (this.data.comb) {
      return this._getCombAppearance(defaultAppearance, font, encodedLines[0], fontSize, totalWidth, vShift, alignment, bidi(lines[0]).dir === "rtl", annotationStorage);
    }
    const bottomPadding = vShift;
    if (alignment === 0 || alignment > 2) {
      return `/Tx BMC q ${colors}BT ` + defaultAppearance + ` 1 0 0 1 ${numberToString(defaultHPadding)} ${numberToString(bottomPadding)} Tm (${escapeString(encodedLines[0])}) Tj` + " ET Q EMC";
    }
    const prevInfo = {
      shift: 0
    };
    const renderedText = this._renderText(encodedLines[0], font, fontSize, totalWidth, alignment, prevInfo, defaultHPadding, bottomPadding);
    return `/Tx BMC q ${colors}BT ` + defaultAppearance + ` 1 0 0 1 0 0 Tm ${renderedText}` + " ET Q EMC";
  }
  static async _getFontData(evaluator, task, appearanceData, resources) {
    const operatorList = new OperatorList();
    const initialState = {
      font: null,
      clone() {
        return this;
      }
    };
    const {
      fontName,
      fontSize
    } = appearanceData;
    await evaluator.handleSetFont(resources, [fontName && Name.get(fontName), fontSize], null, operatorList, task, initialState, null);
    return initialState.font;
  }
  _getTextWidth(text, font) {
    return Math.sumPrecise(font.charsToGlyphs(text).map(g => g.width)) / 1000;
  }
  _computeFontSize(height, width, text, font, lineCount, maxWidth) {
    let {
      fontSize
    } = this.data.defaultAppearanceData;
    const lineHeight = (fontSize || 12) * LINE_FACTOR;
    let numberOfLines = Math.round(height / lineHeight);
    if (!fontSize) {
      const roundWithTwoDigits = x => Math.floor(x * 100) / 100;
      if (lineCount === -1) {
        const textWidth = this._getTextWidth(text, font);
        fontSize = roundWithTwoDigits(Math.min(height / LINE_FACTOR, width / textWidth));
        numberOfLines = 1;
      } else {
        const lines = text.split(/\r\n?|\n/);
        const cachedLines = [];
        for (const line of lines) {
          const encoded = font.encodeString(line).join("");
          const glyphs = font.charsToGlyphs(encoded);
          const positions = font.getCharPositions(encoded);
          cachedLines.push({
            line: encoded,
            glyphs,
            positions
          });
        }
        const isTooBig = fsize => {
          let totalHeight = 0;
          for (const cache of cachedLines) {
            const chunks = this._splitLine(null, font, fsize, width, maxWidth, cache);
            totalHeight += chunks.length * fsize;
            if (totalHeight > height) {
              return true;
            }
          }
          return false;
        };
        numberOfLines = Math.max(numberOfLines, lineCount);
        const getFontSize = n => roundWithTwoDigits(height / n / LINE_FACTOR);
        if (height > 0 && isTooBig(getFontSize(numberOfLines))) {
          let low = numberOfLines,
            high = 2 * numberOfLines;
          while (isTooBig(getFontSize(high))) {
            low = high;
            high *= 2;
          }
          while (high - low > 1) {
            const mid = Math.floor((low + high) / 2);
            if (isTooBig(getFontSize(mid))) {
              low = mid;
            } else {
              high = mid;
            }
          }
          numberOfLines = high;
        }
        fontSize = getFontSize(numberOfLines);
      }
      const {
        fontName,
        fontColor
      } = this.data.defaultAppearanceData;
      this._defaultAppearance = createDefaultAppearance({
        fontSize,
        fontName,
        fontColor
      });
    }
    return [this._defaultAppearance, fontSize, height / numberOfLines];
  }
  _renderText(text, font, fontSize, totalWidth, alignment, prevInfo, hPadding, vPadding) {
    let shift;
    if (alignment === 1) {
      const width = this._getTextWidth(text, font) * fontSize;
      shift = (totalWidth - width) / 2;
    } else if (alignment === 2) {
      const width = this._getTextWidth(text, font) * fontSize;
      shift = totalWidth - width - hPadding;
    } else {
      shift = hPadding;
    }
    const shiftStr = numberToString(shift - prevInfo.shift);
    prevInfo.shift = shift;
    vPadding = numberToString(vPadding);
    return `${shiftStr} ${vPadding} Td (${escapeString(text)}) Tj`;
  }
  _getSaveFieldResources(xref) {
    const {
      localResources,
      appearanceResources,
      acroFormResources
    } = this._fieldResources;
    const fontName = this.data.defaultAppearanceData?.fontName;
    if (!fontName) {
      return localResources || Dict.empty;
    }
    for (const resources of [localResources, appearanceResources]) {
      if (resources instanceof Dict) {
        const localFont = resources.get("Font");
        if (localFont instanceof Dict && localFont.has(fontName)) {
          return resources;
        }
      }
    }
    if (acroFormResources instanceof Dict) {
      const acroFormFont = acroFormResources.get("Font");
      if (acroFormFont instanceof Dict && acroFormFont.has(fontName)) {
        const subFontDict = new Dict(xref);
        subFontDict.set(fontName, acroFormFont.getRaw(fontName));
        const subResourcesDict = new Dict(xref);
        subResourcesDict.set("Font", subFontDict);
        return Dict.merge({
          xref,
          dictArray: [subResourcesDict, localResources],
          mergeSubDicts: true
        });
      }
    }
    return localResources || Dict.empty;
  }
  getFieldObject() {
    return null;
  }
}
class TextWidgetAnnotation extends WidgetAnnotation {
  constructor(params) {
    super(params);
    const {
      annotationGlobals,
      dict
    } = params;
    if (dict.has("PMD")) {
      this.flags |= AnnotationFlag.HIDDEN;
      this.data.hidden = true;
      warn("Barcodes are not supported");
    }
    this.data.hasOwnCanvas = this.data.readOnly && !this.data.noHTML;
    this._hasText = true;
    if (typeof this.data.fieldValue !== "string") {
      this.data.fieldValue = "";
    }
    const getAlignment = q => Number.isInteger(q) && q >= 0 && q <= 2 ? q : null;
    this.data.textAlignment = getAlignment(getInheritableProperty({
      dict,
      key: "Q"
    })) ?? getAlignment(annotationGlobals.acroForm.get("Q")) ?? null;
    let maximumLength = getInheritableProperty({
      dict,
      key: "MaxLen"
    });
    if (!Number.isInteger(maximumLength) || maximumLength < 0) {
      maximumLength = 0;
    }
    this.data.maxLen = maximumLength;
    this.data.multiLine = this.hasFieldFlag(AnnotationFieldFlag.MULTILINE);
    this.data.comb = this.hasFieldFlag(AnnotationFieldFlag.COMB) && !this.data.multiLine && !this.data.password && !this.hasFieldFlag(AnnotationFieldFlag.FILESELECT) && this.data.maxLen !== 0;
    this.data.doNotScroll = this.hasFieldFlag(AnnotationFieldFlag.DONOTSCROLL);
    const {
      actions
    } = this.data;
    if (!actions) {
      return;
    }
    const AFDateTime = /^AF(Date|Time)_(?:Keystroke|Format)(?:Ex)?\(['"]?([^'"]+)['"]?\);$/;
    let canUseHTMLDateTime = false;
    const aFormat = actions.get("Format"),
      aKeystroke = actions.get("Keystroke");
    if (aFormat?.length === 1 && aKeystroke?.length === 1 && AFDateTime.test(aFormat[0]) && AFDateTime.test(aKeystroke[0]) || aFormat?.length === 0 && aKeystroke?.length === 1 && AFDateTime.test(aKeystroke[0]) || aKeystroke?.length === 0 && aFormat?.length === 1 && AFDateTime.test(aFormat[0])) {
      canUseHTMLDateTime = true;
    }
    const actionsToVisit = [];
    if (aFormat) {
      actionsToVisit.push(...aFormat);
    }
    if (aKeystroke) {
      actionsToVisit.push(...aKeystroke);
    }
    if (canUseHTMLDateTime) {
      actions.delete("Keystroke");
      actions.set("Format", actionsToVisit);
    }
    for (const formatAction of actionsToVisit) {
      const m = formatAction.match(AFDateTime);
      if (!m) {
        continue;
      }
      const isDate = m[1] === "Date";
      let format = m[2];
      const num = parseInt(format, 10);
      if (!isNaN(num) && Math.floor(Math.log10(num)) + 1 === m[2].length) {
        format = (isDate ? DateFormats : TimeFormats)[num] ?? format;
      }
      this.data.datetimeFormat = format;
      if (!canUseHTMLDateTime) {
        break;
      }
      if (isDate) {
        if (/HH|MM|ss|h/.test(format)) {
          this.data.datetimeType = "datetime-local";
          this.data.timeStep = /ss/.test(format) ? 1 : 60;
        } else {
          this.data.datetimeType = "date";
        }
        break;
      }
      this.data.datetimeType = "time";
      this.data.timeStep = /ss/.test(format) ? 1 : 60;
      break;
    }
  }
  get hasTextContent() {
    return !!this.appearance && !this._needAppearances;
  }
  _getCombAppearance(defaultAppearance, font, text, fontSize, width, vShift, alignment, isRTL, annotationStorage) {
    const combWidth = width / this.data.maxLen;
    const colors = this.getBorderAndBackgroundAppearances(annotationStorage);
    const cells = font.getCharPositions(text).map(([start, end]) => {
      const glyph = text.substring(start, end);
      return {
        glyph,
        width: this._getTextWidth(glyph, font) * fontSize
      };
    });
    if (isRTL) {
      cells.reverse();
    }
    const textWidth = combWidth * cells.length;
    let hShift = 0;
    if (alignment === 1) {
      hShift += Math.floor((width - textWidth) / (2 * combWidth)) * combWidth;
    } else if (alignment === 2) {
      hShift += width - textWidth;
    }
    const buf = [];
    let previousWidth = 0;
    for (let i = 0, ii = cells.length; i < ii; i++) {
      const {
        glyph,
        width: glyphWidth
      } = cells[i];
      const shift = i === 0 ? (combWidth - glyphWidth) / 2 : combWidth + (previousWidth - glyphWidth) / 2;
      buf.push(`${numberToString(shift)} 0 Td (${escapeString(glyph)}) Tj`);
      previousWidth = glyphWidth;
    }
    const renderedComb = buf.join(" ");
    return `/Tx BMC q ${colors}BT ` + defaultAppearance + ` 1 0 0 1 ${numberToString(hShift)} ${numberToString(vShift)} Tm ${renderedComb}` + " ET Q EMC";
  }
  _getMultilineAppearance(defaultAppearance, lines, font, fontSize, width, height, alignment, hPadding, vPadding, descent, lineHeight, annotationStorage) {
    const buf = [];
    const totalWidth = width - 2 * hPadding;
    const prevInfo = {
      shift: 0
    };
    for (let i = 0, ii = lines.length; i < ii; i++) {
      const line = lines[i];
      const chunks = this._splitLine(line, font, fontSize, totalWidth, width - hPadding);
      const padding = chunks.length === 1 && this._getTextWidth(line, font) * fontSize > totalWidth ? hPadding / 2 : hPadding;
      for (let j = 0, jj = chunks.length; j < jj; j++) {
        const chunk = chunks[j];
        const vShift = i === 0 && j === 0 ? -vPadding - (lineHeight - descent) : -lineHeight;
        buf.push(this._renderText(chunk, font, fontSize, width, alignment, prevInfo, padding, vShift));
      }
    }
    const colors = this.getBorderAndBackgroundAppearances(annotationStorage);
    const renderedText = buf.join("\n");
    return `/Tx BMC q ${colors}BT ` + defaultAppearance + ` 1 0 0 1 0 ${numberToString(height)} Tm ${renderedText}` + " ET Q EMC";
  }
  _splitLine(line, font, fontSize, width, maxWidth, cache = {}) {
    line = cache.line || line;
    const glyphs = cache.glyphs || font.charsToGlyphs(line);
    if (glyphs.length <= 1) {
      return [line];
    }
    const scale = fontSize / 1000;
    if (Math.sumPrecise(glyphs.map(g => g.width)) * scale <= maxWidth) {
      return [line];
    }
    const positions = cache.positions || font.getCharPositions(line);
    const chunks = [];
    let lastSpacePosInStringStart = -1,
      lastSpacePosInStringEnd = -1,
      lastSpacePos = -1,
      startChunk = 0,
      currentWidth = 0;
    for (let i = 0, ii = glyphs.length; i < ii; i++) {
      const [start, end] = positions[i];
      const glyph = glyphs[i];
      const glyphWidth = glyph.width * scale;
      if (glyph.unicode === " ") {
        if (currentWidth + glyphWidth > width) {
          chunks.push(line.substring(startChunk, start));
          startChunk = start;
          currentWidth = glyphWidth;
          lastSpacePosInStringStart = -1;
          lastSpacePos = -1;
        } else {
          currentWidth += glyphWidth;
          lastSpacePosInStringStart = start;
          lastSpacePosInStringEnd = end;
          lastSpacePos = i;
        }
      } else if (currentWidth + glyphWidth > width) {
        if (lastSpacePosInStringStart !== -1) {
          chunks.push(line.substring(startChunk, lastSpacePosInStringEnd));
          startChunk = lastSpacePosInStringEnd;
          i = lastSpacePos + 1;
          lastSpacePosInStringStart = -1;
          currentWidth = 0;
        } else {
          chunks.push(line.substring(startChunk, start));
          startChunk = start;
          currentWidth = glyphWidth;
        }
      } else {
        currentWidth += glyphWidth;
      }
    }
    if (startChunk < line.length) {
      chunks.push(line.substring(startChunk));
    }
    return chunks;
  }
  async extractTextContent(evaluator, task, viewBox) {
    await super.extractTextContent(evaluator, task, viewBox);
    const text = this.data.textContent;
    if (!text) {
      return;
    }
    const allText = text.join("\n");
    if (allText === this.data.fieldValue) {
      return;
    }
    const regex = allText.replaceAll(/([.*+?^${}()|[\]\\])|(\s+)/g, (_m, p1) => p1 ? `\\${p1}` : "\\s+");
    if (new RegExp(`^\\s*${regex}\\s*$`).test(this.data.fieldValue)) {
      this.data.textContent = this.data.fieldValue.split("\n");
    }
  }
  getFieldObject() {
    return {
      id: this.data.id,
      value: this.data.fieldValue,
      defaultValue: this.data.defaultFieldValue || "",
      multiline: this.data.multiLine,
      password: this.data.password,
      charLimit: this.data.maxLen,
      comb: this.data.comb,
      editable: !this.data.readOnly,
      hidden: this.data.hidden,
      name: this.data.fieldName,
      rect: this.data.rect,
      actions: this.data.actions,
      page: this.data.pageIndex,
      strokeColor: this.data.borderColor,
      fillColor: this.data.backgroundColor,
      rotation: this.rotation,
      datetimeFormat: this.data.datetimeFormat,
      hasDatetimeHTML: !!this.data.datetimeType,
      type: "text"
    };
  }
}
class ButtonWidgetAnnotation extends WidgetAnnotation {
  constructor(params) {
    super(params);
    this.checkedAppearance = null;
    this.uncheckedAppearance = null;
    const isRadio = this.hasFieldFlag(AnnotationFieldFlag.RADIO),
      isPushButton = this.hasFieldFlag(AnnotationFieldFlag.PUSHBUTTON);
    this.data.checkBox = !isRadio && !isPushButton;
    this.data.radioButton = isRadio && !isPushButton;
    this.data.pushButton = isPushButton;
    this.data.isTooltipOnly = false;
    this.data.hasOwnCanvas = true;
    this.data.noHTML = false;
    if (this.data.checkBox) {
      this._processCheckBox(params);
    } else if (this.data.radioButton) {
      this._processRadioButton(params);
    } else if (this.data.pushButton) {
      this._processPushButton(params);
    } else {
      warn("Invalid field flags for button widget annotation");
    }
  }
  get _ownCanvasRequiresForms() {
    return this.data.checkBox || this.data.radioButton;
  }
  #getOperatorListForAppearance(evaluator, task, intent, annotationStorage, rotation, appearance) {
    if (!appearance) {
      return this._getOperatorListNoAppearance();
    }
    const savedAppearance = this.appearance;
    const savedMatrix = lookupMatrix(appearance.dict.getArray("Matrix"), IDENTITY_MATRIX);
    if (rotation) {
      appearance.dict.set("Matrix", this.getRotationMatrix(annotationStorage));
    }
    this.appearance = appearance;
    const operatorList = super.getOperatorList(evaluator, task, intent, annotationStorage);
    this.appearance = savedAppearance;
    appearance.dict.set("Matrix", savedMatrix);
    return operatorList;
  }
  async getOperatorList(evaluator, task, intent, annotationStorage) {
    if (this.data.pushButton) {
      return super.getOperatorList(evaluator, task, intent, false, annotationStorage);
    }
    if (intent & RenderingIntentFlag.DISPLAY && intent & RenderingIntentFlag.ANNOTATIONS_FORMS && (this.data.checkBox || this.data.radioButton)) {
      const setCanvasName = (operatorList, name) => {
        const index = operatorList.fnArray.indexOf(OPS.beginAnnotation);
        if (index !== -1) {
          operatorList.argsArray[index].push(name);
        }
      };
      const checked = await this.#getOperatorListForAppearance(evaluator, task, intent, annotationStorage, null, this.checkedAppearance);
      setCanvasName(checked.opList, "checked");
      const unchecked = await this.#getOperatorListForAppearance(evaluator, task, intent, annotationStorage, null, this.uncheckedAppearance);
      setCanvasName(unchecked.opList, "unchecked");
      checked.opList.addOpList(unchecked.opList);
      checked.separateForm ||= unchecked.separateForm;
      checked.separateCanvas ||= unchecked.separateCanvas;
      return checked;
    }
    let value = null;
    let rotation = null;
    if (annotationStorage) {
      const storageEntry = annotationStorage.get(this.data.id);
      value = storageEntry ? storageEntry.value : null;
      rotation = storageEntry ? storageEntry.rotation : null;
    }
    if (value === null && this.appearance) {
      return super.getOperatorList(evaluator, task, intent, annotationStorage);
    }
    value ??= this.data.checkBox ? this.data.fieldValue === this.data.exportValue : this.data.fieldValue === this.data.buttonValue;
    return this.#getOperatorListForAppearance(evaluator, task, intent, annotationStorage, rotation, value ? this.checkedAppearance : this.uncheckedAppearance);
  }
  async save(evaluator, task, annotationStorage, changes) {
    if (this.data.checkBox) {
      this._saveCheckbox(evaluator, task, annotationStorage, changes);
      return;
    }
    if (this.data.radioButton) {
      this._saveRadioButton(evaluator, task, annotationStorage, changes);
    }
  }
  async _saveCheckbox(evaluator, task, annotationStorage, changes) {
    if (!annotationStorage) {
      return;
    }
    const storageEntry = annotationStorage.get(this.data.id);
    const flags = this._buildFlags(storageEntry?.noView, storageEntry?.noPrint);
    let rotation = storageEntry?.rotation,
      value = storageEntry?.value;
    if (rotation === undefined && flags === undefined) {
      if (value === undefined) {
        return;
      }
      const defaultValue = this.data.fieldValue === this.data.exportValue;
      if (defaultValue === value) {
        return;
      }
    }
    let dict = evaluator.xref.fetchIfRef(this.ref);
    if (!(dict instanceof Dict)) {
      return;
    }
    dict = dict.clone();
    if (rotation === undefined) {
      rotation = this.rotation;
    }
    if (value === undefined) {
      value = this.data.fieldValue === this.data.exportValue;
    }
    const xfa = {
      path: this.data.fieldName,
      value: value ? this.data.exportValue : ""
    };
    const name = Name.get(value ? this._onStateName : "Off");
    this.setValue(dict, name, evaluator.xref, changes);
    dict.set("AS", name);
    dict.set("M", `D:${getModificationDate()}`);
    if (flags !== undefined) {
      dict.set("F", flags);
    }
    this._setMKDict(dict, rotation);
    changes.put(this.ref, {
      data: dict,
      xfa,
      needAppearances: false
    });
  }
  async _saveRadioButton(evaluator, task, annotationStorage, changes) {
    if (!annotationStorage) {
      return;
    }
    const storageEntry = annotationStorage.get(this.data.id);
    const flags = this._buildFlags(storageEntry?.noView, storageEntry?.noPrint);
    let rotation = storageEntry?.rotation,
      value = storageEntry?.value;
    if (rotation === undefined && flags === undefined) {
      if (value === undefined) {
        return;
      }
      const defaultValue = this.data.fieldValue === this.data.buttonValue;
      if (defaultValue === value) {
        return;
      }
    }
    let dict = evaluator.xref.fetchIfRef(this.ref);
    if (!(dict instanceof Dict)) {
      return;
    }
    dict = dict.clone();
    if (value === undefined) {
      value = this.data.fieldValue === this.data.buttonValue;
    }
    if (rotation === undefined) {
      rotation = this.rotation;
    }
    const xfa = {
      path: this.data.fieldName,
      value: value ? this.data.buttonValue : ""
    };
    const name = Name.get(value ? this._onStateName : "Off");
    if (value) {
      this.setValue(dict, name, evaluator.xref, changes);
    }
    dict.set("AS", name);
    dict.set("M", `D:${getModificationDate()}`);
    if (flags !== undefined) {
      dict.set("F", flags);
    }
    this._setMKDict(dict, rotation);
    changes.put(this.ref, {
      data: dict,
      xfa,
      needAppearances: false
    });
  }
  #getZapfDingbatsWidth(char) {
    const glyphName = ZapfDingbatsEncoding[char.charCodeAt(0)];
    return getMetrics().ZapfDingbats()[glyphName];
  }
  #getCaptionMark(dict) {
    const mk = dict.get("MK");
    const caption = mk instanceof Dict ? mk.get("CA") : null;
    if (typeof caption !== "string") {
      return null;
    }
    const char = stringToPDFString(caption)[0];
    return char && this.#getZapfDingbatsWidth(char) ? char : null;
  }
  #setAppearances(params, checked, unchecked, defaultMark) {
    if (this._needAppearances) {
      this.appearance = null;
      checked = unchecked = null;
    }
    const hasChecked = checked instanceof BaseStream;
    const mark = this.#getCaptionMark(params.dict) ?? defaultMark;
    this.checkedAppearance = hasChecked ? checked : this.#createAppearance(params.xref, mark, true);
    this.uncheckedAppearance = unchecked instanceof BaseStream ? unchecked : null;
    if (!hasChecked) {
      this.uncheckedAppearance ??= this.#createAppearance(params.xref, mark, false);
    }
    for (const stream of [this.checkedAppearance, this.uncheckedAppearance]) {
      if (stream) {
        this._streams.push(stream);
      }
    }
  }
  #createAppearance(xref, mark, isChecked) {
    const {
      rotation
    } = this;
    const [width, height] = rotation % 180 === 0 ? [this.width, this.height] : [this.height, this.width];
    const isCircle = this.data.radioButton && mark === "\x6C";
    let appearance = this.getBorderAndBackgroundAppearances(null, isCircle);
    if (isChecked) {
      const {
        fontColor,
        fontSize: daFontSize
      } = this.data.defaultAppearanceData;
      const FONT_RATIO = 0.8;
      const fontSize = daFontSize || Math.min(width, height) * FONT_RATIO;
      const glyphWidth = this.#getZapfDingbatsWidth(mark) / 1000 * fontSize;
      const xShift = numberToString((width - glyphWidth) / 2);
      const yShift = numberToString((height - 0.705 * fontSize) / 2);
      const color = getPdfColor(fontColor, true);
      appearance += `BT /PdfJsZaDb ${fontSize} Tf ${color} ${xShift} ${yShift} Td (${escapeString(mark)}) Tj ET`;
    } else if (!appearance) {
      return null;
    }
    appearance = `q ${appearance} Q`;
    const appearanceStreamDict = new Dict(xref);
    appearanceStreamDict.set("FormType", 1);
    appearanceStreamDict.setIfName("Subtype", "Form");
    appearanceStreamDict.setIfName("Type", "XObject");
    appearanceStreamDict.set("BBox", [0, 0, width, height]);
    appearanceStreamDict.set("Matrix", this.getRotationMatrix());
    appearanceStreamDict.set("Length", appearance.length);
    const resources = new Dict(xref);
    const font = new Dict(xref);
    font.set("PdfJsZaDb", this.fallbackFontDict);
    resources.set("Font", font);
    appearanceStreamDict.set("Resources", resources);
    return new StringStream(appearance, appearanceStreamDict);
  }
  _getOnStateName(dict) {
    const appearanceStates = dict.get("AP");
    if (!(appearanceStates instanceof Dict)) {
      return null;
    }
    const normalAppearance = appearanceStates.get("N");
    if (!(normalAppearance instanceof Dict)) {
      return null;
    }
    for (const key of normalAppearance.getKeys()) {
      if (key !== "Off") {
        return key;
      }
    }
    return null;
  }
  _getExportValueForOptIndex(index, opt, xref) {
    if (Number.isInteger(index) && index >= 0 && index < opt.length) {
      const value = this._decodeFormValue(xref.fetchIfRef(opt[index]));
      if (typeof value === "string") {
        return value;
      }
    }
    return null;
  }
  _getOptInfo(dict, onState, opt, xref) {
    if (!Array.isArray(opt)) {
      return null;
    }
    const stateToIndex = new Map();
    let currentIndex = null;
    const fieldParent = dict.get("Parent");
    const kids = fieldParent instanceof Dict ? fieldParent.get("Kids") : null;
    if (Array.isArray(kids)) {
      for (let i = 0, ii = Math.min(kids.length, opt.length); i < ii; i++) {
        const kid = kids[i];
        if (kid instanceof Ref && isRefsEqual(kid, this.ref)) {
          currentIndex = i;
        }
        const kidDict = xref.fetchIfRef(kid);
        if (!(kidDict instanceof Dict)) {
          continue;
        }
        if (kidDict === dict) {
          currentIndex = i;
        }
        const kidOnState = this._getOnStateName(kidDict);
        if (typeof kidOnState === "string" && !stateToIndex.has(kidOnState)) {
          stateToIndex.set(kidOnState, i);
        }
      }
    } else if (opt.length === 1 && typeof onState === "string") {
      currentIndex = 0;
      stateToIndex.set(onState, 0);
    }
    return {
      currentIndex,
      opt,
      stateToIndex
    };
  }
  _getExportValue(state, optInfo, xref) {
    if (!optInfo || typeof state !== "string" || state === "Off") {
      return state;
    }
    if (state === this._onStateName) {
      const exportValue = this._getExportValueForOptIndex(optInfo.currentIndex, optInfo.opt, xref);
      if (exportValue !== null) {
        return exportValue;
      }
    }
    if (optInfo.stateToIndex.has(state)) {
      const exportValue = this._getExportValueForOptIndex(optInfo.stateToIndex.get(state), optInfo.opt, xref);
      if (exportValue !== null) {
        return exportValue;
      }
    }
    const index = parseInt(state, 10);
    return Number.isInteger(index) && String(index) === state ? this._getExportValueForOptIndex(index, optInfo.opt, xref) || state : state;
  }
  _processCheckBox(params) {
    const customAppearance = params.dict.get("AP");
    let normalAppearance = customAppearance instanceof Dict ? customAppearance.get("N") : null;
    if (!(normalAppearance instanceof Dict)) {
      normalAppearance = null;
    }
    const asValue = this._decodeFormValue(params.dict.get("AS"));
    if (typeof asValue === "string") {
      this.data.fieldValue = asValue;
    }
    const yes = this.data.fieldValue !== null && this.data.fieldValue !== "Off" ? this.data.fieldValue : "Yes";
    const exportValues = normalAppearance ? [...normalAppearance.getKeys()] : [];
    if (exportValues.length === 0) {
      exportValues.push("Off", yes);
    } else if (exportValues.length === 1) {
      if (exportValues[0] === "Off") {
        exportValues.push(yes);
      } else {
        exportValues.unshift("Off");
      }
    } else if (exportValues.includes(yes)) {
      exportValues.length = 0;
      exportValues.push("Off", yes);
    } else {
      const otherYes = exportValues.find(v => v !== "Off");
      exportValues.length = 0;
      exportValues.push("Off", otherYes);
    }
    const onState = exportValues[1];
    this._onStateName = onState;
    const opt = getInheritableProperty({
      dict: params.dict,
      key: "Opt"
    });
    const optInfo = this._getOptInfo(params.dict, onState, opt, params.xref);
    this.data.exportValue = this._getExportValue(onState, optInfo, params.xref);
    if (!exportValues.includes(this.data.fieldValue) && this.data.fieldValue !== this.data.exportValue) {
      this.data.fieldValue = "Off";
    }
    this.data.fieldValue = this._getExportValue(this.data.fieldValue, optInfo, params.xref);
    this.data.defaultFieldValue = this._getExportValue(this.data.defaultFieldValue, optInfo, params.xref);
    this.#setAppearances(params, normalAppearance?.get(onState), normalAppearance?.get("Off"), "\x33");
    this._fallbackFontDict = this.fallbackFontDict;
    if (this.data.defaultFieldValue === null) {
      this.data.defaultFieldValue = "Off";
    }
  }
  _processRadioButton(params) {
    this.data.buttonValue = null;
    const fieldParent = params.dict.get("Parent");
    if (fieldParent instanceof Dict) {
      this.parent = params.dict.getRaw("Parent");
      const fieldParentValue = fieldParent.get("V");
      if (fieldParentValue instanceof Name) {
        this.data.fieldValue = this._decodeFormValue(fieldParentValue);
      }
    }
    const appearanceStates = params.dict.get("AP");
    if (!(appearanceStates instanceof Dict)) {
      return;
    }
    const normalAppearance = appearanceStates.get("N");
    if (!(normalAppearance instanceof Dict)) {
      return;
    }
    let onState = null;
    for (const key of normalAppearance.getKeys()) {
      if (key !== "Off") {
        onState = key;
        break;
      }
    }
    this._onStateName = onState;
    const opt = getInheritableProperty({
      dict: params.dict,
      key: "Opt"
    });
    const optInfo = this._getOptInfo(params.dict, onState, opt, params.xref);
    this.data.buttonValue = this._getExportValue(onState, optInfo, params.xref);
    this.data.fieldValue = this._getExportValue(this.data.fieldValue, optInfo, params.xref);
    this.data.defaultFieldValue = this._getExportValue(this.data.defaultFieldValue, optInfo, params.xref);
    this.#setAppearances(params, normalAppearance.get(onState), normalAppearance.get("Off"), "\x6C");
    this._fallbackFontDict = this.fallbackFontDict;
    if (this.data.defaultFieldValue === null) {
      this.data.defaultFieldValue = "Off";
    }
  }
  _processPushButton(params) {
    const {
      dict,
      annotationGlobals
    } = params;
    if (!dict.has("A") && !dict.has("AA") && !this.data.alternativeText) {
      warn("Push buttons without action dictionaries are not supported");
      return;
    }
    this.data.isTooltipOnly = !dict.has("A") && !dict.has("AA");
    Catalog.parseDestDictionary({
      destDict: dict,
      resultObj: this.data,
      docBaseUrl: annotationGlobals.baseUrl,
      docAttachments: annotationGlobals.attachments
    });
  }
  getFieldObject() {
    let type = "button";
    let exportValues;
    if (this.data.checkBox) {
      type = "checkbox";
      exportValues = this.data.exportValue;
    } else if (this.data.radioButton) {
      type = "radiobutton";
      exportValues = this.data.buttonValue;
    }
    return {
      id: this.data.id,
      value: this.data.fieldValue || "Off",
      defaultValue: this.data.defaultFieldValue,
      exportValues,
      editable: !this.data.readOnly,
      name: this.data.fieldName,
      rect: this.data.rect,
      hidden: this.data.hidden,
      actions: this.data.actions,
      page: this.data.pageIndex,
      strokeColor: this.data.borderColor,
      fillColor: this.data.backgroundColor,
      rotation: this.rotation,
      type
    };
  }
  get fallbackFontDict() {
    const dict = new Dict();
    dict.setIfName("BaseFont", "ZapfDingbats");
    dict.setIfName("Type", "FallbackType");
    dict.setIfName("Subtype", "FallbackType");
    dict.setIfName("Encoding", "ZapfDingbatsEncoding");
    return shadow(this, "fallbackFontDict", dict);
  }
}
class ChoiceWidgetAnnotation extends WidgetAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    this.indices = dict.getArray("I");
    this.hasIndices = Array.isArray(this.indices) && this.indices.length > 0;
    this.data.options = [];
    const options = getInheritableProperty({
      dict,
      key: "Opt"
    });
    if (Array.isArray(options)) {
      for (let i = 0, ii = options.length; i < ii; i++) {
        const option = xref.fetchIfRef(options[i]);
        const isOptionArray = Array.isArray(option);
        this.data.options[i] = {
          exportValue: this._decodeFormValue(isOptionArray ? xref.fetchIfRef(option[0]) : option),
          displayValue: this._decodeFormValue(isOptionArray ? xref.fetchIfRef(option[1]) : option)
        };
      }
    }
    if (!this.hasIndices) {
      if (typeof this.data.fieldValue === "string") {
        this.data.fieldValue = [this.data.fieldValue];
      } else {
        this.data.fieldValue ||= [];
      }
    } else {
      this.data.fieldValue = [];
      const ii = this.data.options.length;
      for (const i of this.indices) {
        if (Number.isInteger(i) && i >= 0 && i < ii) {
          this.data.fieldValue.push(this.data.options[i].exportValue);
        }
      }
    }
    if (this.data.options.length === 0 && this.data.fieldValue.length > 0) {
      this.data.options = this.data.fieldValue.map(value => ({
        exportValue: value,
        displayValue: value
      }));
    }
    this.data.combo = this.hasFieldFlag(AnnotationFieldFlag.COMBO);
    this.data.multiSelect = this.hasFieldFlag(AnnotationFieldFlag.MULTISELECT);
    this._hasText = true;
  }
  getFieldObject() {
    const type = this.data.combo ? "combobox" : "listbox";
    const value = this.data.fieldValue.length > 0 ? this.data.fieldValue[0] : null;
    return {
      id: this.data.id,
      value,
      defaultValue: this.data.defaultFieldValue,
      editable: !this.data.readOnly,
      name: this.data.fieldName,
      rect: this.data.rect,
      numItems: this.data.fieldValue.length,
      multipleSelection: this.data.multiSelect,
      hidden: this.data.hidden,
      actions: this.data.actions,
      items: this.data.options,
      page: this.data.pageIndex,
      strokeColor: this.data.borderColor,
      fillColor: this.data.backgroundColor,
      rotation: this.rotation,
      type
    };
  }
  amendSavedDict(annotationStorage, dict) {
    if (!this.hasIndices) {
      return;
    }
    let values = annotationStorage?.get(this.data.id)?.value;
    if (!Array.isArray(values)) {
      values = [values];
    }
    const indices = [];
    const {
      options
    } = this.data;
    for (let i = 0, j = 0, ii = options.length; i < ii; i++) {
      if (options[i].exportValue === values[j]) {
        indices.push(i);
        j += 1;
      }
    }
    dict.set("I", indices);
  }
  async _getAppearance(evaluator, task, intent, annotationStorage) {
    if (this.data.combo) {
      return super._getAppearance(evaluator, task, intent, annotationStorage);
    }
    let exportedValue, rotation;
    const storageEntry = annotationStorage?.get(this.data.id);
    if (storageEntry) {
      rotation = storageEntry.rotation;
      exportedValue = storageEntry.value;
    }
    if (rotation === undefined && exportedValue === undefined && !this._needAppearances) {
      return null;
    }
    if (exportedValue === undefined) {
      exportedValue = this.data.fieldValue;
    } else if (!Array.isArray(exportedValue)) {
      exportedValue = [exportedValue];
    }
    const defaultPadding = 1;
    const defaultHPadding = 2;
    let {
      width: totalWidth,
      height: totalHeight
    } = this;
    if (rotation === 90 || rotation === 270) {
      [totalWidth, totalHeight] = [totalHeight, totalWidth];
    }
    const lineCount = this.data.options.length;
    const valueIndices = [];
    for (let i = 0; i < lineCount; i++) {
      const {
        exportValue
      } = this.data.options[i];
      if (exportedValue.includes(exportValue)) {
        valueIndices.push(i);
      }
    }
    if (!this._defaultAppearance) {
      this.data.defaultAppearanceData = parseDefaultAppearance(this._defaultAppearance = "/Helvetica 0 Tf 0 g");
    }
    const font = await WidgetAnnotation._getFontData(evaluator, task, this.data.defaultAppearanceData, this._fieldResources.mergedResources);
    let defaultAppearance;
    let {
      fontSize
    } = this.data.defaultAppearanceData;
    if (!fontSize) {
      const lineHeight = (totalHeight - defaultPadding) / lineCount;
      let lineWidth = -1;
      let value;
      for (const {
        displayValue
      } of this.data.options) {
        const width = this._getTextWidth(displayValue, font);
        if (width > lineWidth) {
          lineWidth = width;
          value = displayValue;
        }
      }
      [defaultAppearance, fontSize] = this._computeFontSize(lineHeight, totalWidth - 2 * defaultHPadding, value, font, -1);
    } else {
      defaultAppearance = this._defaultAppearance;
    }
    const lineHeight = fontSize * LINE_FACTOR;
    const vPadding = (lineHeight - fontSize) / 2;
    const numberOfVisibleLines = Math.floor(totalHeight / lineHeight);
    let firstIndex = 0;
    if (valueIndices.length > 0) {
      const minIndex = Math.min(...valueIndices);
      const maxIndex = Math.max(...valueIndices);
      firstIndex = MathClamp(maxIndex - numberOfVisibleLines + 1, 0, minIndex);
    }
    const end = Math.min(firstIndex + numberOfVisibleLines + 1, lineCount);
    const buf = ["/Tx BMC q", `1 1 ${totalWidth} ${totalHeight} re W n`];
    if (valueIndices.length) {
      buf.push("0.600006 0.756866 0.854904 rg");
      for (const index of valueIndices) {
        if (firstIndex <= index && index < end) {
          buf.push(`1 ${totalHeight - (index - firstIndex + 1) * lineHeight} ${totalWidth} ${lineHeight} re f`);
        }
      }
    }
    buf.push("BT", defaultAppearance, `1 0 0 1 0 ${totalHeight} Tm`);
    const prevInfo = {
      shift: 0
    };
    for (let i = firstIndex; i < end; i++) {
      const {
        displayValue
      } = this.data.options[i];
      const vpadding = i === firstIndex ? vPadding : 0;
      buf.push(this._renderText(displayValue, font, fontSize, totalWidth, 0, prevInfo, defaultHPadding, -lineHeight + vpadding));
    }
    buf.push("ET Q EMC");
    return buf.join("\n");
  }
}
class SignatureWidgetAnnotation extends WidgetAnnotation {
  _hasValueFromXFA = false;
  constructor(params) {
    super(params);
    this.data.fieldValue = null;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = !this.data.hasOwnCanvas;
  }
  getFieldObject() {
    return {
      id: this.data.id,
      value: null,
      page: this.data.pageIndex,
      type: "signature"
    };
  }
}
class TextAnnotation extends MarkupAnnotation {
  constructor(params) {
    const DEFAULT_ICON_SIZE = 22;
    super(params);
    this.data.noRotate = true;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;
    const {
      dict
    } = params;
    if (this.data.hasAppearance) {
      this.data.name = "NoIcon";
    } else {
      this.data.rect[1] = this.data.rect[3] - DEFAULT_ICON_SIZE;
      this.data.rect[2] = this.data.rect[0] + DEFAULT_ICON_SIZE;
      this.data.name = dict.has("Name") ? dict.get("Name").name : "Note";
    }
    if (dict.has("State")) {
      this.data.state = dict.get("State") || null;
      this.data.stateModel = dict.get("StateModel") || null;
    } else {
      this.data.state = null;
      this.data.stateModel = null;
    }
  }
}
class LinkAnnotation extends Annotation {
  constructor(params) {
    super(params);
    const {
      dict,
      annotationGlobals
    } = params;
    this.data.noHTML = false;
    const quadPoints = getQuadPoints(dict, this.rectangle);
    if (quadPoints) {
      this.data.quadPoints = quadPoints;
    }
    this.data.borderColor ||= this.data.color;
    Catalog.parseDestDictionary({
      destDict: dict,
      resultObj: this.data,
      docBaseUrl: annotationGlobals.baseUrl,
      docAttachments: annotationGlobals.attachments
    });
  }
  get overlaysTextContent() {
    return true;
  }
}
class PopupAnnotation extends Annotation {
  constructor(params) {
    super(params);
    const {
      dict
    } = params;
    this.data.noHTML = false;
    if (this.width === 0 || this.height === 0) {
      this.data.rect = null;
    }
    let parentItem = dict.get("Parent");
    if (!parentItem) {
      warn("Popup annotation has a missing or invalid parent annotation.");
      return;
    }
    this.data.parentRect = lookupNormalRect(parentItem.getArray("Rect"), null);
    this.data.creationDate = parentItem.get("CreationDate") || "";
    const rt = parentItem.get("RT");
    if (isName(rt, AnnotationReplyType.GROUP)) {
      parentItem = parentItem.get("IRT");
    }
    if (!parentItem.has("M")) {
      this.data.modificationDate = null;
    } else {
      this.setModificationDate(parentItem.get("M"));
      this.data.modificationDate = this.modificationDate;
    }
    if (!parentItem.has("C")) {
      this.data.color = null;
    } else {
      this.setColor(parentItem.getArray("C"));
      this.data.color = this.color;
    }
    if (!this.viewable) {
      const parentFlags = parentItem.get("F");
      if (this._isViewable(parentFlags)) {
        this.setFlags(parentFlags);
      }
    }
    this.setTitle(parentItem.get("T"));
    this.data.titleObj = this._title;
    this.setContents(parentItem.get("Contents"));
    this.data.contentsObj = this._contents;
    if (parentItem.has("RC")) {
      this.data.richText = XFAFactory.getRichTextAsHtml(parentItem.get("RC"));
    }
    this.data.open = !!dict.get("Open");
  }
  static createNewDict(annotation, xref, _params) {
    const {
      oldAnnotation,
      rect,
      parent
    } = annotation;
    const popup = oldAnnotation || new Dict(xref);
    popup.setIfNotExists("Type", Name.get("Annot"));
    popup.setIfNotExists("Subtype", Name.get("Popup"));
    popup.setIfNotExists("Open", false);
    popup.setIfArray("Rect", rect);
    popup.set("Parent", parent);
    return popup;
  }
  static async createNewAppearanceStream(annotation, xref, params) {
    return null;
  }
}
class FreeTextAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.isEditable = !this.data.noHTML;
    this.data.noHTML = false;
    const {
      annotationGlobals,
      xref
    } = params;
    this.setDefaultAppearance(params);
    this._hasAppearance = !!this.appearance;
    if (this._hasAppearance) {
      const {
        fontColor,
        fontSize
      } = parseAppearanceStream(this.appearance, xref, annotationGlobals.globalColorSpaceCache);
      this.data.defaultAppearanceData.fontColor = fontColor;
      this.data.defaultAppearanceData.fontSize = fontSize || 10;
    } else {
      this.data.defaultAppearanceData.fontSize ||= 10;
      const {
        fontColor,
        fontSize
      } = this.data.defaultAppearanceData;
      if (this._contents.str) {
        this.data.textContent = this._contents.str.split(/\r\n?|\n/).map(line => line.trimEnd());
        const {
          coords,
          bbox,
          matrix
        } = FakeUnicodeFont.getFirstPositionInfo(this.rectangle, this.rotation, fontSize);
        this.data.textPosition = this._transformPoint(coords, bbox, matrix);
      }
      if (this._isOffscreenCanvasSupported) {
        const strokeAlpha = params.dict.get("CA");
        const fakeUnicodeFont = new FakeUnicodeFont(xref, "sans-serif");
        this.appearance = fakeUnicodeFont.createAppearance(this._contents.str, this.rectangle, this.rotation, fontSize, fontColor, strokeAlpha);
        this._streams.push(this.appearance);
      } else {
        warn("FreeTextAnnotation: OffscreenCanvas is not supported, annotation may not render correctly.");
      }
    }
  }
  get hasTextContent() {
    return this._hasAppearance;
  }
  static createNewDict(annotation, xref, {
    apRef,
    ap
  }) {
    const {
      color,
      date,
      fontSize,
      oldAnnotation,
      rect,
      rotation,
      user,
      value
    } = annotation;
    const freetext = oldAnnotation || new Dict(xref);
    freetext.setIfNotExists("Type", Name.get("Annot"));
    freetext.setIfNotExists("Subtype", Name.get("FreeText"));
    freetext.set(oldAnnotation ? "M" : "CreationDate", `D:${getModificationDate(date)}`);
    if (oldAnnotation) {
      freetext.delete("RC");
    }
    freetext.setIfArray("Rect", rect);
    const da = `/Helv ${fontSize} Tf ${getPdfColor(color, true)}`;
    freetext.set("DA", da);
    freetext.setIfDefined("Contents", stringToAsciiOrUTF16BE(value));
    freetext.setIfNotExists("F", 4);
    freetext.setIfNotExists("Border", [0, 0, 0]);
    freetext.setIfNumber("Rotate", rotation);
    freetext.setIfDefined("T", stringToAsciiOrUTF16BE(user));
    if (apRef || ap) {
      const n = new Dict(xref);
      freetext.set("AP", n);
      n.set("N", apRef || ap);
    }
    return freetext;
  }
  static getPrintData({
    color,
    fontSize,
    rect,
    rotation,
    value
  }) {
    throw new Error("Not implemented: getPrintData");
  }
  static async createNewAppearanceStream(annotation, xref, params) {
    const {
      baseFontRef,
      evaluator,
      task
    } = params;
    const {
      color,
      fontSize,
      rect,
      rotation,
      value
    } = annotation;
    if (!color) {
      return null;
    }
    const resources = new Dict(xref);
    const font = new Dict(xref);
    if (baseFontRef) {
      font.set("Helv", baseFontRef);
    } else {
      const baseFont = new Dict(xref);
      baseFont.setIfName("BaseFont", "Helvetica");
      baseFont.setIfName("Type", "Font");
      baseFont.setIfName("Subtype", "Type1");
      baseFont.setIfName("Encoding", "WinAnsiEncoding");
      font.set("Helv", baseFont);
    }
    resources.set("Font", font);
    const helv = await WidgetAnnotation._getFontData(evaluator, task, {
      fontName: "Helv",
      fontSize
    }, resources);
    const [x1, y1, x2, y2] = rect;
    let w = x2 - x1;
    let h = y2 - y1;
    if (rotation % 180 !== 0) {
      [w, h] = [h, w];
    }
    const lines = value.split("\n");
    const scale = fontSize / 1000;
    let totalWidth = -Infinity;
    const encodedLines = [];
    for (let line of lines) {
      const encoded = helv.encodeString(line);
      if (encoded.length > 1) {
        return null;
      }
      line = encoded.join("");
      encodedLines.push(line);
      let lineWidth = 0;
      const glyphs = helv.charsToGlyphs(line);
      for (const glyph of glyphs) {
        lineWidth += glyph.width * scale;
      }
      totalWidth = Math.max(totalWidth, lineWidth);
    }
    const hscale = totalWidth > w ? w / totalWidth : 1;
    let vscale = 1;
    const lineHeight = LINE_FACTOR * fontSize;
    const lineAscent = (LINE_FACTOR - LINE_DESCENT_FACTOR) * fontSize;
    const totalHeight = lineHeight * lines.length;
    if (totalHeight > h) {
      vscale = h / totalHeight;
    }
    const fscale = Math.min(hscale, vscale);
    const newFontSize = fontSize * fscale;
    let firstPoint, clipBox, matrix;
    switch (rotation) {
      case 0:
        matrix = [1, 0, 0, 1];
        clipBox = [rect[0], rect[1], w, h];
        firstPoint = [rect[0], rect[3] - lineAscent];
        break;
      case 90:
        matrix = [0, 1, -1, 0];
        clipBox = [rect[1], -rect[2], w, h];
        firstPoint = [rect[1], -rect[0] - lineAscent];
        break;
      case 180:
        matrix = [-1, 0, 0, -1];
        clipBox = [-rect[2], -rect[3], w, h];
        firstPoint = [-rect[2], -rect[1] - lineAscent];
        break;
      case 270:
        matrix = [0, -1, 1, 0];
        clipBox = [-rect[3], rect[0], w, h];
        firstPoint = [-rect[3], rect[2] - lineAscent];
        break;
    }
    const buffer = ["q", `${matrix.join(" ")} 0 0 cm`, `${clipBox.join(" ")} re W n`, `BT`, `${getPdfColor(color, true)}`, `0 Tc /Helv ${numberToString(newFontSize)} Tf`];
    buffer.push(`${firstPoint.join(" ")} Td (${escapeString(encodedLines[0])}) Tj`);
    const vShift = numberToString(lineHeight);
    for (let i = 1, ii = encodedLines.length; i < ii; i++) {
      const line = encodedLines[i];
      buffer.push(`0 -${vShift} Td (${escapeString(line)}) Tj`);
    }
    buffer.push("ET", "Q");
    const appearance = buffer.join("\n");
    const appearanceStreamDict = new Dict(xref);
    appearanceStreamDict.set("FormType", 1);
    appearanceStreamDict.setIfName("Subtype", "Form");
    appearanceStreamDict.setIfName("Type", "XObject");
    appearanceStreamDict.set("BBox", rect);
    appearanceStreamDict.set("Resources", resources);
    appearanceStreamDict.set("Matrix", [1, 0, 0, 1, -rect[0], -rect[1]]);
    return new StringStream(appearance, appearanceStreamDict);
  }
}
class LineAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;
    const lineCoordinates = lookupRect(dict.getArray("L"), [0, 0, 0, 0]);
    this.data.lineCoordinates = Util.normalizeRect(lineCoordinates);
    this.setLineEndings(dict.getArray("LE"));
    this.data.lineEndings = this.lineEndings;
    if (!this.appearance) {
      const strokeColor = getPdfColorArray(this.color, [0, 0, 0]);
      const strokeAlpha = dict.get("CA");
      const interiorColor = getRgbColor(dict.getArray("IC"), null);
      const fillColor = getPdfColorArray(interiorColor);
      const fillAlpha = fillColor ? strokeAlpha : null;
      const borderWidth = this.borderStyle.width || 1,
        borderAdjust = 2 * borderWidth;
      const bbox = [this.data.lineCoordinates[0] - borderAdjust, this.data.lineCoordinates[1] - borderAdjust, this.data.lineCoordinates[2] + borderAdjust, this.data.lineCoordinates[3] + borderAdjust];
      if (!Util.intersect(this.rectangle, bbox)) {
        this.rectangle = bbox;
      }
      this._setDefaultAppearance({
        xref,
        extra: `${borderWidth} w`,
        strokeColor,
        fillColor,
        strokeAlpha,
        fillAlpha,
        pointsCallback: (buffer, points) => {
          buffer.push(`${lineCoordinates[0]} ${lineCoordinates[1]} m`, `${lineCoordinates[2]} ${lineCoordinates[3]} l`, "S");
          return [points[0] - borderWidth, points[7] - borderWidth, points[2] + borderWidth, points[3] + borderWidth];
        }
      });
    }
  }
}
class SquareAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;
    if (!this.appearance) {
      const strokeColor = getPdfColorArray(this.color, [0, 0, 0]);
      const strokeAlpha = dict.get("CA");
      const interiorColor = getRgbColor(dict.getArray("IC"), null);
      const fillColor = getPdfColorArray(interiorColor);
      const fillAlpha = fillColor ? strokeAlpha : null;
      if (this.borderStyle.width === 0 && !fillColor) {
        return;
      }
      this._setDefaultAppearance({
        xref,
        extra: `${this.borderStyle.width} w`,
        strokeColor,
        fillColor,
        strokeAlpha,
        fillAlpha,
        pointsCallback: (buffer, points) => {
          const x = points[4] + this.borderStyle.width / 2;
          const y = points[5] + this.borderStyle.width / 2;
          const width = points[6] - points[4] - this.borderStyle.width;
          const height = points[3] - points[7] - this.borderStyle.width;
          buffer.push(`${x} ${y} ${width} ${height} re`);
          if (fillColor) {
            buffer.push("B");
          } else {
            buffer.push("S");
          }
          return [points[0], points[7], points[2], points[3]];
        }
      });
    }
  }
}
class CircleAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    if (!this.appearance) {
      const strokeColor = getPdfColorArray(this.color, [0, 0, 0]);
      const strokeAlpha = dict.get("CA");
      const interiorColor = getRgbColor(dict.getArray("IC"), null);
      const fillColor = getPdfColorArray(interiorColor);
      const fillAlpha = fillColor ? strokeAlpha : null;
      if (this.borderStyle.width === 0 && !fillColor) {
        return;
      }
      const controlPointsDistance = 4 / 3 * Math.tan(Math.PI / (2 * 4));
      this._setDefaultAppearance({
        xref,
        extra: `${this.borderStyle.width} w`,
        strokeColor,
        fillColor,
        strokeAlpha,
        fillAlpha,
        pointsCallback: (buffer, points) => {
          const x0 = points[0] + this.borderStyle.width / 2;
          const y0 = points[1] - this.borderStyle.width / 2;
          const x1 = points[6] - this.borderStyle.width / 2;
          const y1 = points[7] + this.borderStyle.width / 2;
          const xMid = x0 + (x1 - x0) / 2;
          const yMid = y0 + (y1 - y0) / 2;
          const xOffset = (x1 - x0) / 2 * controlPointsDistance;
          const yOffset = (y1 - y0) / 2 * controlPointsDistance;
          buffer.push(`${xMid} ${y1} m`, `${xMid + xOffset} ${y1} ${x1} ${yMid + yOffset} ${x1} ${yMid} c`, `${x1} ${yMid - yOffset} ${xMid + xOffset} ${y0} ${xMid} ${y0} c`, `${xMid - xOffset} ${y0} ${x0} ${yMid - yOffset} ${x0} ${yMid} c`, `${x0} ${yMid + yOffset} ${xMid - xOffset} ${y1} ${xMid} ${y1} c`, "h");
          if (fillColor) {
            buffer.push("B");
          } else {
            buffer.push("S");
          }
          return [points[0], points[7], points[2], points[3]];
        }
      });
    }
  }
}
class PolylineAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;
    this.data.vertices = null;
    if (!(this instanceof PolygonAnnotation)) {
      this.setLineEndings(dict.getArray("LE"));
      this.data.lineEndings = this.lineEndings;
    }
    const rawVertices = dict.getArray("Vertices");
    if (!isNumberArray(rawVertices, null)) {
      return;
    }
    const vertices = this.data.vertices = Float32Array.from(rawVertices);
    if (!this.appearance) {
      const strokeColor = getPdfColorArray(this.color, [0, 0, 0]);
      const strokeAlpha = dict.get("CA");
      let fillColor = getRgbColor(dict.getArray("IC"), null);
      fillColor &&= getPdfColorArray(fillColor);
      let operator;
      if (fillColor) {
        if (this.color) {
          operator = fillColor.every((c, i) => c === strokeColor[i]) ? "f" : "B";
        } else {
          operator = "f";
        }
      } else {
        operator = "S";
      }
      const borderWidth = this.borderStyle.width || 1,
        borderAdjust = 2 * borderWidth;
      const bbox = BBOX_INIT.slice();
      for (let i = 0, ii = vertices.length; i < ii; i += 2) {
        Util.rectBoundingBox(vertices[i] - borderAdjust, vertices[i + 1] - borderAdjust, vertices[i] + borderAdjust, vertices[i + 1] + borderAdjust, bbox);
      }
      if (!Util.intersect(this.rectangle, bbox)) {
        this.rectangle = bbox;
      }
      this._setDefaultAppearance({
        xref,
        extra: `${borderWidth} w`,
        strokeColor,
        strokeAlpha,
        fillColor,
        fillAlpha: fillColor ? strokeAlpha : null,
        pointsCallback: (buffer, points) => {
          for (let i = 0, ii = vertices.length; i < ii; i += 2) {
            buffer.push(`${vertices[i]} ${vertices[i + 1]} ${i === 0 ? "m" : "l"}`);
          }
          buffer.push(operator);
          return [points[0], points[7], points[2], points[3]];
        }
      });
    }
  }
}
class PolygonAnnotation extends PolylineAnnotation {}
class CaretAnnotation extends MarkupAnnotation {}
class InkAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;
    const {
      dict,
      xref
    } = params;
    this.data.inkLists = [];
    this.data.isEditable = !this.data.noHTML;
    this.data.noHTML = false;
    this.data.opacity = dict.get("CA") || 1;
    const rawInkLists = dict.getArray("InkList");
    if (!Array.isArray(rawInkLists)) {
      return;
    }
    for (const rawInkList of rawInkLists) {
      if (!Array.isArray(rawInkList)) {
        continue;
      }
      const inkList = new Float32Array(rawInkList.length);
      this.data.inkLists.push(inkList);
      for (let j = 0, jj = rawInkList.length; j < jj; j += 2) {
        const x = xref.fetchIfRef(rawInkList[j]),
          y = xref.fetchIfRef(rawInkList[j + 1]);
        if (typeof x === "number" && typeof y === "number") {
          inkList[j] = x;
          inkList[j + 1] = y;
        }
      }
    }
    if (!this.appearance) {
      const strokeColor = getPdfColorArray(this.color, [0, 0, 0]);
      const strokeAlpha = dict.get("CA");
      const borderWidth = this.borderStyle.width || 1,
        borderAdjust = 2 * borderWidth;
      const bbox = BBOX_INIT.slice();
      for (const inkList of this.data.inkLists) {
        for (let i = 0, ii = inkList.length; i < ii; i += 2) {
          Util.rectBoundingBox(inkList[i] - borderAdjust, inkList[i + 1] - borderAdjust, inkList[i] + borderAdjust, inkList[i + 1] + borderAdjust, bbox);
        }
      }
      if (!Util.intersect(this.rectangle, bbox)) {
        this.rectangle = bbox;
      }
      this._setDefaultAppearance({
        xref,
        extra: `${borderWidth} w`,
        strokeColor,
        strokeAlpha,
        pointsCallback: (buffer, points) => {
          for (const inkList of this.data.inkLists) {
            for (let i = 0, ii = inkList.length; i < ii; i += 2) {
              buffer.push(`${inkList[i]} ${inkList[i + 1]} ${i === 0 ? "m" : "l"}`);
            }
            buffer.push("S");
          }
          return [points[0], points[7], points[2], points[3]];
        }
      });
    }
  }
  static createNewDict(annotation, xref, {
    apRef,
    ap
  }) {
    const {
      oldAnnotation,
      color,
      date,
      opacity,
      paths,
      outlines,
      rect,
      rotation,
      thickness,
      user
    } = annotation;
    const ink = oldAnnotation || new Dict(xref);
    ink.setIfNotExists("Type", Name.get("Annot"));
    ink.setIfNotExists("Subtype", Name.get("Ink"));
    ink.set(oldAnnotation ? "M" : "CreationDate", `D:${getModificationDate(date)}`);
    ink.setIfArray("Rect", rect);
    ink.setIfArray("InkList", outlines?.points || paths?.points);
    ink.setIfNotExists("F", 4);
    ink.setIfNumber("Rotate", rotation);
    ink.setIfDefined("T", stringToAsciiOrUTF16BE(user));
    if (outlines) {
      ink.setIfName("IT", "InkHighlight");
    }
    if (thickness > 0) {
      const bs = new Dict(xref);
      ink.set("BS", bs);
      bs.set("W", thickness);
    }
    ink.setIfArray("C", getPdfColorArray(color));
    ink.setIfNumber("CA", opacity);
    if (ap || apRef) {
      const n = new Dict(xref);
      ink.set("AP", n);
      n.set("N", apRef || ap);
    }
    return ink;
  }
  static async createNewAppearanceStream(annotation, xref, params) {
    if (annotation.outlines) {
      return this.createNewAppearanceStreamForHighlight(annotation, xref, params);
    }
    const {
      color,
      rect,
      paths,
      thickness,
      opacity
    } = annotation;
    if (!color) {
      return null;
    }
    const appearanceBuffer = [`${thickness} w 1 J 1 j`, `${getPdfColor(color, false)}`];
    if (opacity !== 1) {
      appearanceBuffer.push("/R0 gs");
    }
    for (const outline of paths.lines) {
      writeLineToCurveToAppearance(outline, appearanceBuffer, true);
    }
    appearanceBuffer.push("S");
    const appearance = appearanceBuffer.join("\n");
    const appearanceStreamDict = new Dict(xref);
    appearanceStreamDict.set("FormType", 1);
    appearanceStreamDict.setIfName("Subtype", "Form");
    appearanceStreamDict.setIfName("Type", "XObject");
    appearanceStreamDict.set("BBox", rect);
    appearanceStreamDict.set("Length", appearance.length);
    if (opacity !== 1) {
      const resources = new Dict(xref);
      const extGState = new Dict(xref);
      const r0 = new Dict(xref);
      r0.set("CA", opacity);
      r0.setIfName("Type", "ExtGState");
      extGState.set("R0", r0);
      resources.set("ExtGState", extGState);
      appearanceStreamDict.set("Resources", resources);
    }
    return new StringStream(appearance, appearanceStreamDict);
  }
  static async createNewAppearanceStreamForHighlight(annotation, xref, params) {
    const {
      color,
      rect,
      outlines: {
        outline
      },
      opacity
    } = annotation;
    if (!color) {
      return null;
    }
    const appearanceBuffer = [`${getPdfColor(color, true)}`, "/R0 gs"];
    writeLineToCurveToAppearance(outline, appearanceBuffer);
    appearanceBuffer.push("h f");
    const appearance = appearanceBuffer.join("\n");
    const appearanceStreamDict = new Dict(xref);
    appearanceStreamDict.set("FormType", 1);
    appearanceStreamDict.setIfName("Subtype", "Form");
    appearanceStreamDict.setIfName("Type", "XObject");
    appearanceStreamDict.set("BBox", rect);
    appearanceStreamDict.set("Length", appearance.length);
    const resources = new Dict(xref);
    const extGState = new Dict(xref);
    resources.set("ExtGState", extGState);
    appearanceStreamDict.set("Resources", resources);
    const r0 = new Dict(xref);
    extGState.set("R0", r0);
    r0.setIfName("BM", "Multiply");
    if (opacity !== 1) {
      r0.set("ca", opacity);
      r0.setIfName("Type", "ExtGState");
    }
    return new StringStream(appearance, appearanceStreamDict);
  }
}
class HighlightAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    this.data.isEditable = !this.data.noHTML;
    this.data.noHTML = false;
    this.data.opacity = dict.get("CA") || 1;
    const quadPoints = this.data.quadPoints = getQuadPoints(dict, null);
    if (quadPoints) {
      if (!this.appearance) {
        const fillColor = getPdfColorArray(this.color, [1, 1, 0]);
        const fillAlpha = dict.get("CA");
        this._setDefaultAppearance({
          xref,
          fillColor,
          blendMode: "Multiply",
          fillAlpha,
          pointsCallback: (buffer, points) => {
            buffer.push(`${points[0]} ${points[1]} m`, `${points[2]} ${points[3]} l`, `${points[6]} ${points[7]} l`, `${points[4]} ${points[5]} l`, "f");
            return [points[0], points[7], points[2], points[3]];
          }
        });
      }
    } else {
      this.data.popupRef = null;
    }
  }
  get overlaysTextContent() {
    return true;
  }
  static createNewDict(annotation, xref, {
    apRef,
    ap
  }) {
    const {
      color,
      date,
      oldAnnotation,
      opacity,
      rect,
      rotation,
      user,
      quadPoints
    } = annotation;
    const highlight = oldAnnotation || new Dict(xref);
    highlight.setIfNotExists("Type", Name.get("Annot"));
    highlight.setIfNotExists("Subtype", Name.get("Highlight"));
    highlight.set(oldAnnotation ? "M" : "CreationDate", `D:${getModificationDate(date)}`);
    highlight.setIfArray("Rect", rect);
    highlight.setIfNotExists("F", 4);
    highlight.setIfNotExists("Border", [0, 0, 0]);
    highlight.setIfNumber("Rotate", rotation);
    highlight.setIfArray("QuadPoints", quadPoints);
    highlight.setIfArray("C", getPdfColorArray(color));
    highlight.setIfNumber("CA", opacity);
    highlight.setIfDefined("T", stringToAsciiOrUTF16BE(user));
    if (apRef || ap) {
      const n = new Dict(xref);
      highlight.set("AP", n);
      n.set("N", apRef || ap);
    }
    return highlight;
  }
  static async createNewAppearanceStream(annotation, xref, params) {
    const {
      color,
      rect,
      outlines,
      opacity
    } = annotation;
    if (!color) {
      return null;
    }
    const appearanceBuffer = [`${getPdfColor(color, true)}`, "/R0 gs"];
    const buffer = [];
    for (const outline of outlines) {
      buffer.length = 0;
      buffer.push(`${numberToString(outline[0])} ${numberToString(outline[1])} m`);
      for (let i = 2, ii = outline.length; i < ii; i += 2) {
        buffer.push(`${numberToString(outline[i])} ${numberToString(outline[i + 1])} l`);
      }
      buffer.push("h");
      appearanceBuffer.push(buffer.join("\n"));
    }
    appearanceBuffer.push("f*");
    const appearance = appearanceBuffer.join("\n");
    const appearanceStreamDict = new Dict(xref);
    appearanceStreamDict.set("FormType", 1);
    appearanceStreamDict.setIfName("Subtype", "Form");
    appearanceStreamDict.setIfName("Type", "XObject");
    appearanceStreamDict.set("BBox", rect);
    appearanceStreamDict.set("Length", appearance.length);
    const resources = new Dict(xref);
    const extGState = new Dict(xref);
    resources.set("ExtGState", extGState);
    appearanceStreamDict.set("Resources", resources);
    const r0 = new Dict(xref);
    extGState.set("R0", r0);
    r0.setIfName("BM", "Multiply");
    if (opacity !== 1) {
      r0.set("ca", opacity);
      r0.setIfName("Type", "ExtGState");
    }
    return new StringStream(appearance, appearanceStreamDict);
  }
}
class UnderlineAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    const quadPoints = this.data.quadPoints = getQuadPoints(dict, null);
    if (quadPoints) {
      if (!this.appearance) {
        const strokeColor = getPdfColorArray(this.color, [0, 0, 0]);
        const strokeAlpha = dict.get("CA");
        this._setDefaultAppearance({
          xref,
          extra: "[] 0 d 0.571 w",
          strokeColor,
          strokeAlpha,
          pointsCallback: (buffer, points) => {
            buffer.push(`${points[4]} ${points[5] + 1.3} m`, `${points[6]} ${points[7] + 1.3} l`, "S");
            return [points[0], points[7], points[2], points[3]];
          }
        });
      }
    } else {
      this.data.popupRef = null;
    }
  }
  get overlaysTextContent() {
    return true;
  }
}
class SquigglyAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    const quadPoints = this.data.quadPoints = getQuadPoints(dict, null);
    if (quadPoints) {
      if (!this.appearance) {
        const strokeColor = getPdfColorArray(this.color, [0, 0, 0]);
        const strokeAlpha = dict.get("CA");
        this._setDefaultAppearance({
          xref,
          extra: "[] 0 d 1 w",
          strokeColor,
          strokeAlpha,
          pointsCallback: (buffer, points) => {
            const dy = (points[1] - points[5]) / 6;
            let shift = dy;
            let x = points[4];
            const y = points[5];
            const xEnd = points[6];
            buffer.push(`${x} ${y + shift} m`);
            do {
              x += 2;
              shift = shift === 0 ? dy : 0;
              buffer.push(`${x} ${y + shift} l`);
            } while (x < xEnd);
            buffer.push("S");
            return [points[4], y - 2 * dy, xEnd, y + 2 * dy];
          }
        });
      }
    } else {
      this.data.popupRef = null;
    }
  }
  get overlaysTextContent() {
    return true;
  }
}
class StrikeOutAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref
    } = params;
    const quadPoints = this.data.quadPoints = getQuadPoints(dict, null);
    if (quadPoints) {
      if (!this.appearance) {
        const strokeColor = getPdfColorArray(this.color, [0, 0, 0]);
        const strokeAlpha = dict.get("CA");
        this._setDefaultAppearance({
          xref,
          extra: "[] 0 d 1 w",
          strokeColor,
          strokeAlpha,
          pointsCallback: (buffer, points) => {
            buffer.push(`${(points[0] + points[4]) / 2} ` + `${(points[1] + points[5]) / 2} m`, `${(points[2] + points[6]) / 2} ` + `${(points[3] + points[7]) / 2} l`, "S");
            return [points[0], points[7], points[2], points[3]];
          }
        });
      }
    } else {
      this.data.popupRef = null;
    }
  }
  get overlaysTextContent() {
    return true;
  }
}
class StampAnnotation extends MarkupAnnotation {
  #savedHasOwnCanvas = null;
  constructor(params) {
    super(params);
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.isEditable = !this.data.noHTML;
    this.data.noHTML = false;
  }
  mustBeViewedWhenEditing(isEditing, modifiedIds = null) {
    if (isEditing) {
      if (!this.data.isEditable) {
        return true;
      }
      this.#savedHasOwnCanvas ??= this.data.hasOwnCanvas;
      this.data.hasOwnCanvas = true;
      return true;
    }
    if (this.#savedHasOwnCanvas !== null) {
      this.data.hasOwnCanvas = this.#savedHasOwnCanvas;
      this.#savedHasOwnCanvas = null;
    }
    return !modifiedIds?.has(this.data.id);
  }
  static createNewDict(annotation, xref, {
    apRef,
    ap
  }) {
    const {
      date,
      oldAnnotation,
      rect,
      rotation,
      user
    } = annotation;
    const stamp = oldAnnotation || new Dict(xref);
    stamp.setIfNotExists("Type", Name.get("Annot"));
    stamp.setIfNotExists("Subtype", Name.get("Stamp"));
    stamp.set(oldAnnotation ? "M" : "CreationDate", `D:${getModificationDate(date)}`);
    stamp.setIfArray("Rect", rect);
    stamp.setIfNotExists("F", 4);
    stamp.setIfNotExists("Border", [0, 0, 0]);
    stamp.setIfNumber("Rotate", rotation);
    stamp.setIfDefined("T", stringToAsciiOrUTF16BE(user));
    if (apRef || ap) {
      const n = new Dict(xref);
      stamp.set("AP", n);
      n.set("N", apRef || ap);
    }
    return stamp;
  }
  static async #createNewAppearanceStreamForDrawing(annotation, xref) {
    const {
      areContours,
      color,
      rect,
      lines,
      thickness
    } = annotation;
    if (!color) {
      return null;
    }
    const appearanceBuffer = [`${thickness} w 1 J 1 j`, `${getPdfColor(color, areContours)}`];
    for (const line of lines) {
      writeLineToCurveToAppearance(line, appearanceBuffer, true);
    }
    appearanceBuffer.push(areContours ? "F" : "S");
    const appearance = appearanceBuffer.join("\n");
    const appearanceStreamDict = new Dict(xref);
    appearanceStreamDict.set("FormType", 1);
    appearanceStreamDict.setIfName("Subtype", "Form");
    appearanceStreamDict.setIfName("Type", "XObject");
    appearanceStreamDict.set("BBox", rect);
    appearanceStreamDict.set("Length", appearance.length);
    return new StringStream(appearance, appearanceStreamDict);
  }
  static async createNewAppearanceStream(annotation, xref, params) {
    if (annotation.oldAnnotation) {
      return null;
    }
    if (annotation.isSignature) {
      return this.#createNewAppearanceStreamForDrawing(annotation, xref);
    }
    const {
      rotation
    } = annotation;
    const {
      imageRef,
      width,
      height
    } = params.image;
    const resources = new Dict(xref);
    const xobject = new Dict(xref);
    resources.set("XObject", xobject);
    xobject.set("Im0", imageRef);
    const appearance = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
    const appearanceStreamDict = new Dict(xref);
    appearanceStreamDict.set("FormType", 1);
    appearanceStreamDict.setIfName("Subtype", "Form");
    appearanceStreamDict.setIfName("Type", "XObject");
    appearanceStreamDict.set("BBox", [0, 0, width, height]);
    appearanceStreamDict.set("Resources", resources);
    if (rotation) {
      const matrix = getRotationMatrix(rotation, width, height);
      appearanceStreamDict.set("Matrix", matrix);
    }
    return new StringStream(appearance, appearanceStreamDict);
  }
}
class FileAttachmentAnnotation extends MarkupAnnotation {
  constructor(params) {
    super(params);
    const {
      annotationGlobals,
      dict
    } = params;
    const fsDict = dict.get("FS");
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;
    this.data.fileId = this._getAttachmentId(fsDict, dict.getRaw("FS"), annotationGlobals);
    this.data.file = new FileSpec(fsDict).serializable;
    const name = dict.get("Name");
    this.data.name = name instanceof Name ? stringToPDFString(name.name) : "PushPin";
    const fillAlpha = dict.get("ca");
    this.data.fillAlpha = typeof fillAlpha === "number" && fillAlpha >= 0 && fillAlpha <= 1 ? fillAlpha : null;
  }
}
class MediaAnnotation extends Annotation {
  static #MEDIA_MIME_TYPE_RE = /^(?:video|audio)\/[a-z0-9][\w!#$&^.+-]{0,126}$/i;
  static #MEDIA_CONTENT_TYPE_RE = /^(?:video|audio)\/[a-z0-9][\w!#$&^.+-]{0,126}(?: *; *[a-z0-9][\w!#$&^.+-]{0,126} *= *(?:[-!#$%&'*+.^\x60{|}~\w]+|"(?:[\x20\x21\x23-\x5b\x5d-\x7e]|\\[\x20-\x7e])*"))* *$/i;
  constructor(params) {
    super(params);
    this.data.noHTML = true;
  }
  _setMediaData({
    assetRef,
    assetDict,
    filename,
    contentType,
    wrapSound = false
  }, annotationGlobals) {
    this.data.noHTML = false;
    this.data.richMedia = {
      fileId: this._getAttachmentId(assetDict, assetRef, annotationGlobals, wrapSound),
      filename,
      contentType
    };
  }
  static _getContentType(assetDict, filename, contentType = null, contentTypeIsName = false) {
    if (typeof contentType === "string" && (contentTypeIsName ? MediaAnnotation.#MEDIA_MIME_TYPE_RE : MediaAnnotation.#MEDIA_CONTENT_TYPE_RE).test(contentType)) {
      return contentType;
    }
    const stream = FileSpec.pickPlatformItem(assetDict.get("EF"));
    const subtype = stream instanceof BaseStream ? stream.dict?.get("Subtype") : null;
    if (subtype instanceof Name && MediaAnnotation.#MEDIA_MIME_TYPE_RE.test(subtype.name)) {
      return subtype.name;
    }
    const extPos = filename.lastIndexOf(".") + 1,
      ext = extPos > 0 && filename.substring(extPos).toLowerCase();
    switch (ext) {
      case "mp4":
      case "m4v":
        return "video/mp4";
      case "webm":
        return "video/webm";
      case "ogv":
        return "video/ogg";
      case "mov":
        return "video/quicktime";
      case "mp3":
        return "audio/mpeg";
      case "m4a":
        return "audio/mp4";
      case "wav":
        return "audio/wav";
      case "oga":
      case "ogg":
        return "audio/ogg";
      default:
        return null;
    }
  }
}
class RichMediaAnnotation extends MediaAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref,
      annotationGlobals
    } = params;
    const content = dict.get("RichMediaContent");
    if (!(content instanceof Dict)) {
      return;
    }
    const asset = RichMediaAnnotation.#findAsset(content, xref);
    if (!asset) {
      warn("RichMedia annotation has no playable asset.");
      return;
    }
    this._setMediaData(asset, annotationGlobals);
  }
  static #findAsset(content, xref) {
    const configurations = content.get("Configurations");
    if (!Array.isArray(configurations)) {
      return null;
    }
    for (const configRef of configurations) {
      const config = xref.fetchIfRef(configRef);
      if (!(config instanceof Dict)) {
        continue;
      }
      const instances = config.get("Instances");
      if (!Array.isArray(instances)) {
        continue;
      }
      for (const instanceRef of instances) {
        const instance = xref.fetchIfRef(instanceRef);
        if (!(instance instanceof Dict)) {
          continue;
        }
        if (isName(instance.get("Subtype"), "Flash")) {
          continue;
        }
        const rawAsset = instance.getRaw("Asset");
        const asset = xref.fetchIfRef(rawAsset);
        if (!(asset instanceof Dict)) {
          continue;
        }
        if (!FileSpec.hasEmbeddedFile(asset)) {
          continue;
        }
        const {
          filename
        } = new FileSpec(asset).serializable;
        const contentType = MediaAnnotation._getContentType(asset, filename);
        if (!contentType) {
          continue;
        }
        return {
          assetRef: rawAsset instanceof Ref ? rawAsset : null,
          assetDict: asset,
          filename,
          contentType
        };
      }
    }
    return null;
  }
}
class ScreenAnnotation extends MediaAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref,
      annotationGlobals
    } = params;
    const asset = ScreenAnnotation.#findAsset(dict, xref);
    if (!asset) {
      return;
    }
    this._setMediaData(asset, annotationGlobals);
  }
  static #findAsset(dict, xref) {
    for (const action of this.#renditionActions(dict)) {
      const asset = this.#findRenditionAsset(action.get("R"), xref, new RefSet());
      if (asset) {
        return asset;
      }
    }
    return null;
  }
  static *#renditionActions(dict) {
    const action = dict.get("A");
    if (this.#isPlayAction(action)) {
      yield action;
    }
    const additionalActions = dict.get("AA");
    if (additionalActions instanceof Dict) {
      for (const [, aa] of additionalActions) {
        if (this.#isPlayAction(aa)) {
          yield aa;
        }
      }
    }
  }
  static #isPlayAction(action) {
    if (!(action instanceof Dict) || !isName(action.get("S"), "Rendition")) {
      return false;
    }
    const operation = action.get("OP");
    return operation === undefined || operation === AnnotationRenditionOperation.PLAY_OR_RESUME || operation === AnnotationRenditionOperation.PLAY;
  }
  static #findRenditionAsset(rendition, xref, seen) {
    if (!(rendition instanceof Dict)) {
      return null;
    }
    const subtype = rendition.get("S");
    if (isName(subtype, "MR")) {
      return this.#findClipAsset(rendition.get("C"), xref);
    }
    if (isName(subtype, "SR")) {
      const renditions = rendition.get("R");
      if (Array.isArray(renditions)) {
        for (const ref of renditions) {
          if (ref instanceof Ref) {
            if (seen.has(ref)) {
              continue;
            }
            seen.put(ref);
          }
          const asset = this.#findRenditionAsset(xref.fetchIfRef(ref), xref, seen);
          if (asset) {
            return asset;
          }
        }
      }
    }
    return null;
  }
  static #findClipAsset(clip, xref) {
    if (!(clip instanceof Dict) || !isName(clip.get("S"), "MCD")) {
      return null;
    }
    const rawData = clip.getRaw("D");
    const data = xref.fetchIfRef(rawData);
    const contentTypeHint = clip.get("CT");
    let explicitType = typeof contentTypeHint === "string" ? contentTypeHint : null;
    let explicitTypeIsName = false;
    let assetDict, filename;
    if (data instanceof BaseStream) {
      assetDict = data.dict;
      const name = clip.get("N");
      filename = typeof name === "string" ? stringToPDFString(name) : "";
      if (!explicitType) {
        const subtype = data.dict.get("Subtype");
        if (subtype instanceof Name) {
          explicitType = subtype.name;
          explicitTypeIsName = true;
        }
      }
    } else if (data instanceof Dict) {
      if (!FileSpec.hasEmbeddedFile(data)) {
        return null;
      }
      assetDict = data;
      ({
        filename
      } = new FileSpec(data).serializable);
    } else {
      return null;
    }
    const contentType = MediaAnnotation._getContentType(assetDict, filename, explicitType, explicitTypeIsName);
    if (!contentType) {
      return null;
    }
    return {
      assetRef: rawData instanceof Ref ? rawData : null,
      assetDict,
      filename,
      contentType
    };
  }
}
class SoundAnnotation extends MediaAnnotation {
  constructor(params) {
    super(params);
    const {
      dict,
      xref,
      annotationGlobals
    } = params;
    const soundRef = dict.getRaw("Sound");
    if (!(soundRef instanceof Ref)) {
      return;
    }
    let sound;
    try {
      sound = xref.fetch(soundRef);
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn(`SoundAnnotation: "${ex}".`);
      return;
    }
    if (!(sound instanceof BaseStream) || !getSoundFormat(sound.dict)) {
      return;
    }
    this._setMediaData({
      assetRef: soundRef,
      assetDict: sound.dict,
      filename: "sound.wav",
      contentType: "audio/wav",
      wrapSound: true
    }, annotationGlobals);
  }
}
export { Annotation, AnnotationBorderStyle, AnnotationFactory, getQuadPoints, MarkupAnnotation, PopupAnnotation, WidgetAnnotation };