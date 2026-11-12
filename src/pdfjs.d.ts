// The vendored pdf.js lib build is plain JS without types
declare module '@/pdfjs-dist/lib/web/app.js' {
  export const PDFViewerApplication: any;
}
declare module '@/pdfjs-dist/lib/web/app_options.js' {
  export const AppOptions: any;
}
declare module '@/pdfjs-dist/lib/pdf.worker.js?worker&inline' {
  const PdfWorker: { new (): Worker };
  export default PdfWorker;
}
declare module '@/pdfjs-dist/viewer-config.js' {
  export function getViewerConfiguration(
    container: HTMLElement,
    getEl: (id: string) => HTMLElement | null,
  ): any;
}
declare module '@/pdfjs-dist/viewer-body.html?raw' {
  const html: string;
  export default html;
}
