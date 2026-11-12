// Set a button or a whole group to false to hide it. Anything left out stays visible.
export interface ToolbarConfig {
  sidebar?:
    | boolean
    | {
        viewThumbnail?: boolean;
        viewOutline?: boolean;
        viewAttachments?: boolean;
      };
  secondaryToolbar?:
    | boolean
    | {
        secondaryPresentationMode?: boolean;
        secondaryOpenFile?: boolean;
        secondaryPrint?: boolean;
        secondaryDownload?: boolean;
        secondaryViewBookmark?: boolean;
        firstPage?: boolean;
        lastPage?: boolean;
        pageRotateCw?: boolean;
        pageRotateCcw?: boolean;
        cursorSelectTool?: boolean;
        cursorHandTool?: boolean;
        scrollPage?: boolean;
        scrollVertical?: boolean;
        scrollHorizontal?: boolean;
        scrollWrapped?: boolean;
        spreadNone?: boolean;
        spreadOdd?: boolean;
        spreadEven?: boolean;
        documentProperties?: boolean;
      };
  toolbar?:
    | boolean
    | {
        toolbarViewerLeft?:
          | boolean
          | {
              findbar?: boolean;
              previous?: boolean;
              next?: boolean;
              pageNumber?: boolean;
            };
        toolbarViewerRight?:
          | boolean
          | {
              presentationMode?: boolean;
              openFile?: boolean;
              print?: boolean;
              download?: boolean;
              viewBookmark?: boolean;
              editorComment?: boolean;
              editorHighlight?: boolean;
              editorFreeText?: boolean;
              editorInk?: boolean;
              editorStamp?: boolean;
              editorSignature?: boolean;
            };
        toolbarViewerMiddle?:
          | boolean
          | {
              zoomOut?: boolean;
              zoomIn?: boolean;
              scaleSelectContainer?: boolean;
            };
      };
}

export interface PdfViewerProps {
  pdf?: string | ArrayBuffer;
  config?: ToolbarConfig;
  title?: boolean;
  theme?: Theme;
  fileName?: string;
  pageScale?: PageScale;
  pageNumber?: number;
  options?: PdfOptions;
}

// A type rather than an interface, Vue's component types only accept it in this form
export type PdfViewerEmits = {
  'after-created': (app: PdfApp) => void;
  open: (app: PdfApp) => void;
  'pages-rendered': (app: PdfApp) => void;
};

export type Theme = 'dark' | 'light';

export type PageScale =
  number | 'page-actual' | 'page-width' | 'page-height' | 'page-fit' | 'auto';

// The pdf.js AppOptions people reach for most. Anything else from web/app_options.js
// in pdf.js works too, it just isn't typed.
export interface PdfOptions {
  // 0 none, 1 same tab, 2 new tab (the component's default), 3 parent frame, 4 top frame
  externalLinkTarget?: 0 | 1 | 2 | 3 | 4;
  // -1 default, 0 closed, 1 thumbnails, 2 outline, 3 attachments, 4 layers
  sidebarViewOnLoad?: -1 | 0 | 1 | 2 | 3 | 4;
  // -1 default, 0 vertical, 1 horizontal, 2 wrapped, 3 page by page
  scrollModeOnLoad?: -1 | 0 | 1 | 2 | 3;
  // -1 default, 0 none, 1 odd, 2 even
  spreadModeOnLoad?: -1 | 0 | 1 | 2;
  // 0 select, 1 hand, 2 zoom
  cursorToolOnLoad?: 0 | 1 | 2;
  // -1 turns the editing tools off, 0 leaves them on
  annotationEditorMode?: -1 | 0;
  // 0 hide annotations, 1 show them, 2 also allow filling forms, 3 also show stored form values
  annotationMode?: 0 | 1 | 2 | 3;
  // 0 no text layer (no selecting or finding text), 1 on, 2 on unless the PDF forbids copying
  textLayerMode?: 0 | 1 | 2;
  enableSignatureEditor?: boolean;
  enableComment?: boolean;
  enableAutoLinking?: boolean;
  enablePrintAutoRotate?: boolean;
  printResolution?: number;
  maxCanvasPixels?: number;
  disableAutoFetch?: boolean;
  disableRange?: boolean;
  disableStream?: boolean;
  useSystemFonts?: boolean;
  [option: string]: unknown;
}

// pdf.js's PDFViewerApplication (web/app.js in pdf.js). pdf.js has no types for its
// viewer, so only the parts people use most are typed here.
export interface PdfApp {
  pdfDocument: PdfDocument | null;
  pdfViewer: {
    currentPageNumber: number;
    currentScale: number;
    currentScaleValue: string;
    pagesRotation: number;
    [key: string]: any;
  };
  eventBus: {
    on(eventName: string, listener: (event: any) => void): void;
    off(eventName: string, listener: (event: any) => void): void;
    dispatch(eventName: string, data?: object): void;
  };
  page: number;
  readonly pagesCount: number;
  zoomIn(): void;
  zoomOut(): void;
  [key: string]: any;
}

// pdf.js's PDFDocumentProxy (src/display/api.js in pdf.js)
export interface PdfDocument {
  numPages: number;
  fingerprints: [string, string | null];
  getMetadata(): Promise<{ info: Record<string, any>; metadata: any }>;
  getOutline(): Promise<any[] | null>;
  getPage(pageNumber: number): Promise<any>;
  getData(): Promise<Uint8Array>;
  [key: string]: any;
}
