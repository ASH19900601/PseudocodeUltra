export type DialectId = "0478" | "2210" | "9618-AS" | "9618-A2";
export interface Source {
  doc: string;
  version: string;
  section: string;
  url: string;
  verified: boolean;
}
export const sources = {
  igcse: {
    doc: "0478 syllabus",
    version: "2026–2028 v6 (September 2026)",
    section: "pp.35–48",
    url: "https://www.cambridgeinternational.org/Images/697167-2026-2028-syllabus.pdf",
    verified: true,
  },
  guide: {
    doc: "9618 Pseudocode Guide",
    version: "2026",
    section: "Pseudocode conventions",
    url: "https://www.cambridgeinternational.org/Images/697401-2026-pseudocode-guide-for-teachers.pdf",
    verified: true,
  },
  insert: {
    doc: "9618 Paper 2 Insert",
    version: "June 2024",
    section: "Built-in functions and operators",
    url: "https://www.cambridgeinternational.org/Images/673618-june-2024-insert-paper-21.pdf",
    verified: true,
  },
} satisfies Record<string, Source>;
export const signatures: Record<string, [number, number]> = {
  LENGTH: [1, 1],
  SUBSTRING: [3, 3],
  UCASE: [1, 1],
  LCASE: [1, 1],
  ROUND: [2, 2],
  RANDOM: [0, 0],
  DIV: [2, 2],
  MOD: [2, 2],
  LEFT: [2, 2],
  RIGHT: [2, 2],
  MID: [3, 3],
  TO_UPPER: [1, 1],
  TO_LOWER: [1, 1],
  NUM_TO_STR: [1, 1],
  STR_TO_NUM: [1, 1],
  IS_NUM: [1, 1],
  ASC: [1, 1],
  CHR: [1, 1],
  INT: [1, 1],
  RAND: [1, 1],
  DAY: [1, 1],
  MONTH: [1, 1],
  YEAR: [1, 1],
  DAYINDEX: [1, 1],
  SETDATE: [3, 3],
  TODAY: [0, 0],
  EOF: [1, 1],
};
const ig = [
  "LENGTH",
  "SUBSTRING",
  "UCASE",
  "LCASE",
  "ROUND",
  "RANDOM",
  "DIV",
  "MOD",
];
const as = [
  "LENGTH",
  "LEFT",
  "RIGHT",
  "MID",
  "UCASE",
  "LCASE",
  "TO_UPPER",
  "TO_LOWER",
  "NUM_TO_STR",
  "STR_TO_NUM",
  "IS_NUM",
  "ASC",
  "CHR",
  "INT",
  "RAND",
  "DAY",
  "MONTH",
  "YEAR",
  "DAYINDEX",
  "SETDATE",
  "TODAY",
  "EOF",
];
export type Strictness = "exam" | "learning" | "lenient";
export interface Profile {
  id: DialectId;
  strictness: Strictness;
  styleChecks: boolean;
  logicalPrecedence: "standard" | "leftToRight";
  version: string;
  indent: number;
  whileDo: boolean;
  parens: boolean;
  paramModes: boolean;
  maxParams: number;
  builtins: string[];
  types: string[];
  advanced: boolean;
  source: Source;
  policies: Record<string, string>;
}
export function profile(
  id: DialectId,
  options: {
    guideVersion?: "2026" | "2027–2029";
    strictness?: Strictness;
    styleChecks?: boolean;
    logicalPrecedence?: "standard" | "leftToRight";
  } = {},
): Profile {
  const basic = id === "0478" || id === "2210";
  return {
    id,
    logicalPrecedence: options.logicalPrecedence || "standard",
    strictness: options.strictness || "exam",
    styleChecks: options.styleChecks ?? false,
    version: basic ? "2026–2028-v6-2026-09" : options.guideVersion || "2026",
    indent: basic ? 4 : 3,
    whileDo: basic,
    parens: !basic,
    paramModes: !basic,
    maxParams: basic ? 3 : Infinity,
    builtins: basic ? ig : as,
    types: [
      "INTEGER",
      "REAL",
      "STRING",
      "CHAR",
      "BOOLEAN",
      ...(basic ? [] : ["DATE"]),
    ],
    advanced: id === "9618-A2",
    source: basic
      ? id === "2210"
        ? {
            ...sources.igcse,
            doc: "2210 syllabus",
            url: "https://www.cambridgeinternational.org/Images/697287-2026-2028-syllabus.pdf",
          }
        : sources.igcse
      : options.guideVersion === "2027–2029"
        ? {
            ...sources.guide,
            version: "2027–2029",
            url: "https://www.cambridgeinternational.org/Images/721401-2027-2029-pseudocode-guide.pdf",
          }
        : sources.guide,
    policies: {
      negativeDIV: "truncate toward zero",
      negativeMOD: "a − trunc(a / b) × b",
      INT: "truncate toward zero",
      ROUND: "ties away from zero",
      FOR: "bounds evaluated once; STEP 0 rejected",
      boolean: "NOT > AND > OR; short circuit",
      realOutput: "compact decimal",
      date: "zero-padded dd/mm/yyyy literal",
      identifier: basic
        ? "case insensitive; underscores forbidden; PascalCase style"
        : "case insensitive; ASCII letters, digits and underscore; letter first",
    },
  };
}
export class DiagnosticError extends Error {
  source?: Source;
  constructor(
    public code: string,
    message: string,
    public line = 1,
    public column = 1,
  ) {
    super(message);
  }
}
export interface Diagnostic {
  code: string;
  message: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  source: Source;
  from?: number;
  to?: number;
  actions?: {
    name: string;
    edits: { from: number; to: number; insert: string }[];
  }[];
}

