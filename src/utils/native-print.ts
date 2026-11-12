// Has to be imported before pdf.js: its print service replaces window.print as soon as it loads.
export const nativePrint = window.print.bind(window);
