# CAIE 伪代码 IDE（IGCSE/O-Level · AS · A2）完整技术方案

**先说明：** 这次研究工具只返回了原始资料（官方 Pseudocode Guide 全文、9618 Insert 原文、0478 考纲更新说明、Pseudocode Pro 的功能页等），没有返回三个模型各自的结论。所以我没法写"哪个模型同意/反对什么"的对比表，编造出来会误导你。下面的方案直接基于这些一手资料。标"⚠️待核对"的地方，是资料没有覆盖或者官方本身没写清楚的。

**最重要的三个结论：**
1. **"考哪一版语法"必须做成可配置的数据，不能写死在代码里。** 例如 0478 考纲 2025–2026 年改了 4 次（运算符名称、参数个数、ROUND 说明）。 [cambridgeinternational](https://www.cambridgeinternational.org/Images/711263-2026-2028-syllabus-update.pdf)
2. **规范来源有三层，优先级要分清：** 考试 Insert > Pseudocode Guide > 考纲。Insert 里的函数和规则比 Guide 多出一大截。 [pastpapers.papacambridge](https://pastpapers.papacambridge.com/directories/CAIE/CAIE-pastpapers/upload/9618_s24_qp_22.pdf)
3. **对 Pseudocode Pro，靠功能数量很难拼过它。** 更好的切入点是"严格符合考试规范 + 报错直接指向 Guide 条款"，这正是它比较弱的地方。

***

## 一、规范来源与版本

| 层级 | 文档 | 作用 |
|---|---|---|
| L1 | 9618 Paper 2 Insert（每次考试都发） | 最权威的函数列表、运算符语义、类型规则 [cambridgeinternational](https://www.cambridgeinternational.org/Images/673618-june-2024-insert-paper-21.pdf) |
| L2 | 9618 Pseudocode Guide 2026 版 / 2027–29 版 | 语法结构与排版规范 [github](https://github.com/Steven-Gzc/pseudocie/blob/main/697401-2026-pseudocode-guide-for-teachers.pdf) |
| L3 | 0478/2210 考纲中的 Pseudocode 章节（2026–28，当前为 v6，2026 年 9 月发布） | IGCSE 语法唯一来源 [cambridgeinternational](https://www.cambridgeinternational.org/Images/711263-2026-2028-syllabus-update.pdf) |
| L4 | 历年真题、Mark Scheme | 用来判断"考官实际接受什么写法" |

几个关键的版本事实：
- **9618：** 2026 版到 2027–29 版语法和函数没有变化，只修正了 Cat 类的 `Breed` 类型（INTEGER 改成 STRING）。 [cswithzak](https://cswithzak.com/pseudocode)
- **0478 各版本改动：**
  - v3：运算符名称更新
  - v4（2025 年 6 月）：运算符名称更新、函数/过程参数个数更新（最多 3 个）
  - v6（2026 年 9 月）：ROUND 的说明更新 [cambridgeinternational](https://www.cambridgeinternational.org/Images/711263-2026-2028-syllabus-update.pdf)
- **2210：** 2029–2031 版 O-Level 只考 Python，所以 2210 伪代码模式在 2028 年 11 月之后失效。 [cswithzak](https://cswithzak.com/pseudocode)

**设计要求：** 每条规则都附上来源条目（文档、版本、页码或节号），例如 `rule.source = {doc:"9618-guide", ver:"2026", sec:"2.5"}`。报错时可以直接告诉学生"违反 Guide §2.5"。

***

## 二、三种方言的语法差异（这是核心）

### 2.1 IGCSE/O-Level（0478/2210）与 9618 的差异

| 项目 | IGCSE 0478/2210 | 9618 AS/A Level |
|---|---|---|
| 缩进 | 4 空格；THEN/ELSE 和 CASE 分支缩进 2 格；续行缩进 2 格 [studylib](https://studylib.net/doc/28141612/0478-pseudocode-guide-y26-28) | 通常 3 空格；THEN/ELSE 可以只缩进 2 格 [github](https://github.com/Steven-Gzc/pseudocie/blob/main/697401-2026-pseudocode-guide-for-teachers.pdf) |
| 标识符字符 | 只允许字母和数字 [studylib](https://studylib.net/doc/28141612/0478-pseudocode-guide-y26-28)（⚠️待核对是否禁止下划线） | 字母、数字、下划线，必须字母开头，不能用带重音的字母 [github](https://github.com/Steven-Gzc/pseudocie/blob/main/697401-2026-pseudocode-guide-for-teachers.pdf) |
| 大小写 | 标识符不区分大小写（Countdown 和 CountDown 视为重名） | 同左 |
| 数据类型 | INTEGER, REAL, CHAR, STRING, BOOLEAN | 另有 DATE |
| WHILE | `WHILE <cond> DO … ENDWHILE` | `WHILE <cond> … ENDWHILE`（没有 DO） [cswithzak](https://cswithzak.com/pseudocode) |
| 无参过程 | `PROCEDURE Name` 不带括号，调用写 `CALL Name` [studylib](https://studylib.net/doc/28141612/0478-pseudocode-guide-y26-28) | `PROCEDURE Name()`，调用写 `CALL Name()` |
| 参数 | 最多 3 个（v4）；没有 BYREF/BYVAL [cswithzak](https://cswithzak.com/pseudocode) | BYVAL/BYREF；同一种传递方式不必重复写关键字；函数不能用 BYREF [github](https://github.com/Steven-Gzc/pseudocie/blob/main/697401-2026-pseudocode-guide-for-teachers.pdf) |
| 过程/函数位置 | 定义在代码开头 [studylib](https://studylib.net/doc/28141612/0478-pseudocode-guide-y26-28) | 没有强制要求 |
| 幂运算 | `^`（raised to the power of） [cswithzak](https://cswithzak.com/pseudocode) | Guide 里没有 `^` 运算；`^` 在 9618 里只用于指针 |
| DIV/MOD | 考纲写成函数形式 `DIV(10,3)`，中缀写法也常见 [cswithzak](https://cswithzak.com/pseudocode) | 中缀 `10 DIV 3`（Insert 原文） [cambridgeinternational](https://www.cambridgeinternational.org/Images/673618-june-2024-insert-paper-21.pdf) |
| 字符串函数 | LENGTH, SUBSTRING, UCASE/LCASE（作用于字符串） [scribd](https://www.scribd.com/document/871587132/Paper-2-Pseudocode) | Guide：RIGHT, LENGTH, MID, LCASE/UCASE（只作用于 CHAR）；Insert 另加一批（见 2.2） |
| 数值函数 | ROUND(x, places), RANDOM()（返回 0 到 1，含两端） [scribd](https://www.scribd.com/document/871587132/Paper-2-Pseudocode) | INT, RAND(x)（返回 0 到 x，不含 x） |
| 文件 | 文本文件 READ/WRITE（⚠️待核对 APPEND） | 文本文件 READ/WRITE/APPEND，另有 RANDOM 随机文件 |
| 自定义类型和 OOP | 没有 | 9618 有 |

### 2.2 9618 Insert 新增的规则（必须严格实现） [cambridgeinternational](https://www.cambridgeinternational.org/Images/673618-june-2024-insert-paper-21.pdf)

**类型规则：**
- 长度为 1 的 STRING 可以当作 CHAR，也可以当作 STRING。
- CHAR 可以赋给 STRING，也可以和 STRING 拼接。
- 长度大于 1 的 STRING 不能赋给 CHAR。

**函数：**
- 字符串：LEFT, RIGHT, MID, LENGTH, TO_UPPER/TO_LOWER（CHAR 或 STRING 均可，返回同类型）, NUM_TO_STR, STR_TO_NUM, IS_NUM, ASC, CHR
- 数值：INT, RAND
- 日期：DAY, MONTH, YEAR, DAYINDEX（星期日 = 1）, SETDATE, TODAY
- 文件：EOF（文件未以 READ 模式打开时报错）

**运算符：**
- 比较运算符：REAL 和 INTEGER 可以互相比较；CHAR 和 STRING 可以互相比较；**比较区分大小写**；**两个记录不能比较**。
- 函数调用格式错误、参数类型错误、参数值错误，都必须报错。

### 2.3 AS 与 A2 的划分（根据 9618 考纲结构，⚠️建议逐条对照考纲核对）

- **AS（Paper 2）：** 基础语句、一维/二维数组、记录（TYPE…ENDTYPE）、文本文件、过程/函数、BYREF/BYVAL、Insert 全部函数。
- **A2（Paper 3/4 相关）：** 在 AS 基础上增加：
  - 枚举、指针、集合（SET OF / DEFINE）
  - 随机文件（SEEK/GETRECORD/PUTRECORD）
  - OOP（CLASS/INHERITS/SUPER/NEW/PUBLIC/PRIVATE）
  - 递归
  - 异常处理：Guide 里没有对应语法，因为它在编程语言里考。可以把 `TRY…EXCEPT…ENDTRY` 作为"扩展、非考试语法"开关，默认关闭。 [cswithzak](https://cswithzak.com/pseudocode)

### 2.4 官方文本中的缺陷和模糊点（处理好这些就能体现专业度）

1. **Guide 示例本身有疏漏：**
   - SWAP 示例里 Temp 没有声明。
   - `Pupil1.Firstname` 和 `FirstName` 大小写不一致。
   - `CLOSEFILE "StudentFile.dat"` 和打开时的 `.Dat` 不一致。 [github](https://github.com/Steven-Gzc/pseudocie/blob/main/697401-2026-pseudocode-guide-for-teachers.pdf)
   - 处理建议：标识符按不区分大小写处理；文件名是否区分大小写做成可配置项；"未声明变量"在 9618 默认给警告，严格模式下给错误。
2. **复制 PDF 时的字符污染：** 字符引号在 PDF 里是 `ꞌ`（U+A78C），减号是 `–`（U+2013）或 `−`（U+2212）。粘贴时要自动规范化，并提示学生"考试中这就是普通引号/减号"。 [github](https://github.com/Steven-Gzc/pseudocie/blob/main/697401-2026-pseudocode-guide-for-teachers.pdf)
3. **日期字面量和除法冲突：** `02/01/2005` 在词法上和 `2 / 1 / 2005` 完全一样。需要根据上下文消歧：赋值目标或参数类型是 DATE 时才解析成日期，或者只在严格匹配 `dd/mm/yyyy` 格式且前导零齐全时识别。这一点必须写测试覆盖。
4. **REAL 字面量：** 小数点两侧都必须有数字（`0.3`、`4.0`）。`.5` 和 `5.` 应报错。
5. **CONSTANT 的值只能是字面量**，不能是变量、其他常量或表达式。 [github](https://github.com/Steven-Gzc/pseudocie/blob/main/697401-2026-pseudocode-guide-for-teachers.pdf)
6. **数组整体赋值：** 同大小、同类型的数组可以整体赋值，但 `StudentNames[1 TO 30] ← ""` 是禁止写法。
7. **官方没定义的语义**（统一放进"模糊语义策略表"，做成可配置，默认选最符合 Mark Scheme 的方案并在界面上标明）：
   - DIV/MOD 遇到负数时的结果
   - INT 对负数如何取整（"integer part" 字面意思是向零截断）
   - FOR 循环的边界是否只在开始时求值一次；STEP 为 0 怎么处理
   - REAL 的输出格式（4.0 显示成 `4` 还是 `4.0`）
   - BOOLEAN 的输出格式
   - AND/OR/NOT 的优先级（Guide 只建议加括号）
   - ROUND 遇到 .5 时如何舍入（IGCSE v6 刚改过说明） [cswithzak](https://cswithzak.com/pseudocode)
8. **CASE 语句：** 分支按顺序测试，命中第一个就结束；OTHERWISE 必须放在最后；支持 `a TO b` 范围；**没有 ELSEIF**，只能嵌套 IF。

***

## 三、竞品 Pseudocode Pro 拆解

**它的工作方式：** 先分词、再解析、然后转译成 JavaScript，在浏览器本地执行。默认运行 5 秒超时，可以调整。 [pseudocode](https://www.pseudocode.pro/)

**功能清单（需要对标）**： [pseudocode](https://www.pseudocode.pro/0478)
- 编辑：语法高亮、自动补全、函数签名提示、代码片段（snippets）、模板、美化格式（pretty-print）、快捷键、主题
- 执行：报错显示位置；三种执行模式（输入即运行 / 编辑器失焦时运行 / 点击运行）
- 调试：自动生成 trace table，导出 CSV；`BREAKPOINT` 和 `TRACE_NEXT_ROW` 关键字；换行规则可配置（进入模块、每次循环、IF 分支、"从左到右"规则）
- 可视化：Token 查看器、AST 查看器、流程图
- 转换：伪代码转 Python / Java / VB
- 文件：虚拟文件管理器，支持拖放上传
- 学习内容：真题起始代码和答案、500 道挑战题、作业布置、月赛、教程、聊天室
- 版本：pragmas 切换语法版本
- 商业：许可证每年 $2，支持批量授权

**它可以利用的弱点（都来自它自己的说明）**： [pseudocode](https://pseudocode.pro/editor)
1. Token 用一系列正则规则生成，不是严格的词法分析。
2. Trace table 对记录、类、集合"目前有 bug"。
3. 默认会自动格式化，可能重排代码（比如把声明移到开头），破坏学生原本的结构。
4. 输出默认缓冲到 INPUT 或程序结束才显示；实时输出会非常慢。这是"转译成 JS 同步执行"带来的结构性限制。
5. 宽松选项（数组一次性多值赋值、对数组用 LENGTH）和非考纲扩展（声音、Canvas、TRY CATCH），会让学生养成考试里拿不到分的写法。
6. 用户可以关闭类型检查。

**差异化定位：** 做成"考官视角的严格 IDE"。
- 一键切换 0478 / 2210 / 9618-AS / 9618-A2 四种方言。
- 每条报错都附带 Guide/Insert 条款号、正确写法示例和中英双语解释。
- 可以单步执行、真正暂停的调试器。
- 支持复杂类型的 trace table。
- 考试模式：只显示当场 Insert 提供的函数，关闭自动补全。

***

## 四、系统架构

```
monorepo (TypeScript)
├─ core/
│  ├─ dialects/         # 方言配置(JSON/TS)：关键字、函数签名、规则开关、来源
│  ├─ lexer/            # 手写词法分析器，配合方言表；Unicode 规范化
│  ├─ parser/           # 递归下降 + Pratt 表达式解析；带错误恢复
│  ├─ ast/              # 带完整位置信息的 AST
│  ├─ semantic/         # 符号表/作用域/类型检查/常量规则/风格检查
│  ├─ interpreter/      # 基于 generator 的树遍历解释器，可单步/暂停
│  ├─ runtime/          # 内置函数、虚拟文件系统、DATE、随机数种子
│  ├─ formatter/        # 按方言缩进规则格式化，绝不重排语句
│  └─ transpilers/      # 转 Python / Java / VB.NET
├─ lsp/                 # 在 Web Worker 中运行：诊断、补全、悬停、跳转、重命名
├─ web/                 # 编辑器(CodeMirror 6 或 Monaco) + UI
├─ desktop/             # Tauri 封装，离线使用
└─ conformance/         # 一致性测试语料
```

### 4.1 方言配置（关键设计）

```ts
interface DialectProfile {
  id: "0478" | "2210" | "9618-AS" | "9618-A2";
  version: string;                 // 如 "0478-v6-2026-09"
  indent: { block: 4|3; thenElse: 2; caseItem?: 2; continuation: 2 };
  identifier: { allowUnderscore: boolean; caseInsensitive: true };
  types: string[];                 // 是否包含 DATE 等
  whileRequiresDo: boolean;
  procParensOptional: boolean;
  maxParams?: number;              // 0478 v4 起为 3
  paramModes: boolean;             // BYREF/BYVAL
  divModForm: ("infix"|"call")[];
  powerOperator: boolean;
  builtins: BuiltinSig[];          // 每个函数都带来源字段
  features: { records, enums, pointers, sets, oop, randomFiles, append, exceptions };
  ambiguityPolicy: { divNegative, intNegative, realOutput, roundHalf, ... };
  strictness: "exam" | "learning" | "lenient";
}
```

### 4.2 词法与语法分析要点

- **赋值符：** 支持 `←` 和 `<-`，输入 `<-` 时可自动替换成 `←`。
- **关键字匹配：** 区分大小写。考试规范要求关键字大写；小写关键字给警告，并可一键修正。
- **字面量：** 识别 `'c'`、`"str"`、REAL（两侧必须有数字）、DATE（见 2.4 第 3 点）。
- **注释：** `//` 到行尾，不支持块注释。
- **错误恢复：** 在 `ENDIF/ENDWHILE/NEXT/UNTIL/ENDCASE/ENDPROCEDURE/ENDFUNCTION/ENDTYPE/ENDCLASS` 等同步点恢复，一次报出多个错误。
- **块匹配诊断：** 例如"第 12 行的 IF 缺少 ENDIF"，或者"NEXT j 和 FOR i 不匹配"。

### 4.3 语义检查清单（按方言启用）

- 未声明变量；重复声明（不区分大小写）；把关键字当标识符。
- 类型检查：
  - INTEGER 可以赋给 REAL，反过来需要报错。
  - CHAR 和 STRING 之间按 Insert 规则处理。
  - `/` 的结果一律是 REAL。
  - 条件表达式必须是 BOOLEAN。
  - FOR 循环变量必须是 INTEGER。
- CONSTANT：值必须是字面量，并且禁止给常量赋值。
- 调用规则：
  - 函数不能写 CALL，过程必须写 CALL。
  - 函数必须作为表达式的一部分使用。
  - 函数的每条执行路径都要有 RETURN。
  - 函数参数不能用 BYREF。
  - 实参个数、类型、顺序必须匹配。
  - 0478 中参数不能超过 3 个。
- 数组：越界检查（运行时）、整体赋值时检查尺寸和类型、禁止 `[a TO b]` 写法。
- CASE：OTHERWISE 必须最后；分支值类型要和选择变量一致；分支重复或范围重叠给警告。
- 文件：打开模式和操作要匹配（READ 模式下不能 WRITEFILE；EOF 要求文件以 READ 打开）；一个文件同时只能处于一种模式；程序结束时有未关闭的文件给警告。
- OOP：PRIVATE 成员的访问控制；构造函数必须叫 NEW；`SUPER.NEW` 的使用；`NEW Class(...)` 实参匹配。
- 风格检查（可关闭）：缩进是否符合方言、标识符是否 PascalCase、FOR 循环的 NEXT 后有没有重复写循环变量。

### 4.4 执行引擎：不要直接转译成同步 JS

- **方案：** 用 generator 实现的树遍历解释器，或者编译成字节码在小型虚拟机上运行，整体放在 Web Worker 里。
- **好处：**
  - 每条语句执行后都能 yield，可以真正单步执行、设置断点、暂停和继续。
  - 输出可以实时推送，不需要缓冲。
  - INPUT 通过 Worker 消息通信，或用 SharedArrayBuffer + Atomics.wait 实现。
  - 无限循环用"指令步数上限 + 用户中止"来控制，不依赖墙钟时间。
  - 运行时错误精确定位到行和列，并显示调用栈。
- **BYREF：** 用引用单元（cell）实现。
- **记录和数组赋值：** 必须是深拷贝（Guide 中 `Pupil2 ← Pupil1` 是值复制）。
- **指针：** `^Var` 取地址，`Ptr^` 解引用。
- **虚拟文件系统：** 持久化到 IndexedDB；随机文件按"记录序号 → 记录对象"存储。
- **随机数：** 可以设种子，让教学演示和测试结果可复现。

### 4.5 编辑器功能（全面对标并超越）

- **高亮：** 用 Lezer 语法或 Monarch 实现高亮；同时按方言把"本方言不允许的关键字"标灰或标红。
- **补全：** 补全内容按方言过滤；函数签名提示直接引用 Insert 原文的签名格式（例如 `MID(ThisString : STRING, x : INTEGER, y : INTEGER) RETURNS STRING`）。
- **代码片段：** 输入 `IF`、`FOR`、`CASE` 等时，按方言缩进自动展开整个结构块。
- **代码操作：**
  - 悬停显示类型
  - 跳转到定义
  - 重命名（不区分大小写）
  - 折叠
  - 大纲视图（过程、函数、类型、类）
  - 快速修复（缺 ENDIF、关键字小写、`<-` 转 `←`、补 DECLARE）
- **格式化器：** 严格按方言缩进规则；保留语句顺序和注释；对齐续行。
- **行号：** 显示风格和考试一致（续行不编号）。
- **导出：** 导出 PDF 时使用 Courier New 等宽字体，排版和考卷一致。

### 4.6 调试与教学

- **调试器：** 断点（点击行号设置，不用往代码里插关键字）、单步进入/跳过/跳出、监视窗口、调用栈、变量面板（可展开数组、记录、对象、集合）。
- **Trace table：**
  - 列顺序可配置。
  - 换行规则至少覆盖 Pseudocode Pro 的所有选项（进入模块、每次循环、IF 分支、"从左到右"规则、重复值显示），并完整支持记录、类和集合（对方自己承认这块有 bug）。
  - 导出 CSV 或 Excel。
  - **"填空模式"：** 学生先手填 trace table，系统再比对答案并标出错误的单元格。
- **其他可视化：** 流程图（与 IGCSE 流程图符号一致）、AST/Token 查看器（面向 A2 学编译原理的学生）。
- **转换器：**
  - 转 Python / Java / VB：IGCSE 15 分场景题允许用这三种语言作答；A2 Paper 4 也要用编程语言。 [cambridgeinternational](https://www.cambridgeinternational.org/Images/711263-2026-2028-syllabus-update.pdf)
  - 转换时注意数组下标偏移（伪代码通常从 1 开始）、DIV/MOD 的语义差异、BYREF 的模拟。

### 4.7 考试和内容模块

- **考试模式：** 关闭补全；只显示当场 Insert 列出的函数；倒计时；查看 Insert 面板。
- **真题起始代码：** 预置真题中"已声明并初始化"的数据，让学生按考试原样作答后能运行验证（Pseudocode Pro 的核心付费功能）。 [pseudocode](https://www.pseudocode.pro/)
  - **版权提示：** 题目和 Insert 版权归 © UCLES。不要整份转载，用"题号 + 自编数据 + 链接"的方式，或者取得授权。 [pastpapers.papacambridge](https://pastpapers.papacambridge.com/directories/CAIE/CAIE-pastpapers/upload/9618_s24_qp_22.pdf)
- **题库与自动判分：** 隐藏测试用例、I/O 比对、调用指定过程或函数的单元测试、"Mark Scheme 风格"的分点反馈。
- **教师端：** 班级管理、布置作业、抄袭相似度检测（比较 AST 结构）、学情统计、批量授权。
- **本地化：** 中英双语界面和报错，对中国学生是明显的优势。

***

## 五、质量保障

1. **一致性语料：**
   - Guide 每个示例（包括需要手动修正的那几个）
   - Insert 每个函数的示例（例如 `DAYINDEX(09/05/2023)=3`、`"Program" = "program"` 结果为 FALSE）
   - 历年真题的标准答案
2. **每条规则配套测试：** 至少 1 个正例 + 1 个反例 + 1 个错误信息快照（golden test）。
3. **差分测试：** 和 Pseudocode Pro 跑同样的程序，结果有差异时人工判断谁更符合规范。
4. **模糊测试：** 对解析器做 fuzz 和属性测试，保证遇到任何输入都不崩溃。
5. **性能：** 能在 1 秒内跑完 1e7 次循环；10 万行代码时诊断延迟低于 100ms（增量解析）。
6. **方言回归测试：** 每次考纲更新，把它的 changelog 转成测试用例。

## 六、实施路线

| 阶段 | 内容 |
|---|---|
| M1（4–6 周） | 0478 方言完整实现：词法、语法、语义、解释器、编辑器、报错 |
| M2 | 9618-AS：完整实现 Insert 全部函数，加入 DATE、记录、文本文件、BYREF |
| M3 | 9618-A2：枚举、指针、集合、随机文件、OOP、递归调试 |
| M4 | 调试器、trace table、流程图、三种语言的转换器 |
| M5 | 考试模式、真题起始代码、题库判分、教师端、桌面版、付费体系 |

**接下来建议马上做的事：** 去 Cambridge 官网下载最新的 0478 考纲（v6）伪代码章节、9618 2027–29 版 Guide、最近 3 场考试的 Insert，逐条录入方言配置并标注来源。然后对"⚠️待核对"的几项（0478 是否禁止下划线、0478 是否支持 APPEND、AS/A2 各特性的具体边界、ROUND v6 的具体说明）逐一查证原文。