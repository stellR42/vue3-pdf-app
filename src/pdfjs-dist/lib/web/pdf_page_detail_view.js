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
import { BasePDFPageView } from "./base_pdf_page_view.js";
import { OutputScale } from "../pdf.js";
import { RenderingStates } from "./renderable_view.js";
class PDFPageDetailView extends BasePDFPageView {
  #detailArea = null;
  renderingCancelled = false;
  constructor({
    pageView
  }) {
    super(pageView);
    this.pageView = pageView;
    this.renderingId = "detail" + this.id;
    this.div = pageView.div;
  }
  setPdfPage(pdfPage) {
    this.pageView.setPdfPage(pdfPage);
  }
  get pdfPage() {
    return this.pageView.pdfPage;
  }
  get renderingState() {
    return super.renderingState;
  }
  set renderingState(state) {
    this.renderingCancelled = false;
    super.renderingState = state;
  }
  reset({
    keepCanvas = false
  } = {}) {
    const renderingCancelled = this.renderingCancelled || this.renderingState === RenderingStates.RUNNING || this.renderingState === RenderingStates.PAUSED;
    this.cancelRendering();
    this.renderingState = RenderingStates.INITIAL;
    this.renderingCancelled = renderingCancelled;
    if (!keepCanvas) {
      this._resetCanvas();
    }
  }
  #shouldRenderDifferentArea(visibleArea) {
    if (!this.#detailArea) {
      return true;
    }
    const minDetailX = this.#detailArea.minX;
    const minDetailY = this.#detailArea.minY;
    const maxDetailX = this.#detailArea.width + minDetailX;
    const maxDetailY = this.#detailArea.height + minDetailY;
    if (visibleArea.minX < minDetailX || visibleArea.minY < minDetailY || visibleArea.maxX > maxDetailX || visibleArea.maxY > maxDetailY) {
      return true;
    }
    const {
      width: maxWidth,
      height: maxHeight,
      scale
    } = this.pageView.viewport;
    if (this.#detailArea.scale !== scale) {
      return true;
    }
    const paddingLeftSize = visibleArea.minX - minDetailX;
    const paddingRightSize = maxDetailX - visibleArea.maxX;
    const paddingTopSize = visibleArea.minY - minDetailY;
    const paddingBottomSize = maxDetailY - visibleArea.maxY;
    const MOVEMENT_THRESHOLD = 0.5;
    const ratio = (1 + MOVEMENT_THRESHOLD) / MOVEMENT_THRESHOLD;
    if (minDetailX > 0 && paddingRightSize / paddingLeftSize > ratio || maxDetailX < maxWidth && paddingLeftSize / paddingRightSize > ratio || minDetailY > 0 && paddingBottomSize / paddingTopSize > ratio || maxDetailY < maxHeight && paddingTopSize / paddingBottomSize > ratio) {
      return true;
    }
    return false;
  }
  update({
    visibleArea = null,
    underlyingViewUpdated = false
  } = {}) {
    if (underlyingViewUpdated) {
      this.cancelRendering();
      this.renderingState = RenderingStates.INITIAL;
      return;
    }
    if (!this.#shouldRenderDifferentArea(visibleArea)) {
      return;
    }
    const {
      viewport,
      maxCanvasPixels,
      capCanvasAreaFactor
    } = this.pageView;
    const visibleWidth = visibleArea.maxX - visibleArea.minX;
    const visibleHeight = visibleArea.maxY - visibleArea.minY;
    const visiblePixels = visibleWidth * visibleHeight * OutputScale.pixelRatio ** 2;
    const maxDetailToVisibleLinearRatio = Math.sqrt(OutputScale.capPixels(maxCanvasPixels, capCanvasAreaFactor) / visiblePixels);
    const maxOverflowScale = (maxDetailToVisibleLinearRatio - 1) / 2;
    let overflowScale = Math.min(1, maxOverflowScale);
    if (overflowScale < 0) {
      overflowScale = 0;
    }
    const overflowWidth = visibleWidth * overflowScale;
    const overflowHeight = visibleHeight * overflowScale;
    const minX = Math.max(0, visibleArea.minX - overflowWidth);
    const maxX = Math.min(viewport.width, visibleArea.maxX + overflowWidth);
    const minY = Math.max(0, visibleArea.minY - overflowHeight);
    const maxY = Math.min(viewport.height, visibleArea.maxY + overflowHeight);
    const width = maxX - minX;
    const height = maxY - minY;
    this.#detailArea = {
      minX,
      minY,
      width,
      height,
      scale: viewport.scale
    };
    this.reset({
      keepCanvas: true
    });
  }
  _getRenderingContext(canvas, transform) {
    const baseContext = this.pageView._getRenderingContext(canvas, transform, false);
    const recordedBBoxes = this.pdfPage.recordedBBoxes;
    if (!recordedBBoxes || !this.enableOptimizedPartialRendering) {
      return baseContext;
    }
    const {
      viewport: {
        width: vWidth,
        height: vHeight
      }
    } = this.pageView;
    const {
      width: aWidth,
      height: aHeight,
      minX: aMinX,
      minY: aMinY
    } = this.#detailArea;
    const detailMinX = aMinX / vWidth;
    const detailMinY = aMinY / vHeight;
    const detailMaxX = (aMinX + aWidth) / vWidth;
    const detailMaxY = (aMinY + aHeight) / vHeight;
    return {
      ...baseContext,
      operationsFilter(index) {
        if (recordedBBoxes.isEmpty(index)) {
          return false;
        }
        return recordedBBoxes.minX(index) <= detailMaxX && recordedBBoxes.maxX(index) >= detailMinX && recordedBBoxes.minY(index) <= detailMaxY && recordedBBoxes.maxY(index) >= detailMinY;
      }
    };
  }
  async draw() {
    if (this.pageView.detailView !== this) {
      return undefined;
    }
    const hideUntilComplete = this.pageView.renderingState === RenderingStates.FINISHED || this.renderingState === RenderingStates.FINISHED;
    if (this.renderingState !== RenderingStates.INITIAL) {
      console.error("Must be in new state before drawing");
      this.reset();
    }
    const {
      div,
      pdfPage,
      viewport
    } = this.pageView;
    if (!pdfPage) {
      this.renderingState = RenderingStates.FINISHED;
      throw new Error("pdfPage is not loaded");
    }
    this.renderingState = RenderingStates.RUNNING;
    const canvasWrapper = this.pageView._ensureCanvasWrapper();
    const {
      canvas,
      prevCanvas
    } = this._createCanvas(newCanvas => {
      if (canvasWrapper.firstElementChild?.tagName === "CANVAS") {
        canvasWrapper.firstElementChild.after(newCanvas);
      } else {
        canvasWrapper.prepend(newCanvas);
      }
    }, hideUntilComplete);
    canvas.ariaHidden = true;
    if (this.enableOptimizedPartialRendering) {
      canvas.className = "detailView";
    }
    const {
      width,
      height
    } = viewport;
    const area = this.#detailArea;
    const {
      pixelRatio
    } = OutputScale;
    const transform = [pixelRatio, 0, 0, pixelRatio, -area.minX * pixelRatio, -area.minY * pixelRatio];
    canvas.width = area.width * pixelRatio;
    canvas.height = area.height * pixelRatio;
    const {
      style
    } = canvas;
    style.width = `${area.width * 100 / width}%`;
    style.height = `${area.height * 100 / height}%`;
    style.top = `${area.minY * 100 / height}%`;
    style.left = `${area.minX * 100 / width}%`;
    const renderingPromise = this._drawCanvas(this._getRenderingContext(canvas, transform), () => {
      this._resetCanvas();
      this.canvas = prevCanvas;
    }, () => {
      this.pageView._refreshAnnotationLayer();
      this.dispatchPageRendered(false, true);
    });
    div.setAttribute("data-loaded", true);
    this.dispatchPageRender();
    return renderingPromise;
  }
}
export { PDFPageDetailView };