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
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import { OutputScale } from "./display_utils.js";
import { stopEvent } from "./dom_utils.js";
function preventDefault(evt) {
  evt.preventDefault();
}
const MIN_TOUCH_SPAN = 1e-4;
function stopTouchEvent(evt) {
  if (evt.cancelable) {
    stopEvent(evt);
    return true;
  }
  evt.stopPropagation();
  return false;
}
class TouchManager {
  #container;
  #isPinching = false;
  #isPinchingStopped = null;
  #isPinchingDisabled;
  #onPinchStart;
  #onPinching;
  #onPinchEnd;
  #onPanning;
  #ownsGesture = false;
  #pointerDownAC = null;
  #signal;
  #touchIds = new Set();
  #touchInfo = null;
  #touchManagerAC;
  #touchMoveAC = null;
  #unconfirmedPinch = 0;
  constructor({
    container,
    isPinchingDisabled = null,
    isPinchingStopped = null,
    onPinchStart = null,
    onPinching = null,
    onPinchEnd = null,
    onPanning = null,
    signal
  }) {
    this.#container = container;
    this.#isPinchingStopped = isPinchingStopped;
    this.#isPinchingDisabled = isPinchingDisabled;
    this.#onPinchStart = onPinchStart;
    this.#onPinching = onPinching;
    this.#onPinchEnd = onPinchEnd;
    this.#onPanning = onPanning;
    this.#touchManagerAC = new AbortController();
    this.#signal = AbortSignal.any([signal, this.#touchManagerAC.signal]);
    container.addEventListener("touchstart", this.#onTouchStart.bind(this), {
      passive: false,
      signal: this.#signal
    });
  }
  get MIN_TOUCH_DISTANCE_TO_PINCH() {
    return 35 / OutputScale.pixelRatio;
  }
  get MIN_TOUCH_DISTANCE_TO_SCALE() {
    return 4 / OutputScale.pixelRatio;
  }
  #onTouchStart(evt) {
    if (this.#isPinchingDisabled?.()) {
      return;
    }
    this.#pruneTouchIds(evt);
    const touchIds = this.#touchIds;
    for (const {
      identifier
    } of evt.changedTouches) {
      touchIds.add(identifier);
    }
    if (touchIds.size === 1) {
      this.#armPointerDown();
      return;
    }
    if (!this.#touchMoveAC) {
      this.#touchMoveAC = new AbortController();
      const signal = AbortSignal.any([this.#signal, this.#touchMoveAC.signal]);
      const container = this.#container;
      const opt = {
        signal,
        capture: false,
        passive: false
      };
      container.addEventListener("touchmove", this.#onTouchMove.bind(this), opt);
      const onTouchEnd = this.#onTouchEnd.bind(this);
      container.addEventListener("touchend", onTouchEnd, opt);
      container.addEventListener("touchcancel", onTouchEnd, opt);
      opt.capture = true;
      container.addEventListener("pointerdown", stopEvent, opt);
      container.addEventListener("pointermove", stopEvent, opt);
      container.addEventListener("pointercancel", preventDefault, opt);
      container.addEventListener("pointerup", preventDefault, opt);
      this.#onPinchStart?.();
    }
    this.#ownsGesture = stopTouchEvent(evt);
    this.#setTouchInfo(evt);
  }
  #armPointerDown() {
    if (this.#pointerDownAC) {
      return;
    }
    const pointerDownAC = this.#pointerDownAC = new AbortController();
    const signal = AbortSignal.any([this.#signal, pointerDownAC.signal]);
    const container = this.#container;
    const opts = {
      capture: true,
      signal,
      passive: false
    };
    const cancelPointerDown = e => {
      if (e.pointerType === "touch") {
        this.#pointerDownAC?.abort();
        this.#pointerDownAC = null;
      }
    };
    container.addEventListener("pointerdown", e => {
      if (e.pointerType === "touch") {
        stopEvent(e);
        cancelPointerDown(e);
      }
    }, opts);
    container.addEventListener("pointerup", cancelPointerDown, opts);
    container.addEventListener("pointercancel", cancelPointerDown, opts);
  }
  #pruneTouchIds(evt) {
    const previous = this.#touchIds;
    if (previous.size === 0) {
      return;
    }
    const touchIds = this.#touchIds = new Set();
    for (const {
      identifier
    } of evt.touches) {
      if (previous.has(identifier)) {
        touchIds.add(identifier);
      }
    }
  }
  #getTrackedTouches(evt) {
    const touchIds = this.#touchIds;
    const touches = [];
    for (const touch of evt.touches) {
      if (touchIds.has(touch.identifier)) {
        touches.push(touch);
      }
    }
    return touches;
  }
  #setTouchInfo(evt) {
    const touches = this.#getTrackedTouches(evt);
    if (touches.length !== 2 || this.#isPinchingStopped?.()) {
      this.#touchInfo = null;
      return;
    }
    const [touch0, touch1] = touches;
    this.#touchInfo = {
      touch0X: touch0.screenX,
      touch0Y: touch0.screenY,
      touch1X: touch1.screenX,
      touch1Y: touch1.screenY,
      panX: (touch0.clientX + touch1.clientX) / 2,
      panY: (touch0.clientY + touch1.clientY) / 2,
      screenPanX: (touch0.screenX + touch1.screenX) / 2,
      screenPanY: (touch0.screenY + touch1.screenY) / 2
    };
  }
  #onTouchMove(evt) {
    if (!this.#touchInfo) {
      return;
    }
    const touches = this.#getTrackedTouches(evt);
    if (touches.length !== 2) {
      return;
    }
    const wasOwned = this.#ownsGesture;
    this.#ownsGesture = stopTouchEvent(evt);
    if (!this.#ownsGesture) {
      return;
    }
    if (!wasOwned) {
      this.#setTouchInfo(evt);
      return;
    }
    const [touch0, touch1] = touches;
    const {
      screenX: screen0X,
      screenY: screen0Y
    } = touch0;
    const {
      screenX: screen1X,
      screenY: screen1Y
    } = touch1;
    const touchInfo = this.#touchInfo;
    const {
      touch0X: pTouch0X,
      touch0Y: pTouch0Y,
      touch1X: pTouch1X,
      touch1Y: pTouch1Y,
      panX: pPanX,
      panY: pPanY
    } = touchInfo;
    const prevGapX = pTouch1X - pTouch0X;
    const prevGapY = pTouch1Y - pTouch0Y;
    const currGapX = screen1X - screen0X;
    const currGapY = screen1Y - screen0Y;
    const panX = (touch0.clientX + touch1.clientX) / 2;
    const panY = (touch0.clientY + touch1.clientY) / 2;
    touchInfo.panX = panX;
    touchInfo.panY = panY;
    const dx = panX - pPanX;
    const dy = panY - pPanY;
    const screenPanX = (screen0X + screen1X) / 2;
    const screenPanY = (screen0Y + screen1Y) / 2;
    const translation = Math.hypot(screenPanX - touchInfo.screenPanX, screenPanY - touchInfo.screenPanY);
    touchInfo.screenPanX = screenPanX;
    touchInfo.screenPanY = screenPanY;
    const distance = Math.hypot(currGapX, currGapY);
    const pDistance = Math.hypot(prevGapX, prevGapY);
    const minDistance = this.#isPinching ? this.MIN_TOUCH_DISTANCE_TO_SCALE : this.MIN_TOUCH_DISTANCE_TO_PINCH + 2 * translation;
    if (distance < MIN_TOUCH_SPAN || pDistance < MIN_TOUCH_SPAN || Math.abs(pDistance - distance) <= minDistance) {
      if (dx || dy) {
        this.#onPanning?.(dx, dy);
      }
      return;
    }
    touchInfo.touch0X = screen0X;
    touchInfo.touch0Y = screen0Y;
    touchInfo.touch1X = screen1X;
    touchInfo.touch1Y = screen1Y;
    const direction = Math.sign(distance - pDistance);
    if (!this.#isPinching) {
      this.#isPinching = true;
      this.#unconfirmedPinch = direction;
      if (dx || dy) {
        this.#onPanning?.(dx, dy);
      }
      return;
    }
    if (this.#unconfirmedPinch) {
      const unconfirmed = this.#unconfirmedPinch;
      this.#unconfirmedPinch = 0;
      if (direction !== unconfirmed && Math.abs(distance - pDistance) <= 2 * translation) {
        this.#isPinching = false;
        if (dx || dy) {
          this.#onPanning?.(dx, dy);
        }
        return;
      }
    }
    this.#onPinching?.([pPanX, pPanY], pDistance, distance, dx, dy);
  }
  #onTouchEnd(evt) {
    this.#pruneTouchIds(evt);
    if (this.#touchIds.size >= 2) {
      this.#setTouchInfo(evt);
      return;
    }
    const wasTracking = !!this.#touchInfo;
    this.#endGesture();
    if (this.#touchIds.size === 1) {
      this.#armPointerDown();
    }
    if (wasTracking) {
      stopTouchEvent(evt);
    }
  }
  #endGesture() {
    this.#touchInfo = null;
    this.#isPinching = false;
    this.#unconfirmedPinch = 0;
    this.#ownsGesture = false;
    if (this.#touchMoveAC) {
      this.#touchMoveAC.abort();
      this.#touchMoveAC = null;
      this.#onPinchEnd?.();
    }
  }
  destroy() {
    this.#endGesture();
    this.#touchIds.clear();
    this.#touchManagerAC?.abort();
    this.#touchManagerAC = null;
    this.#pointerDownAC?.abort();
    this.#pointerDownAC = null;
  }
}
export { TouchManager };