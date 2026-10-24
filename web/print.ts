import { normalize, lex } from "../core/lexer";
import { getLocale, localizeMessage } from "../core/i18n";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function printableHTML(source: string, title = "main.pseudo") {
  let balance = 0,
    previousContinuation = false;
  const rows = normalize(source)
    .split("\n")
    .map((line, i) => {
      const continuation = balance > 0 || previousContinuation;
      try {
        for (const t of lex(line))
          if (t.kind === "symbol") {
            if (["(", "["].includes(t.text)) balance++;
            if ([")", "]"].includes(t.text)) balance--;
          }
      } catch {}
      previousContinuation = /[,←+*/&-]\s*$/.test(line);
      return `<tr><td class="number">${continuation || !line.trim() || line.trim().startsWith("//") ? "" : i + 1}</td><td><pre>${escape(line) || " "}</pre></td></tr>`;
    })
    .join("");
  return `<!doctype html><html lang="${getLocale()}"><head><meta charset="UTF-8"><title>${escape(title)}</title><style>@page{size:A4;margin:18mm}body{font-family:"Courier New","Liberation Mono",monospace;font-size:10pt;color:#111}h1{font:12pt system-ui;margin-bottom:18pt}table{border-collapse:collapse;width:100%}td{vertical-align:top;padding:1pt 0}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.number{color:#666;width:30pt;user-select:none}tr{break-inside:avoid}@media screen{body{max-width:210mm;margin:20px auto;padding:25px;border:1px solid #ddd}}</style></head><body><h1>${escape(title)}</h1><table>${rows}</table></body></html>`;
}
export function printSource(source: string, title = "main.pseudo") {
  const popup = window.open("", "_blank");
  if (!popup)
    throw new Error(localizeMessage("请允许打印窗口 / Allow the print window"));
  popup.document.open();
  popup.document.write(printableHTML(source, title));
  popup.document.close();
  popup.focus();
  popup.print();
}
