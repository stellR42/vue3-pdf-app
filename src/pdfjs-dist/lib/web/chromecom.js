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
import { AppOptions } from "./app_options.js";
import { BaseExternalServices } from "./external_services.js";
import { BasePreferences } from "./preferences.js";
import { DownloadManager as GenericDownloadManager } from "./download_manager.js";
import { GenericL10n } from "./genericl10n.js";
import { GenericScripting } from "./generic_scripting.js";
import { SignatureStorage } from "./generic_signature_storage.js";
import i18nFileAccessLabels from "./chrome-i18n-allow-access-to-file-urls.json" with { type: "json" };
{
  throw new Error('Module "pdfjs-web/chromecom" shall not be used outside CHROME build.');
}
(function rewriteUrlClosure() {
  const queryString = document.location.search.slice(1);
  const m = /(?:^|&)file=([^&]*)/.exec(queryString);
  let defaultUrl = m ? decodeURIComponent(m[1]) : "";
  if (!defaultUrl && queryString.startsWith("DNR:")) {
    defaultUrl = queryString.slice(4);
  }
  const humanReadableUrl = "/" + defaultUrl + location.hash;
  history.replaceState(history.state, "", humanReadableUrl);
  AppOptions.set("defaultUrl", defaultUrl);
})();
let viewerApp = {
  initialized: false
};
function initCom(app) {
  viewerApp = app;
  viewerApp.initialBookmark = location.hash.slice(1);
}
const ChromeCom = {
  request(action, data, callback) {
    const message = {
      action,
      data
    };
    if (!chrome.runtime) {
      console.error("chrome.runtime is undefined.");
      callback?.();
    } else if (callback) {
      chrome.runtime.sendMessage(message, callback);
    } else {
      chrome.runtime.sendMessage(message);
    }
  },
  resolvePDFFile(file, callback) {
    file = file.replace(/^drive:/i, "filesystem:" + location.origin + "/external/");
    if (/^https?:/.test(file)) {
      setReferer(file, function () {
        callback(file);
      });
      return;
    }
    if (/^file?:/.test(file)) {
      getEmbedderOrigin(function (origin) {
        if (origin && !/^file:|^chrome-extension:/.test(origin)) {
          viewerApp._documentError(null, {
            message: `Blocked ${origin} from loading ${file}. Refused to load ` + "a local file in a non-local page for security reasons."
          });
          return;
        }
        isAllowedFileSchemeAccess(function (isAllowedAccess) {
          if (isAllowedAccess) {
            callback(file);
          } else {
            requestAccessToLocalFile(file, viewerApp.overlayManager, callback);
          }
        });
      });
      return;
    }
    callback(file);
  }
};
function getEmbedderOrigin(callback) {
  const origin = window === top ? location.origin : location.ancestorOrigins[0];
  if (origin === "null") {
    getParentOrigin(callback);
  } else {
    callback(origin);
  }
}
function getParentOrigin(callback) {
  ChromeCom.request("getParentOrigin", null, callback);
}
function isAllowedFileSchemeAccess(callback) {
  ChromeCom.request("isAllowedFileSchemeAccess", null, callback);
}
function isRuntimeAvailable() {
  try {
    if (chrome.runtime?.getManifest()) {
      return true;
    }
  } catch {}
  return false;
}
function reloadIfRuntimeIsUnavailable() {
  if (!isRuntimeAvailable()) {
    location.reload();
  }
}
let chromeFileAccessOverlayPromise;
function requestAccessToLocalFile(fileUrl, overlayManager, callback) {
  const dialog = document.getElementById("chromeFileAccessDialog");
  if (top !== window) {
    window.addEventListener("focus", reloadIfRuntimeIsUnavailable);
    dialog.addEventListener("close", function () {
      window.removeEventListener("focus", reloadIfRuntimeIsUnavailable);
      reloadIfRuntimeIsUnavailable();
    });
  }
  chromeFileAccessOverlayPromise ||= overlayManager.register(dialog, true);
  chromeFileAccessOverlayPromise.then(function () {
    const iconPath = chrome.runtime.getManifest().icons[48];
    document.getElementById("chrome-pdfjs-logo-bg").style.backgroundImage = "url(" + chrome.runtime.getURL(iconPath) + ")";
    const i18nFileAccessLabel = i18nFileAccessLabels[chrome.i18n.getUILanguage?.()];
    if (i18nFileAccessLabel) {
      document.getElementById("chrome-file-access-label").textContent = i18nFileAccessLabel;
    }
    const link = document.getElementById("chrome-link-to-extensions-page");
    link.href = "chrome://extensions/?id=" + chrome.runtime.id;
    link.onclick = function (e) {
      e.preventDefault();
      ChromeCom.request("openExtensionsPageForFileAccess", {
        newTab: e.ctrlKey || e.metaKey || e.button === 1 || window !== top
      });
    };
    document.getElementById("chrome-url-of-local-file").textContent = fileUrl;
    document.getElementById("chrome-file-fallback").onchange = function () {
      const file = this.files[0];
      if (file) {
        const originalFilename = decodeURIComponent(fileUrl.split("/").pop());
        let originalUrl = fileUrl;
        if (originalFilename !== file.name) {
          const msg = "The selected file does not match the original file." + "\nOriginal: " + originalFilename + "\nSelected: " + file.name + "\nDo you want to open the selected file?";
          if (!confirm(msg)) {
            this.value = "";
            return;
          }
          originalUrl = "file:///fakepath/to/" + encodeURIComponent(file.name);
        }
        callback(URL.createObjectURL(file), file.size, originalUrl);
        overlayManager.close(dialog);
      }
    };
    overlayManager.open(dialog);
  });
}
let dnrRequestId;
let port;
function setReferer(url, callback) {
  dnrRequestId ??= crypto.getRandomValues(new Uint32Array(1))[0] % 0x80000000;
  port ??= chrome.runtime.connect({
    name: "chromecom-referrer"
  });
  port.onDisconnect.addListener(onDisconnect);
  port.onMessage.addListener(onMessage);
  port.postMessage({
    dnrRequestId,
    referer: window.history.state?.chromecomState,
    requestUrl: url
  });
  function onMessage(referer) {
    if (referer) {
      const state = window.history.state || {};
      state.chromecomState = referer;
      window.history.replaceState(state, "");
    }
    onCompleted();
  }
  function onDisconnect() {
    port = null;
    callback();
  }
  function onCompleted() {
    port.onDisconnect.removeListener(onDisconnect);
    port.onMessage.removeListener(onMessage);
    callback();
  }
}
class DownloadManager extends GenericDownloadManager {
  _getOpenDataUrl(blobUrl, filename, dest = null) {
    let url = chrome.runtime.getURL("/content/web/viewer.html") + "?file=" + encodeURIComponent(blobUrl + "#" + filename);
    if (dest) {
      url += `#${escape(dest)}`;
    }
    return url;
  }
}
const storageArea = chrome.storage.sync || chrome.storage.local;
class Preferences extends BasePreferences {
  async _writeToStorage(prefObj) {
    return new Promise(resolve => {
      if (prefObj === this.defaults) {
        const keysToRemove = Object.keys(this.defaults);
        storageArea.remove(keysToRemove, function () {
          resolve();
        });
      } else {
        storageArea.set(prefObj, function () {
          resolve();
        });
      }
    });
  }
  async _readFromStorage(prefObj) {
    return new Promise(resolve => {
      const getPreferences = defaultPrefs => {
        if (chrome.runtime.lastError) {
          defaultPrefs = this.defaults;
        }
        storageArea.get(defaultPrefs, function (readPrefs) {
          resolve({
            prefs: readPrefs
          });
        });
      };
      if (chrome.storage.managed) {
        const defaultManagedPrefs = Object.assign({
          enableHandToolOnLoad: false,
          disableTextLayer: false,
          enhanceTextSelection: false,
          showPreviousViewOnLoad: true,
          disablePageMode: false
        }, this.defaults);
        chrome.storage.managed.get(defaultManagedPrefs, function (items) {
          items ||= defaultManagedPrefs;
          if (items.enableHandToolOnLoad && !items.cursorToolOnLoad) {
            items.cursorToolOnLoad = 1;
          }
          delete items.enableHandToolOnLoad;
          if (items.textLayerMode !== 1 && items.disableTextLayer) {
            items.textLayerMode = 0;
          }
          delete items.disableTextLayer;
          delete items.enhanceTextSelection;
          if (!items.showPreviousViewOnLoad && !items.viewOnLoad) {
            items.viewOnLoad = 1;
          }
          delete items.showPreviousViewOnLoad;
          delete items.disablePageMode;
          getPreferences(items);
        });
      } else {
        getPreferences(this.defaults);
      }
    });
  }
}
class ExternalServices extends BaseExternalServices {
  initPassiveLoading() {
    ChromeCom.resolvePDFFile(AppOptions.get("defaultUrl"), function (url, length, originalUrl) {
      viewerApp.open({
        url,
        length,
        originalUrl
      });
    });
  }
  async createL10n() {
    return new GenericL10n(navigator.language);
  }
  createScripting() {
    return new GenericScripting(AppOptions.get("sandboxBundleSrc"), AppOptions.get("wasmUrl"));
  }
  createSignatureStorage(eventBus, signal) {
    return new SignatureStorage(eventBus, signal);
  }
}
class MLManager {
  isEnabledFor(_name) {
    return false;
  }
  async guess() {
    return null;
  }
}
export { DownloadManager, ExternalServices, initCom, MLManager, Preferences };