import { ToolbarConfig } from '@/types';

export const toolbarConfig: ToolbarConfig = {
  sidebar: {
    viewThumbnail: true,
    viewOutline: true,
    viewAttachments: true,
  },
  secondaryToolbar: {
    secondaryPresentationMode: true,
    secondaryOpenFile: true,
    secondaryPrint: true,
    secondaryDownload: true,
    secondaryViewBookmark: true,
    firstPage: true,
    lastPage: true,
    pageRotateCw: true,
    pageRotateCcw: true,
    cursorSelectTool: true,
    cursorHandTool: true,
    scrollPage: true,
    scrollVertical: true,
    scrollHorizontal: true,
    scrollWrapped: true,
    spreadNone: true,
    spreadOdd: true,
    spreadEven: true,
    documentProperties: true,
  },
  toolbar: {
    toolbarViewerLeft: {
      findbar: true,
      previous: true,
      next: true,
      pageNumber: true,
    },
    toolbarViewerRight: {
      presentationMode: true,
      openFile: true,
      print: true,
      download: true,
      viewBookmark: true,
      editorComment: true,
      editorHighlight: true,
      editorFreeText: true,
      editorInk: true,
      editorStamp: true,
      editorSignature: true,
    },
    toolbarViewerMiddle: {
      zoomOut: true,
      zoomIn: true,
      scaleSelectContainer: true,
    },
  },
};

// Config path -> element ids in the pdf.js 6 viewer. Some buttons moved between
// pdf.js 2 and 6 (presentation mode, open file and bookmark are only in the
// secondary menu now), so the old keys point at wherever the button lives today.
export const toolbarElementIds: Record<string, string[]> = {
  sidebar: ['viewsManagerToggleButton'],
  'sidebar.viewThumbnail': ['thumbnailsViewMenu'],
  'sidebar.viewOutline': ['outlinesViewMenu'],
  'sidebar.viewAttachments': ['attachmentsViewMenu'],
  secondaryToolbar: ['secondaryToolbarToggleButton'],
  'secondaryToolbar.secondaryPresentationMode': ['presentationMode'],
  'secondaryToolbar.secondaryOpenFile': ['secondaryOpenFile'],
  'secondaryToolbar.secondaryPrint': ['secondaryPrint'],
  'secondaryToolbar.secondaryDownload': ['secondaryDownload'],
  'secondaryToolbar.secondaryViewBookmark': ['viewBookmark'],
  'secondaryToolbar.firstPage': ['firstPage'],
  'secondaryToolbar.lastPage': ['lastPage'],
  'secondaryToolbar.pageRotateCw': ['pageRotateCw'],
  'secondaryToolbar.pageRotateCcw': ['pageRotateCcw'],
  'secondaryToolbar.cursorSelectTool': ['cursorSelectTool'],
  'secondaryToolbar.cursorHandTool': ['cursorHandTool'],
  'secondaryToolbar.scrollPage': ['scrollPage'],
  'secondaryToolbar.scrollVertical': ['scrollVertical'],
  'secondaryToolbar.scrollHorizontal': ['scrollHorizontal'],
  'secondaryToolbar.scrollWrapped': ['scrollWrapped'],
  'secondaryToolbar.spreadNone': ['spreadNone'],
  'secondaryToolbar.spreadOdd': ['spreadOdd'],
  'secondaryToolbar.spreadEven': ['spreadEven'],
  'secondaryToolbar.documentProperties': ['documentProperties'],
  toolbar: ['toolbarContainer'],
  'toolbar.toolbarViewerLeft': ['toolbarViewerLeft'],
  'toolbar.toolbarViewerLeft.findbar': ['viewFindButton'],
  'toolbar.toolbarViewerLeft.previous': ['previous'],
  'toolbar.toolbarViewerLeft.next': ['next'],
  'toolbar.toolbarViewerLeft.pageNumber': ['pageNumber', 'numPages'],
  'toolbar.toolbarViewerRight': ['toolbarViewerRight'],
  'toolbar.toolbarViewerRight.presentationMode': ['presentationMode'],
  'toolbar.toolbarViewerRight.openFile': ['secondaryOpenFile'],
  'toolbar.toolbarViewerRight.print': ['printButton'],
  'toolbar.toolbarViewerRight.download': ['downloadButton'],
  'toolbar.toolbarViewerRight.viewBookmark': ['viewBookmark'],
  'toolbar.toolbarViewerRight.editorComment': ['editorCommentButton'],
  'toolbar.toolbarViewerRight.editorHighlight': ['editorHighlightButton'],
  'toolbar.toolbarViewerRight.editorFreeText': ['editorFreeTextButton'],
  'toolbar.toolbarViewerRight.editorInk': ['editorInkButton'],
  'toolbar.toolbarViewerRight.editorStamp': ['editorStampButton'],
  'toolbar.toolbarViewerRight.editorSignature': ['editorSignatureButton'],
  'toolbar.toolbarViewerMiddle': ['toolbarViewerMiddle'],
  'toolbar.toolbarViewerMiddle.zoomOut': ['zoomOutButton'],
  'toolbar.toolbarViewerMiddle.zoomIn': ['zoomInButton'],
  'toolbar.toolbarViewerMiddle.scaleSelectContainer': ['scaleSelectContainer'],
};

// Walks a path like "toolbar.toolbarViewerLeft.previous". Stops early when a group is
// set to true/false, since that setting applies to everything in it.
export const getToolbarConfigValue = (config: ToolbarConfig, path: string) => {
  let value: unknown = config;
  for (const key of path.split('.')) {
    if (typeof value !== 'object' || value === null) break;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
};
