import type { Event } from "./runtime";
export interface TraceOptions {
  policy?:
    "all" | "changes" | "modules" | "loops" | "branches" | "left-to-right";
  columns?: string[];
  hideRepeated?: boolean;
}
export interface TraceRow {
  line: number;
  stack: string;
  variables: Record<string, string>;
}
export function traceRows(
  events: Event[],
  options: TraceOptions = {},
): { columns: string[]; rows: TraceRow[] } {
  const points = events.filter((e) => e.kind === "step" || e.kind === "trace");
  const allColumns = [
      ...new Set(points.flatMap((e) => Object.keys(e.variables || {}))),
    ],
    columns = options.columns?.length
      ? options.columns.filter((k) => allColumns.includes(k))
      : allColumns;
  let previous: Record<string, any> = {},
    rows: TraceRow[] = [];
  let pending: TraceRow | undefined,
    lastColumn = -1;
  for (const event of points) {
    const vars = event.variables || {},
      changed = columns.filter((c) => vars[c] !== previous[c]);
    const policy = options.policy || "all",
      phase = event.phase || "before";
    const include =
      policy === "all"
        ? event.kind === "step" || phase === "complete"
        : policy === "changes"
          ? changed.length > 0
          : policy === "modules"
            ? phase === "module-entry" || phase === "module-exit"
            : policy === "loops"
              ? phase === "loop"
              : policy === "branches"
                ? phase === "branch"
                : true;
    if (policy === "left-to-right") {
      for (const c of changed) {
        const column = columns.indexOf(c);
        if (!pending || column <= lastColumn) {
          if (pending) rows.push(pending);
          pending = {
            line: event.line,
            stack: event.stack?.join(" → ") || "",
            variables: { ...vars },
          };
        }
        pending.variables[c] = vars[c];
        lastColumn = column;
      }
    } else if (include) {
      const visible = Object.fromEntries(
        columns.map((c) => [
          c,
          options.hideRepeated && vars[c] === previous[c]
            ? ""
            : String(vars[c] ?? ""),
        ]),
      );
      rows.push({
        line: event.line,
        stack: event.stack?.join(" → ") || "",
        variables: visible,
      });
    }
    previous = { ...vars };
  }
  if (pending) rows.push(pending);
  return { columns, rows };
}
export function gradeTrace(
  rows: TraceRow[],
  columns: string[],
  attempts: Record<string, string>,
) {
  return rows.flatMap((row, i) =>
    columns.map((column) => {
      const expected = String(row.variables[column] ?? ""),
        actual = attempts[i + ":" + column] ?? "";
      return {
        row: i,
        column,
        expected,
        actual,
        correct: actual === expected,
        answered: actual !== "",
      };
    }),
  );
}
const csvCell = (v: any) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
export function csv(rows: TraceRow[], columns: string[], blank = false) {
  return [
    ["Line", "Call stack", ...columns],
    ...rows.map((r) => [
      r.line,
      r.stack,
      ...columns.map((c) => (blank ? "" : r.variables[c])),
    ]),
  ]
    .map((r) => r.map(csvCell).join(","))
    .join("\r\n");
}
const xml = (s: any) =>
  String(s ?? "")
    .replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c]!,
    )
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function zip(entries: Record<string, string>) {
  const encoder = new TextEncoder(),
    chunks: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  const header = (size: number) => new Uint8Array(size);
  for (const [name, text] of Object.entries(entries)) {
    const n = encoder.encode(name),
      data = encoder.encode(text);
    let crc = 0xffffffff;
    for (const b of data) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const h = header(30 + n.length),
      v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, n.length, true);
    h.set(n, 30);
    chunks.push(h, data);
    const c = header(46 + n.length),
      w = new DataView(c.buffer);
    w.setUint32(0, 0x02014b50, true);
    w.setUint16(4, 20, true);
    w.setUint16(6, 20, true);
    w.setUint32(16, crc, true);
    w.setUint32(20, data.length, true);
    w.setUint32(24, data.length, true);
    w.setUint16(28, n.length, true);
    w.setUint32(42, offset, true);
    c.set(n, 46);
    central.push(c);
    offset += h.length + data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0),
    end = header(22),
    v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, central.length, true);
  v.setUint16(10, central.length, true);
  v.setUint32(12, size, true);
  v.setUint32(16, offset, true);
  const result = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const c of [...chunks, ...central, end]) {
    result.set(c, at);
    at += c.length;
  }
  return result;
}
export function xlsx(rows: TraceRow[], columns: string[], blank = false) {
  const values = [
    ["Line", "Call stack", ...columns],
    ...rows.map((r) => [
      String(r.line),
      r.stack,
      ...columns.map((c) => (blank ? "" : (r.variables[c] ?? ""))),
    ]),
  ];
  const name = (i: number) => {
    let s = "";
    for (i++; i; i = Math.floor((i - 1) / 26))
      s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  };
  const sheet =
    '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    values
      .map(
        (r, i) =>
          `<row r="${i + 1}">${r.map((v, j) => `<c r="${name(j)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join("")}</row>`,
      )
      .join("") +
    "</sheetData></worksheet>";
  return zip({
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml":
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Trace table" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": sheet,
  });
}
