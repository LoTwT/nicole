import { DocumentExports } from "./mygo";

export function chooseDocumentExport(format: "html" | "pdf", title: string) {
  return DocumentExports.pick(format, title);
}
export function saveHTMLExport(token: string, html: string): Promise<string> {
  return DocumentExports.saveHTML(token, html);
}
export function savePDFExport(token: string, html: string): Promise<string> {
  return DocumentExports.savePDF(token, html);
}
export function cancelDocumentExport(token: string): Promise<void> {
  return DocumentExports.cancel(token);
}
export function copyRichDocument(html: string, plainText: string): Promise<void> {
  return DocumentExports.copyRichText(html, plainText);
}
