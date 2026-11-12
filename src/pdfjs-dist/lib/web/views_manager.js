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
import { docStyle, PresentationModeState, SidebarView, toggleExpandedBtn, toggleSelectedBtn } from "./ui_utils.js";
import { internalOpt } from "./internal_evt.js";
import { Menu } from "./menu.js";
import { Sidebar } from "./sidebar.js";
const SIDEBAR_WIDTH_VAR = "--viewsManager-width";
const SIDEBAR_RESIZING_CLASS = "viewsManagerResizing";
const UI_NOTIFICATION_CLASS = "pdfSidebarNotification";
class ViewsManager extends Sidebar {
  static #l10nDescription = null;
  #hasAnimations = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  constructor({
    elements: {
      outerContainer,
      sidebarContainer,
      toggleButton,
      resizer,
      thumbnailButton,
      outlineButton,
      attachmentsButton,
      layersButton,
      thumbnailsView,
      outlinesView,
      attachmentsView,
      layersView,
      viewsManagerAddFile: {
        button: viewsManagerAddFileButton
      },
      viewsManagerCurrentOutlineButton,
      viewsManagerSelectorButton,
      viewsManagerSelectorOptions,
      viewsManagerHeaderLabel,
      viewsManagerStatus
    },
    eventBus,
    l10n,
    enableMerge = false,
    enableSplitMerge = false,
    globalAbortSignal
  }) {
    super({
      sidebar: sidebarContainer,
      resizer,
      toggleButton
    }, l10n.getDirection() === "ltr", false, globalAbortSignal);
    this.isOpen = false;
    this.active = SidebarView.THUMBS;
    this.isInitialViewSet = false;
    this.isInitialEventDispatched = false;
    this.onToggled = null;
    this.onUpdateThumbnails = null;
    this.outerContainer = outerContainer;
    this.sidebarContainer = sidebarContainer;
    this.toggleButton = toggleButton;
    this.resizer = resizer;
    this.thumbnailButton = thumbnailButton;
    this.outlineButton = outlineButton;
    this.attachmentsButton = attachmentsButton;
    this.layersButton = layersButton;
    this.thumbnailsView = thumbnailsView;
    this.outlinesView = outlinesView;
    this.attachmentsView = attachmentsView;
    this.layersView = layersView;
    this.viewsManagerAddFileButton = viewsManagerAddFileButton;
    this.viewsManagerCurrentOutlineButton = viewsManagerCurrentOutlineButton;
    this.viewsManagerHeaderLabel = viewsManagerHeaderLabel;
    this.viewsManagerStatus = viewsManagerStatus;
    this.eventBus = eventBus;
    if (!enableSplitMerge) {
      viewsManagerStatus.hidden = true;
    }
    this._enableSplitMerge = enableSplitMerge;
    this._enableMerge = enableMerge;
    if (!enableMerge) {
      viewsManagerAddFileButton.hidden = true;
    }
    this.menu = new Menu(viewsManagerSelectorOptions, viewsManagerSelectorButton, [thumbnailButton, outlineButton, attachmentsButton, layersButton]);
    ViewsManager.#l10nDescription ||= Object.freeze({
      pagesTitle: "pdfjs-views-manager-pages-title",
      outlinesTitle: "pdfjs-views-manager-outlines-title1",
      attachmentsTitle: "pdfjs-views-manager-attachments-title",
      layersTitle: "pdfjs-views-manager-layers-title1",
      notificationButton: "pdfjs-toggle-views-manager-notification-button",
      toggleButton: "pdfjs-toggle-views-manager-button1"
    });
    this.#addEventListeners();
  }
  reset() {
    this.isInitialViewSet = false;
    this.isInitialEventDispatched = false;
    this.#hideUINotification(true);
    this.switchView(SidebarView.THUMBS);
    this.outlineButton.disabled = this.attachmentsButton.disabled = this.layersButton.disabled = false;
    this.viewsManagerCurrentOutlineButton.disabled = true;
  }
  get visibleView() {
    return this.isOpen ? this.active : SidebarView.NONE;
  }
  setInitialView(view = SidebarView.NONE) {
    if (this.isInitialViewSet) {
      return;
    }
    this.isInitialViewSet = true;
    if (view === SidebarView.NONE || view === SidebarView.UNKNOWN) {
      this.#dispatchEvent();
      return;
    }
    this.switchView(view, true);
    if (!this.isInitialEventDispatched) {
      this.#dispatchEvent();
    }
  }
  switchView(view, forceOpen = false) {
    const isViewChanged = view !== this.active;
    let forceRendering = false;
    let titleL10nId = null;
    switch (view) {
      case SidebarView.NONE:
        if (this.isOpen) {
          this.close();
        }
        return;
      case SidebarView.THUMBS:
        titleL10nId = "pagesTitle";
        if (this.isOpen && isViewChanged) {
          forceRendering = true;
        }
        break;
      case SidebarView.OUTLINE:
        titleL10nId = "outlinesTitle";
        if (this.outlineButton.disabled) {
          return;
        }
        break;
      case SidebarView.ATTACHMENTS:
        titleL10nId = "attachmentsTitle";
        if (this.attachmentsButton.disabled) {
          return;
        }
        break;
      case SidebarView.LAYERS:
        titleL10nId = "layersTitle";
        if (this.layersButton.disabled) {
          return;
        }
        break;
      default:
        console.error(`PDFSidebar.switchView: "${view}" is not a valid view.`);
        return;
    }
    this.viewsManagerStatus.hidden = !this._enableSplitMerge || view !== SidebarView.THUMBS;
    this.viewsManagerAddFileButton.hidden = !this._enableMerge || view !== SidebarView.THUMBS;
    this.viewsManagerCurrentOutlineButton.hidden = view !== SidebarView.OUTLINE;
    this.viewsManagerHeaderLabel.setAttribute("data-l10n-id", ViewsManager.#l10nDescription[titleL10nId] || "");
    this.active = view;
    toggleSelectedBtn(this.thumbnailButton, view === SidebarView.THUMBS, this.thumbnailsView);
    toggleSelectedBtn(this.outlineButton, view === SidebarView.OUTLINE, this.outlinesView);
    toggleSelectedBtn(this.attachmentsButton, view === SidebarView.ATTACHMENTS, this.attachmentsView);
    toggleSelectedBtn(this.layersButton, view === SidebarView.LAYERS, this.layersView);
    if (forceOpen && !this.isOpen) {
      this.open();
      return;
    }
    if (forceRendering) {
      this.onUpdateThumbnails();
      this.onToggled();
    }
    if (isViewChanged) {
      this.#dispatchEvent();
    }
  }
  open() {
    if (this.isOpen) {
      return;
    }
    this.isOpen = true;
    this.onResizing(this.width);
    this._sidebar.hidden = false;
    toggleExpandedBtn(this.toggleButton, true);
    this.switchView(this.active);
    if (this.#hasAnimations) {
      queueMicrotask(() => {
        this.outerContainer.classList.add("viewsManagerMoving", "viewsManagerOpen");
      });
    } else {
      this.outerContainer.classList.add("viewsManagerOpen");
      this.eventBus.dispatch("resize", {
        source: this
      });
    }
    if (this.active === SidebarView.THUMBS) {
      this.onUpdateThumbnails();
    }
    this.onToggled();
    this.#dispatchEvent();
    this.#hideUINotification();
  }
  close(evt = null) {
    if (!this.isOpen) {
      return;
    }
    this.isOpen = false;
    this._sidebar.hidden = true;
    toggleExpandedBtn(this.toggleButton, false);
    this.outerContainer.classList.add("viewsManagerMoving");
    this.outerContainer.classList.remove("viewsManagerOpen");
    this.onToggled();
    this.#dispatchEvent();
    if (evt?.detail > 0) {
      this.toggleButton.blur();
    }
  }
  toggle(evt = null) {
    super.toggle();
    if (this.isOpen) {
      this.close(evt);
    } else {
      this.open();
    }
  }
  #dispatchEvent() {
    if (this.isInitialViewSet) {
      this.isInitialEventDispatched ||= true;
    }
    this.eventBus.dispatch("sidebarviewchanged", {
      source: this,
      view: this.visibleView
    });
  }
  #showUINotification() {
    this.toggleButton.setAttribute("data-l10n-id", ViewsManager.#l10nDescription.notificationButton);
    if (!this.isOpen) {
      this.toggleButton.classList.add(UI_NOTIFICATION_CLASS);
    }
  }
  #hideUINotification(reset = false) {
    if (this.isOpen || reset) {
      this.toggleButton.classList.remove(UI_NOTIFICATION_CLASS);
    }
    if (reset) {
      this.toggleButton.setAttribute("data-l10n-id", ViewsManager.#l10nDescription.toggleButton);
    }
  }
  #addEventListeners() {
    const {
      eventBus,
      outerContainer
    } = this;
    if (this.#hasAnimations) {
      this.sidebarContainer.addEventListener("transitionend", evt => {
        if (evt.target === this.sidebarContainer) {
          outerContainer.classList.remove("viewsManagerMoving");
          eventBus.dispatch("resize", {
            source: this
          });
        }
      });
    }
    this.viewsManagerHeaderLabel.addEventListener("dblclick", e => {
      if (this.active === SidebarView.OUTLINE) {
        eventBus.dispatch("toggleoutlinetree", {
          source: this
        });
        return;
      }
      if (this.active === SidebarView.LAYERS) {
        eventBus.dispatch("resetlayers", {
          source: this
        });
      }
    });
    this.thumbnailButton.addEventListener("click", () => {
      this.switchView(SidebarView.THUMBS);
    });
    this.outlineButton.addEventListener("click", () => {
      this.switchView(SidebarView.OUTLINE);
    });
    this.attachmentsButton.addEventListener("click", () => {
      this.switchView(SidebarView.ATTACHMENTS);
    });
    this.layersButton.addEventListener("click", () => {
      this.switchView(SidebarView.LAYERS);
    });
    this.viewsManagerCurrentOutlineButton.addEventListener("click", () => {
      eventBus.dispatch("currentoutlineitem", {
        source: this
      });
    });
    const onTreeLoaded = (count, button, view) => {
      button.disabled = !count;
      if (count) {
        this.#showUINotification();
      } else if (this.active === view) {
        this.switchView(SidebarView.THUMBS);
      }
    };
    eventBus.on("outlineloaded", evt => {
      onTreeLoaded(evt.outlineCount, this.outlineButton, SidebarView.OUTLINE);
      evt.currentOutlineItemPromise.then(enabled => {
        if (!this.isInitialViewSet) {
          return;
        }
        this.viewsManagerCurrentOutlineButton.disabled = !enabled;
      });
    }, internalOpt);
    eventBus.on("attachmentsloaded", evt => {
      onTreeLoaded(evt.attachmentsCount, this.attachmentsButton, SidebarView.ATTACHMENTS);
    }, internalOpt);
    eventBus.on("layersloaded", evt => {
      onTreeLoaded(evt.layersCount, this.layersButton, SidebarView.LAYERS);
    }, internalOpt);
    eventBus.on("presentationmodechanged", evt => {
      if (evt.state === PresentationModeState.NORMAL && this.visibleView === SidebarView.THUMBS) {
        this.onUpdateThumbnails();
      }
    }, internalOpt);
  }
  onStartResizing() {
    this.outerContainer.classList.add(SIDEBAR_RESIZING_CLASS);
  }
  onStopResizing() {
    this.eventBus.dispatch("resize", {
      source: this
    });
    this.outerContainer.classList.remove(SIDEBAR_RESIZING_CLASS);
  }
  onResizing(newWidth) {
    docStyle.setProperty(SIDEBAR_WIDTH_VAR, `${newWidth}px`);
  }
}
export { ViewsManager };