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
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import "core-js/modules/es.typed-array.with.js";
import "core-js/modules/es.uint8-array.set-from-base64.js";
import "core-js/modules/es.uint8-array.set-from-hex.js";
import "core-js/modules/es.uint8-array.to-base64.js";
import "core-js/modules/es.uint8-array.to-hex.js";
import "core-js/modules/web.url.parse.js";
import { shadow, stripPath, warn } from "../shared/util.js";
import { getRGB } from "./display_utils.js";
import { PageViewport } from "./page_viewport.js";
import { XfaLayer } from "./xfa_layer.js";
async function fetchData(url, type = "text") {
  if (isValidFetchUrl(url, document.baseURI)) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    switch (type) {
      case "blob":
        return response.blob();
      case "bytes":
        return response.bytes();
      case "json":
        return response.json();
    }
    return response.text();
  }
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.responseType = type === "bytes" ? "arraybuffer" : type;
    request.onreadystatechange = () => {
      if (request.readyState !== XMLHttpRequest.DONE) {
        return;
      }
      if (request.status === 200 || request.status === 0) {
        switch (type) {
          case "bytes":
            resolve(new Uint8Array(request.response));
            return;
          case "blob":
          case "json":
            resolve(request.response);
            return;
        }
        resolve(request.responseText);
        return;
      }
      reject(new Error(request.statusText));
    };
    request.send(null);
  });
}
function isDataScheme(url) {
  const ii = url.length;
  let i = 0;
  while (i < ii && url[i].trim() === "") {
    i++;
  }
  return url.substring(i, i + 5).toLowerCase() === "data:";
}
function isPdfFile(filename) {
  return typeof filename === "string" && /\.pdf$/i.test(filename);
}
function getFilenameFromUrl(url) {
  [url] = url.split(/[#?]/, 1);
  return stripPath(url);
}
function getPdfFilenameFromUrl(url, defaultFilename = "document.pdf") {
  if (typeof url !== "string") {
    return defaultFilename;
  }
  if (isDataScheme(url)) {
    warn('getPdfFilenameFromUrl: ignore "data:"-URL for performance reasons.');
    return defaultFilename;
  }
  const getURL = urlString => {
    try {
      return new URL(urlString);
    } catch {}
    try {
      return new URL(decodeURIComponent(urlString));
    } catch {}
    try {
      return new URL(urlString, "https://foo.bar");
    } catch {}
    try {
      return new URL(decodeURIComponent(urlString), "https://foo.bar");
    } catch {}
    return null;
  };
  const newURL = getURL(url);
  if (!newURL) {
    return defaultFilename;
  }
  const decode = name => {
    try {
      let decoded = decodeURIComponent(name);
      if (decoded.includes("/")) {
        decoded = stripPath(decoded);
        if (decoded.length === 4 && pdfRegex.test(decoded)) {
          return name;
        }
      }
      return decoded;
    } catch {
      return name;
    }
  };
  const pdfRegex = /\.pdf$/i;
  const filename = stripPath(newURL.pathname);
  if (pdfRegex.test(filename)) {
    return decode(filename);
  }
  if (newURL.searchParams.size > 0) {
    const getLast = iterator => [...iterator].findLast(v => pdfRegex.test(v));
    const name = getLast(newURL.searchParams.values()) ?? getLast(newURL.searchParams.keys());
    if (name) {
      return decode(name);
    }
  }
  if (newURL.hash) {
    const {
      hash
    } = newURL;
    let extensionStart = -1;
    for (const {
      index
    } of hash.matchAll(/\.pdf\b/gi)) {
      extensionStart = index;
    }
    if (extensionStart > 0) {
      let filenameStart = extensionStart;
      while (filenameStart > 0 && !"/?#=".includes(hash[filenameStart - 1])) {
        filenameStart--;
      }
      if (filenameStart < extensionStart) {
        return decode(hash.slice(filenameStart, extensionStart + 4));
      }
    }
  }
  return defaultFilename;
}
function isValidFetchUrl(url, baseUrl) {
  const res = baseUrl ? URL.parse(url, baseUrl) : URL.parse(url);
  return /https?:/.test(res?.protocol ?? "");
}
function noContextMenu(e) {
  e.preventDefault();
}
function stopEvent(e) {
  e.preventDefault();
  e.stopPropagation();
}
class PDFDateString {
  static #regex;
  static toDateObject(input) {
    if (input instanceof Date) {
      return input;
    }
    if (!input || typeof input !== "string") {
      return null;
    }
    this.#regex ||= new RegExp("^D:" + "(\\d{4})" + "(\\d{2})?" + "(\\d{2})?" + "(\\d{2})?" + "(\\d{2})?" + "(\\d{2})?" + "([Z|+\\-])?" + "(\\d{2})?" + "'?" + "(\\d{2})?" + "'?");
    const matches = this.#regex.exec(input);
    if (!matches) {
      return null;
    }
    const year = parseInt(matches[1], 10);
    let month = parseInt(matches[2], 10);
    month = month >= 1 && month <= 12 ? month - 1 : 0;
    let day = parseInt(matches[3], 10);
    day = day >= 1 && day <= 31 ? day : 1;
    let hour = parseInt(matches[4], 10);
    hour = hour >= 0 && hour <= 23 ? hour : 0;
    let minute = parseInt(matches[5], 10);
    minute = minute >= 0 && minute <= 59 ? minute : 0;
    let second = parseInt(matches[6], 10);
    second = second >= 0 && second <= 59 ? second : 0;
    const universalTimeRelation = matches[7] || "Z";
    let offsetHour = parseInt(matches[8], 10);
    offsetHour = offsetHour >= 0 && offsetHour <= 23 ? offsetHour : 0;
    let offsetMinute = parseInt(matches[9], 10) || 0;
    offsetMinute = offsetMinute >= 0 && offsetMinute <= 59 ? offsetMinute : 0;
    if (universalTimeRelation === "-") {
      hour += offsetHour;
      minute += offsetMinute;
    } else if (universalTimeRelation === "+") {
      hour -= offsetHour;
      minute -= offsetMinute;
    }
    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }
}
function getColorValues(colors) {
  const span = document.createElement("span");
  span.style.visibility = "hidden";
  span.style.colorScheme = "only light";
  document.body.append(span);
  for (const name of colors.keys()) {
    span.style.color = name;
    const computedColor = window.getComputedStyle(span).color;
    colors.set(name, getRGB(computedColor));
  }
  span.remove();
}
function setLayerDimensions(div, viewport, mustFlip = false, mustRotate = true) {
  if (viewport instanceof PageViewport) {
    const {
      pageWidth,
      pageHeight
    } = viewport.rawDims;
    const {
      style
    } = div;
    const widthStr = `round(down, var(--total-scale-factor) * ${pageWidth}px, var(--scale-round-x))`,
      heightStr = `round(down, var(--total-scale-factor) * ${pageHeight}px, var(--scale-round-y))`;
    if (!mustFlip || viewport.rotation % 180 === 0) {
      style.width = widthStr;
      style.height = heightStr;
    } else {
      style.width = heightStr;
      style.height = widthStr;
    }
  }
  if (mustRotate) {
    div.setAttribute("data-main-rotation", viewport.rotation);
  }
}
const SupportedImageMimeTypes = new Set(["image/apng", "image/avif", "image/bmp", "image/gif", "image/jpeg", "image/png", "image/svg+xml", "image/webp", "image/x-icon"]);
class ColorScheme {
  static get isDarkMode() {
    return shadow(this, "isDarkMode", !!window?.matchMedia?.("(prefers-color-scheme: dark)").matches);
  }
}
class CSSConstants {
  static get commentForegroundColor() {
    const element = document.createElement("span");
    element.classList.add("comment", "sidebar");
    const {
      style
    } = element;
    style.width = style.height = "0";
    style.display = "none";
    style.color = "var(--comment-fg-color)";
    document.body.append(element);
    const {
      color
    } = window.getComputedStyle(element);
    element.remove();
    return shadow(this, "commentForegroundColor", getRGB(color));
  }
}
function renderRichText({
  html,
  dir,
  className
}, container) {
  const fragment = document.createDocumentFragment();
  if (typeof html === "string") {
    const p = document.createElement("p");
    p.dir = dir || "auto";
    const lines = html.split(/\r\n?|\n/);
    for (let i = 0, ii = lines.length; i < ii; ++i) {
      const line = lines[i];
      p.append(document.createTextNode(line));
      if (i < ii - 1) {
        p.append(document.createElement("br"));
      }
    }
    fragment.append(p);
  } else {
    XfaLayer.render({
      xfaHtml: html,
      div: fragment,
      intent: "richText"
    });
  }
  fragment.firstElementChild.classList.add("richText", className);
  container.append(fragment);
}
export { ColorScheme, CSSConstants, fetchData, getColorValues, getFilenameFromUrl, getPdfFilenameFromUrl, isDataScheme, isPdfFile, isValidFetchUrl, noContextMenu, PDFDateString, renderRichText, setLayerDimensions, stopEvent, SupportedImageMimeTypes };