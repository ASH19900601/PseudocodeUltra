import { getLocale, type Locale } from "../core/i18n";

// The original catalog remains available to consumers with saved example names.
export const examples = [
  {
    name: "01 · 循环与输入",
    dialect: "0478",
    code: `// 求 1 至 N 的总和\nDECLARE N, I, Total : INTEGER\nOUTPUT "Enter N:"\nINPUT N\nTotal ← 0\nFOR I ← 1 TO N\n    Total ← Total + I\nNEXT I\nOUTPUT "Total = ", Total`,
  },
  {
    name: "02 · 数组与查找",
    dialect: "0478",
    code: `DECLARE Scores : ARRAY[1:5] OF INTEGER\nDECLARE I, Highest : INTEGER\nHighest ← 0\nFOR I ← 1 TO 5\n    Scores[I] ← I * 7\n    IF Scores[I] > Highest THEN\n        Highest ← Scores[I]\n    ENDIF\nNEXT I\nOUTPUT "Highest: ", Highest`,
  },
  {
    name: "03 · 记录、日期与 BYREF",
    dialect: "9618-AS",
    code: `TYPE Student\n   DECLARE Name : STRING\n   DECLARE Birthday : DATE\nENDTYPE\nPROCEDURE Increment(BYREF Score : INTEGER)\n   Score ← Score + 1\nENDPROCEDURE\nDECLARE Learner : Student\nDECLARE Score : INTEGER\nLearner.Name ← "Alex"\nLearner.Birthday ← 09/05/2008\nScore ← 89\nCALL Increment(Score)\nOUTPUT Learner.Name, " · ", YEAR(Learner.Birthday), " · ", Score`,
  },
  {
    name: "04 · 文本文件",
    dialect: "9618-AS",
    code: `OPENFILE "notes.txt" FOR WRITE\nWRITEFILE "notes.txt", "Hello Cambridge"\nCLOSEFILE "notes.txt"\nDECLARE Line : STRING\nOPENFILE "notes.txt" FOR READ\nWHILE NOT EOF("notes.txt")\n   READFILE "notes.txt", Line\n   OUTPUT Line\nENDWHILE\nCLOSEFILE "notes.txt"`,
  },
  {
    name: "05 · 递归",
    dialect: "9618-A2",
    code: `FUNCTION Factorial(N : INTEGER) RETURNS INTEGER\n   IF N = 0 THEN\n      RETURN 1\n   ELSE\n      RETURN N * Factorial(N - 1)\n   ENDIF\nENDFUNCTION\nOUTPUT Factorial(6)`,
  },
  {
    name: "06 · 指针与集合",
    dialect: "9618-A2",
    code: `TYPE IntegerPointer = ^INTEGER\nTYPE NumberSet = SET OF INTEGER\nDECLARE Value : INTEGER\nDECLARE Pointer : IntegerPointer\nValue ← 42\nPointer ← ^Value\nPointer^ ← 99\nDEFINE Numbers(1, 2, 3) : NumberSet\nOUTPUT Value, " · ", Numbers`,
  },
  {
    name: "07 · 类与继承",
    dialect: "9618-A2",
    code: `CLASS Counter\n   PRIVATE Value : INTEGER\n   PUBLIC PROCEDURE NEW(Start : INTEGER)\n      Value ← Start\n   ENDPROCEDURE\n   PUBLIC FUNCTION Get() RETURNS INTEGER\n      RETURN Value\n   ENDFUNCTION\nENDCLASS\nCLASS Child INHERITS Counter\n   PUBLIC PROCEDURE NEW(Start : INTEGER)\n      SUPER.NEW(Start)\n   ENDPROCEDURE\nENDCLASS\nDECLARE Item : Child\nItem ← NEW Child(12)\nOUTPUT Item.Get()`,
  },
];

const englishNames = [
  "01 · Loops and input",
  "02 · Arrays and search",
  "03 · Records, dates and BYREF",
  "04 · Text files",
  "05 · Recursion",
  "06 · Pointers and sets",
  "07 · Classes and inheritance",
];

export function getExamples(locale: Locale = getLocale()) {
  return examples.map((example, index) => ({
    ...example,
    name: locale === "zh-CN" ? example.name : englishNames[index],
    code:
      locale === "zh-CN"
        ? example.code
        : example.code.replace(
            "// 求 1 至 N 的总和",
            "// Sum the numbers from 1 to N",
          ),
  }));
}