// Section numbers checked against the mirrored 2026 Guide, not a claim of full conformance.
export function ruleSource(code: string, p: Profile): Source {
  if (
    [
      "STEP_LIMIT",
      "MEMORY_LIMIT",
      "CALL_DEPTH",
      "OVERFLOW",
      "INPUT_MISSING",
    ].includes(code)
  )
    return {
      doc: "Pseudocode Ultra runtime policy",
      version: "0.2",
      section: code,
      url: "",
      verified: false,
    };
  if (p.whileDo) {
    const pages: Record<string, string> = {
      STYLE_CASE: "35",
      STYLE_INDENT: "35",
      STYLE_IDENTIFIER: "36",
      DIALECT_CONSTANT: "37",
      LEX_REAL: "36",
      LEX_STRING: "36",
      LEX_CHAR: "36",
      IDENTIFIER: "36",
      DUPLICATE: "37",
      UNDECLARED: "37",
      CONSTANT: "37",
      TYPE_MISMATCH: "38",
      ARRAY_BOUNDS: "38",
      ARRAY_SHAPE: "38",
      FOR_TYPE: "44",
      FOR_STEP: "44",
      CALL_KIND: "46–47",
      CALL_FUNCTION: "47",
      MISSING_RETURN: "47",
      RETURN: "47",
      FILE_MODE: "48",
      FILE_OPEN: "48",
      FILE_EOF: "48",
      PARAM_LIMIT: "28",
      MODULE_POSITION: "46",
    };
    return {
      ...p.source,
      section: pages[code] ? "p." + pages[code] : p.source.section,
    };
  }

  if (code.startsWith("BUILTIN") || code === "ARITY") return sources.insert;
  const sections: Record<string, string> = {
    STYLE_CASE: "1.3",
    STYLE_INDENT: "1.2",
    STYLE_IDENTIFIER: "2.3",
    TYPE_CYCLE: "4.1",
    CONSTRUCTOR: "10.2",
    OVERRIDE: "10.2",
    LVALUE: "2.6",
    CALL_FORM: "8.1 / 8.2",
    ARRAY_INDEX_TYPE: "3.2",
    CONDITION_TYPE: "6 / 7",
    CASE_OVERLAP: "6.2",
    LEX_REAL: "2.2",
    LEX_STRING: "2.2",
    LEX_CHAR: "2.2",
    IDENTIFIER: "2.3",
    DUPLICATE: "2.3",
    UNDECLARED: "2.4",
    UNINITIALIZED: "2.4",
    CONSTANT: "2.5",
    TYPE_MISMATCH: "2.1 / 2.6",
    ARRAY_BOUNDS: "3.2",
    ARRAY_SHAPE: "3.2",
    ARRAY_DIMENSION: "3.1",
    UNKNOWN_TYPE: "4.1",
    NULL_POINTER: "4.2",
    PRIVATE: "10.1",
    CLASS: "10.2",
    SUPER: "10.2",
    FILE_MODE: "9.1",
    FILE_OPEN: "9.1",
    FILE_EOF: "9.1",
    FILE_MISSING: "9.1",
    FILE_POSITION: "9.2",
    FILE_RECORD: "9.2",
    CALL_KIND: "8.1 / 8.2",
    CALL_FUNCTION: "8.2",
    RETURN: "8.2",
    MISSING_RETURN: "8.2",
    FOR_TYPE: "7.1",
    FOR_STEP: "7.1",
    SET: "4.1",
  };
  return sections[code]
    ? { ...p.source, section: "§" + sections[code] }
    : p.source;
}

export function syntaxSource(text: string, p: Profile): Source {
  const token = text
    .trim()
    .toUpperCase()
    .replace(/^(PUBLIC|PRIVATE)\s+/, "")
    .split(/\s/)[0];
  const sections: Record<string, [string, string]> = {
    DECLARE: ["2.4", "37"],
    CONSTANT: ["2.5", "37"],
    IF: ["6.1", "42"],
    THEN: ["6.1", "42"],
    ELSE: ["6.1", "42"],
    ENDIF: ["6.1", "42"],
    CASE: ["6.2", "43"],
    OTHERWISE: ["6.2", "43"],
    ENDCASE: ["6.2", "43"],
    FOR: ["7.1", "44"],
    NEXT: ["7.1", "44"],
    WHILE: ["7.3", "45"],
    ENDWHILE: ["7.3", "45"],
    REPEAT: ["7.2", "45"],
    UNTIL: ["7.2", "45"],
    PROCEDURE: ["8.1", "46"],
    ENDPROCEDURE: ["8.1", "46"],
    CALL: ["8.1", "46"],
    FUNCTION: ["8.2", "47"],
    ENDFUNCTION: ["8.2", "47"],
    RETURN: ["8.2", "47"],
    INPUT: ["5.1", "39"],
    OUTPUT: ["5.1", "39"],
    TYPE: ["4.1", "36"],
    ENDTYPE: ["4.1", "36"],
    DEFINE: ["4.1", "36"],
    CLASS: ["10.1 / 10.2", "36"],
    ENDCLASS: ["10.1 / 10.2", "36"],
    OPENFILE: ["9.1", "48"],
    CLOSEFILE: ["9.1", "48"],
    READFILE: ["9.1", "48"],
    WRITEFILE: ["9.1", "48"],
    SEEK: ["9.2", "48"],
    GETRECORD: ["9.2", "48"],
    PUTRECORD: ["9.2", "48"],
  };
  const section = sections[token] || ["2.6", "38"];
  return {
    ...p.source,
    section: p.whileDo ? "p." + section[1] : "§" + section[0],
  };
}
