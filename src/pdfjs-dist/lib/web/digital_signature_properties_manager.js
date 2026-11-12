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
import "core-js/modules/es.json.stringify.js";
import "core-js/modules/es.map.get-or-insert.js";
import "core-js/modules/es.map.get-or-insert-computed.js";
import "core-js/modules/es.set.difference.v2.js";
import "core-js/modules/es.set.intersection.v2.js";
import "core-js/modules/es.set.is-disjoint-from.v2.js";
import "core-js/modules/es.set.is-subset-of.v2.js";
import "core-js/modules/es.set.is-superset-of.v2.js";
import "core-js/modules/es.set.symmetric-difference.v2.js";
import "core-js/modules/es.set.union.v2.js";
import { AnnotationEditorType, makeArr, PDFDateString } from "../pdf.js";
const STATUS_ROW_VERIFIED = "pdfjs-digital-signature-properties-status-verified";
const STATUS_ROW_INVALID = "pdfjs-digital-signature-properties-status-invalid";
const STATUS_ROW_UNKNOWN = "pdfjs-digital-signature-properties-status-unknown";
const STATUS_INFO = {
  verified: {
    priority: 0,
    severity: "verified",
    bannerId: "pdfjs-digital-signature-properties-banner-verified",
    statusId: STATUS_ROW_VERIFIED
  },
  unknown: {
    priority: 1,
    severity: "error",
    bannerId: "pdfjs-digital-signature-properties-banner-unknown",
    statusId: STATUS_ROW_UNKNOWN
  },
  untrusted: {
    priority: 2,
    severity: "warn",
    bannerId: "pdfjs-digital-signature-properties-banner-untrusted",
    statusId: STATUS_ROW_VERIFIED
  },
  expired: {
    priority: 3,
    severity: "warn",
    bannerId: "pdfjs-digital-signature-properties-banner-expired",
    statusId: STATUS_ROW_VERIFIED
  },
  revoked: {
    priority: 4,
    severity: "error",
    bannerId: "pdfjs-digital-signature-properties-banner-revoked",
    statusId: STATUS_ROW_VERIFIED
  },
  invalid: {
    priority: 5,
    severity: "error",
    bannerId: "pdfjs-digital-signature-properties-banner-invalid",
    statusId: STATUS_ROW_INVALID
  }
};
const CERT_L10N_IDS = {
  trusted: "pdfjs-digital-signature-properties-certificate-trusted",
  unknown: "pdfjs-digital-signature-properties-certificate-unknown",
  untrusted: "pdfjs-digital-signature-properties-certificate-untrusted",
  expired: "pdfjs-digital-signature-properties-certificate-expired",
  revoked: "pdfjs-digital-signature-properties-certificate-revoked"
};
const CERT_EXPIRED_WITH_DATE_L10N_ID = "pdfjs-digital-signature-properties-certificate-expired-with-date";
function untrustedCertLabel(errorCode, issuerCN) {
  const code = (errorCode || "").toUpperCase();
  const args = issuerCN ? {
    issuer: issuerCN
  } : null;
  if (code.includes("UNKNOWN_ISSUER") && args) {
    return {
      id: "pdfjs-digital-signature-properties-certificate-untrusted-unknown-issuer",
      args
    };
  }
  if (code.includes("SELF_SIGNED") && args) {
    return {
      id: "pdfjs-digital-signature-properties-certificate-untrusted-self-signed",
      args
    };
  }
  if (code.includes("UNTRUSTED_ISSUER") && args) {
    return {
      id: "pdfjs-digital-signature-properties-certificate-untrusted-untrusted-issuer",
      args
    };
  }
  return {
    id: "pdfjs-digital-signature-properties-certificate-untrusted",
    args: null
  };
}
function expirationDateForCert(cert) {
  if (!cert) {
    return null;
  }
  const now = Date.now();
  const entries = Array.isArray(cert.chain) && cert.chain.length ? cert.chain : [cert];
  for (const entry of entries) {
    if (typeof entry?.notAfter !== "string" || !entry.notAfter) {
      continue;
    }
    const date = new Date(entry.notAfter);
    const ts = date.getTime();
    if (Number.isFinite(ts) && ts < now) {
      return date;
    }
  }
  return null;
}
class SignaturePropertiesManager {
  #appConfig;
  #verifier;
  #eventBus;
  #signatures = [];
  #results = new Map();
  #pendingVerify = new Set();
  #isOpen = false;
  #isLoading = false;
  #needsRender = false;
  #pdfDocument = null;
  constructor({
    appConfig,
    verifier,
    eventBus
  }) {
    this.#appConfig = appConfig;
    this.#verifier = verifier;
    this.#eventBus = eventBus;
    const button = appConfig.signaturePropertiesButton;
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("span");
      dot.className = "loadingDot";
      button.append(dot);
    }
    button.addEventListener("click", () => {
      this.#toggle();
    });
  }
  get isOpen() {
    return this.#isOpen;
  }
  close() {
    if (this.#isOpen) {
      this.#close();
    }
  }
  shouldCloseOnClick(target) {
    if (!this.#isOpen) {
      return false;
    }
    return !(this.#appConfig.signaturePropertiesButton.contains(target) || this.#appConfig.signaturePropertiesPanel.contains(target));
  }
  async setDocument(pdfDocument) {
    if (this.#pdfDocument) {
      this.#signatures = [];
      this.#results.clear();
      this.#pendingVerify.clear();
      this.#needsRender = false;
      this.#hideButton();
      this.#close();
      this.#updateButtonState();
    }
    this.#pdfDocument = pdfDocument;
    if (!pdfDocument) {
      return;
    }
    this.#isLoading = true;
    this.#render();
    let signatures;
    try {
      signatures = await pdfDocument.getSignatures();
    } catch (ex) {
      console.warn("getSignatures failed:", ex);
    }
    if (pdfDocument !== this.#pdfDocument) {
      return;
    }
    this.#signatures = signatures || [];
    this.#isLoading = false;
    if (this.#signatures.length === 0) {
      this.#hideButton();
      return;
    }
    this.#showButton();
    for (const sig of this.#signatures) {
      this.#results.set(sig.id, {
        status: "unknown",
        errorCode: null,
        message: null,
        certificate: null,
        documentModifiedAfterSigning: !sig.coversWholeDocument,
        modificationsAfterSignature: sig.modificationsAfterSignature
      });
    }
    this.#render();
    this.#updateButtonState();
    for (const sig of this.#signatures) {
      this.#verify(sig, pdfDocument);
    }
  }
  #showButton() {
    const root = this.#appConfig.signaturePropertiesButton.parentElement;
    if (root) {
      root.hidden = false;
    }
    const sep = this.#appConfig.signaturePropertiesSeparator;
    if (sep) {
      sep.hidden = false;
    }
  }
  #hideButton() {
    const root = this.#appConfig.signaturePropertiesButton.parentElement;
    if (root) {
      root.hidden = true;
    }
    const sep = this.#appConfig.signaturePropertiesSeparator;
    if (sep) {
      sep.hidden = true;
    }
  }
  #toggle() {
    if (this.#isOpen) {
      this.#close();
    } else {
      this.#open();
    }
  }
  #open() {
    this.#isOpen = true;
    this.#eventBus?.dispatch("switchannotationeditormode", {
      source: this,
      mode: AnnotationEditorType.NONE
    });
    this.#eventBus?.dispatch("findbarclose", {
      source: this
    });
    this.#appConfig.signaturePropertiesPanel.classList.remove("hidden");
    this.#appConfig.signaturePropertiesButton.setAttribute("aria-expanded", "true");
    if (this.#needsRender) {
      this.#render();
    }
  }
  #close() {
    this.#isOpen = false;
    this.#appConfig.signaturePropertiesPanel.classList.add("hidden");
    this.#appConfig.signaturePropertiesButton.setAttribute("aria-expanded", "false");
  }
  get #worst() {
    let worst = "verified";
    for (const r of this.#results.values()) {
      if (r?.status && STATUS_INFO[r.status].priority > STATUS_INFO[worst].priority) {
        worst = r.status;
      }
    }
    return worst;
  }
  get #bannerState() {
    if (this.#results.size === 0) {
      return {
        worst: "unknown",
        severity: "error",
        count: 0
      };
    }
    const worst = this.#worst;
    let count = 0;
    for (const r of this.#results.values()) {
      if (r?.status === worst) {
        count++;
      }
    }
    return {
      worst,
      severity: STATUS_INFO[worst].severity,
      count
    };
  }
  #render() {
    if (!this.#isOpen) {
      this.#needsRender = true;
      return;
    }
    this.#needsRender = false;
    const list = this.#appConfig.signaturePropertiesList;
    const banner = this.#appConfig.signaturePropertiesBanner;
    const fragment = document.createDocumentFragment();
    if (this.#isLoading) {
      banner.hidden = true;
      list.replaceChildren();
      return;
    }
    const {
      worst,
      severity,
      count
    } = this.#bannerState;
    banner.replaceChildren();
    banner.hidden = false;
    banner.className = `sigBanner ${severity}`;
    banner.setAttribute("data-l10n-id", STATUS_INFO[worst].bannerId);
    banner.setAttribute("data-l10n-args", JSON.stringify({
      count
    }));
    const byParent = new Map();
    const topLevel = [];
    for (const sig of this.#signatures) {
      if (sig.parentId) {
        byParent.getOrInsertComputed(sig.parentId, makeArr).push(sig);
      } else {
        topLevel.push(sig);
      }
    }
    const everythingFine = severity === "verified";
    for (const sig of topLevel) {
      fragment.append(this.#renderCard(sig, byParent, 0, everythingFine));
    }
    list.replaceChildren(fragment);
  }
  #renderCard(sig, byParent, depth, everythingFine) {
    const subs = byParent.get(sig.id) || [];
    const li = document.createElement("li");
    li.classList.add("sigCard");
    if (depth === 0 && everythingFine) {
      li.classList.add("sigCard--top-allfine");
    }
    const result = this.#results.get(sig.id);
    const subjectCN = result?.certificate?.subjectCN;
    if (subjectCN) {
      const signer = document.createElement("div");
      signer.className = "signer";
      signer.textContent = subjectCN;
      li.append(signer);
    }
    const statusRow = document.createElement("div");
    statusRow.classList.add("row", `status--${result.status}`);
    const statusLabel = document.createElement("span");
    statusLabel.setAttribute("data-l10n-id", STATUS_INFO[result.status].statusId);
    statusRow.append(statusLabel);
    li.append(statusRow);
    if (result.status === "invalid" && result.message) {
      const reason = document.createElement("div");
      reason.className = "detail";
      reason.setAttribute("data-l10n-id", "pdfjs-digital-signature-properties-reason");
      reason.setAttribute("data-l10n-args", JSON.stringify({
        reason: result.message
      }));
      li.append(reason);
    }
    const cert = result.certificate;
    let certKind = "unknown";
    if (cert) {
      switch (result.status) {
        case "verified":
          certKind = "trusted";
          break;
        case "expired":
          certKind = "expired";
          break;
        case "revoked":
          certKind = "revoked";
          break;
        case "untrusted":
          certKind = "untrusted";
          break;
        default:
          certKind = "unknown";
      }
    }
    if (result.status !== "invalid") {
      const certRow = document.createElement("div");
      certRow.classList.add("row", `cert--${certKind}`);
      const certLabel = document.createElement("span");
      let l10nId = CERT_L10N_IDS[certKind];
      let l10nArgs = null;
      if (cert?.issuerCN && certKind === "trusted") {
        l10nArgs = {
          issuer: cert.issuerCN
        };
      } else if (certKind === "expired") {
        const date = expirationDateForCert(cert);
        if (date) {
          l10nId = CERT_EXPIRED_WITH_DATE_L10N_ID;
          l10nArgs = {
            dateObj: date.valueOf()
          };
        }
      } else if (certKind === "untrusted") {
        const label = untrustedCertLabel(result.errorCode, cert?.issuerCN);
        l10nId = label.id;
        l10nArgs = label.args;
      }
      certLabel.setAttribute("data-l10n-id", l10nId);
      if (l10nArgs) {
        certLabel.setAttribute("data-l10n-args", JSON.stringify(l10nArgs));
      }
      certRow.append(certLabel);
      li.append(certRow);
    }
    if (result.status === "untrusted" && result.message) {
      const detail = document.createElement("div");
      detail.className = "detail";
      detail.textContent = result.message;
      li.append(detail);
    }
    if (result.status === "expired" && result.message) {
      const detail = document.createElement("div");
      detail.className = "detail";
      detail.textContent = result.message;
      li.append(detail);
    }
    const signingDate = PDFDateString.toDateObject(sig.signingTime);
    if (signingDate) {
      const ts = document.createElement("div");
      ts.className = "detail";
      ts.setAttribute("data-l10n-id", "pdfjs-digital-signature-properties-timestamp");
      ts.setAttribute("data-l10n-args", JSON.stringify({
        dateObj: signingDate.valueOf()
      }));
      li.append(ts);
    }
    if (cert && typeof this.#verifier?.viewCertificate === "function") {
      const viewCert = document.createElement("button");
      viewCert.className = "viewCert";
      viewCert.type = "button";
      viewCert.setAttribute("data-l10n-id", "pdfjs-digital-signature-properties-view-certificate");
      viewCert.addEventListener("click", e => {
        e.stopPropagation();
        this.#verifier.viewCertificate(cert);
      });
      li.append(viewCert);
    }
    if (subs.length > 0) {
      const subList = document.createElement("ul");
      subList.classList.add("signaturePropertiesList", "nested");
      for (const sub of subs) {
        subList.append(this.#renderCard(sub, byParent, depth + 1, everythingFine));
      }
      if (depth === 0) {
        const details = document.createElement("details");
        details.className = "subSignatures";
        details.open = true;
        const summary = document.createElement("summary");
        summary.setAttribute("data-l10n-id", "pdfjs-digital-signature-properties-sub-signatures");
        summary.setAttribute("data-l10n-args", JSON.stringify({
          count: this.#countDescendants(sig.id, byParent)
        }));
        details.append(summary);
        details.append(subList);
        li.append(details);
      } else {
        li.append(subList);
      }
    }
    return li;
  }
  #countDescendants(id, byParent) {
    const direct = byParent.get(id);
    if (!direct) {
      return 0;
    }
    let total = direct.length;
    for (const sub of direct) {
      total += this.#countDescendants(sub.id, byParent);
    }
    return total;
  }
  async #verify(signature, pdfDocument) {
    if (!this.#verifier || this.#pendingVerify.has(signature.id)) {
      return;
    }
    this.#pendingVerify.add(signature.id);
    this.#render();
    let result;
    try {
      const bytes = await pdfDocument.getSignatureData(signature.id);
      if (pdfDocument !== this.#pdfDocument) {
        return;
      }
      if (!bytes) {
        throw new Error("missing signature data");
      }
      result = await this.#verifier.verify({
        ...signature,
        ...bytes
      });
    } catch (ex) {
      console.warn("signature verify failed:", ex);
      result = {
        status: "unknown",
        errorCode: "BRIDGE_ERROR",
        message: ex?.message ?? null,
        certificate: null,
        documentModifiedAfterSigning: !signature.coversWholeDocument,
        modificationsAfterSignature: signature.modificationsAfterSignature
      };
    }
    this.#pendingVerify.delete(signature.id);
    if (pdfDocument !== this.#pdfDocument) {
      return;
    }
    this.#results.set(signature.id, result);
    this.#render();
    this.#updateButtonState();
  }
  #updateButtonState() {
    const button = this.#appConfig.signaturePropertiesButton;
    button.classList.remove("state-loading", "state-verified", "state-warn", "state-error");
    if (this.#signatures.length === 0) {
      return;
    }
    if (this.#pendingVerify.size > 0) {
      button.classList.add("state-loading");
      return;
    }
    switch (this.#worst) {
      case "invalid":
      case "revoked":
      case "unknown":
        button.classList.add("state-error");
        break;
      case "expired":
      case "untrusted":
        button.classList.add("state-warn");
        break;
      default:
        button.classList.add("state-verified");
    }
  }
}
export { SignaturePropertiesManager };