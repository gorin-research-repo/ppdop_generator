const api = globalThis.PDFLib;
if (!api) throw new Error("PDFLib global missing — vendor/pdf-lib.min.js must load first");
export const PDFDocument = api.PDFDocument;
export const StandardFonts = api.StandardFonts;
export const rgb = api.rgb;
export const degrees = api.degrees;
export default api;
