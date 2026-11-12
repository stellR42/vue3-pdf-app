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
import { stopEvent } from "../pdf.js";
const CSS_CLASS_GRAB = "grab-to-pan-grab";
class GrabToPan {
  #activateAC = null;
  #mouseDownAC = null;
  #scrollAC = null;
  constructor({
    element
  }) {
    this.element = element;
    this.document = element.ownerDocument;
    const overlay = this.overlay = document.createElement("div");
    overlay.className = "grab-to-pan-grabbing";
  }
  activate() {
    if (!this.#activateAC) {
      this.#activateAC = new AbortController();
      this.element.addEventListener("mousedown", this.#onMouseDown.bind(this), {
        capture: true,
        signal: this.#activateAC.signal
      });
      this.element.classList.add(CSS_CLASS_GRAB);
    }
  }
  deactivate() {
    if (this.#activateAC) {
      this.#activateAC.abort();
      this.#activateAC = null;
      this.#endPan();
      this.element.classList.remove(CSS_CLASS_GRAB);
    }
  }
  ignoreTarget(node) {
    return node.matches("a[href], a[href] *, input, textarea, button, button *, select, option");
  }
  #onMouseDown(event) {
    if (event.button !== 0 || this.ignoreTarget(event.target)) {
      return;
    }
    if (event.originalTarget) {
      try {
        event.originalTarget.tagName;
      } catch {
        return;
      }
    }
    this.scrollLeftStart = this.element.scrollLeft;
    this.scrollTopStart = this.element.scrollTop;
    this.clientXStart = event.clientX;
    this.clientYStart = event.clientY;
    this.#mouseDownAC = new AbortController();
    const boundEndPan = this.#endPan.bind(this),
      mouseOpts = {
        capture: true,
        signal: this.#mouseDownAC.signal
      };
    this.document.addEventListener("mousemove", this.#onMouseMove.bind(this), mouseOpts);
    this.document.addEventListener("mouseup", boundEndPan, mouseOpts);
    this.#scrollAC = new AbortController();
    this.element.addEventListener("scroll", boundEndPan, {
      capture: true,
      signal: this.#scrollAC.signal
    });
    stopEvent(event);
    const focusedElement = document.activeElement;
    if (focusedElement && !focusedElement.contains(event.target)) {
      focusedElement.blur();
    }
  }
  #onMouseMove(event) {
    this.#scrollAC?.abort();
    this.#scrollAC = null;
    if (!(event.buttons & 1)) {
      this.#endPan();
      return;
    }
    const xDiff = event.clientX - this.clientXStart;
    const yDiff = event.clientY - this.clientYStart;
    this.element.scrollTo({
      top: this.scrollTopStart - yDiff,
      left: this.scrollLeftStart - xDiff,
      behavior: "instant"
    });
    if (!this.overlay.parentNode) {
      document.body.append(this.overlay);
    }
  }
  #endPan() {
    this.#mouseDownAC?.abort();
    this.#mouseDownAC = null;
    this.#scrollAC?.abort();
    this.#scrollAC = null;
    this.overlay.remove();
  }
}
export { GrabToPan };