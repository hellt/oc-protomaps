/// <reference types="vite/client" />

declare module '*.css';
declare module '@xyflow/react/dist/style.css';

declare module 'pdfkit/js/pdfkit.standalone.js' {
  const PDFDocument: unknown;
  export default PDFDocument;
}
