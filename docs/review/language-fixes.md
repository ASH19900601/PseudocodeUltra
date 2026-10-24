# 语言、诊断与教学工具实测修复

日期：2026-10-24（北京时间）。在本机 Windows、Node.js/tsx 环境中直接调用真实解析器、静态分析器、运行器、语言服务和追踪表实现。先复现，再修改源码；没有生成发布构建、调用浏览器测试或推送 GitHub。

本组共 **17 类独立问题**。同一根因的多个写入语句、枚举/隐式对象上下文、CASE 多种无效范围及解析/缩进表现分别合并计数，不按断言数量累加。

| 编号 | 实际触发和原有影响                                                                                                          | 已完成修复                                                                                         | 回归测试名（`conformance/language-regressions.test.ts`）                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| L01  | `OUTPUT "a \" // text"`：词法器能识别，但语句清理把转义引号误当字符串结束，随后把字符串内部 `//` 当注释，合法代码无法运行。 | 注释清理遵循字符串转义；运行输出完整字符串。                                                       | escaped quotes do not turn string content into a line comment               |
| L02  | CASE 分支体的 `OUTPUT "a:b"` 被误认为下一分支，整个 CASE 解析失败；格式化也把 OUTPUT 错缩进为标签。                         | 解析器和格式化器检查真实冒号 token，忽略字面量内部冒号。                                           | CASE branch bodies can output strings containing colons                     |
| L03  | `PROCEDURE P() RETURNS INTEGER` 被当作合法过程，编辑器无法指出错误的声明语法。                                              | 过程出现 RETURNS 时直接给出双语语法诊断。                                                          | procedures reject a RETURNS clause                                          |
| L04  | `1 ← 2`、`INPUT 1`、文件读取到字面量等目标在静态检查中全部通过，直到执行时才失败。                                          | 所有要求写入位置的表达式统一校验可赋值形式，覆盖赋值、INPUT、READFILE、GETRECORD、BYREF 和取地址。 | write operations diagnose nonassignable expression targets before execution |
| L05  | 常量被用作 FOR 计数器时静态分析没有报错。                                                                                   | 在循环执行前给出 CONSTANT 诊断。                                                                   | FOR cannot overwrite a constant loop variable                               |
| L06  | CASE 分支内声明跳过声明校验，重复变量、保留字变量和未知类型均没有诊断。                                                     | 分支体进入同一作用域声明遍历，与 IF/循环一致。                                                     | CASE bodies receive declaration, identifier and type validation             |
| L07  | 记录中同名字段互相覆盖，`DECLARE IF:INTEGER` 也被接受。                                                                     | 独立校验记录字段名称和重复，保持不同记录的同名字段合法。                                           | record fields reject duplicate names and reserved identifiers               |
| L08  | 枚举 `(A,A)`、`(IF)`、空枚举以及跨枚举同名成员被接受，产生歧义绑定。                                                        | 校验每个枚举成员、空值、重复和全局名称冲突。                                                       | enum members reject duplicate, empty and reserved identifiers               |
| L09  | `CLASS C INHERITS R` 在 R 为记录时仍通过分析，混用记录和类模型。                                                            | 父类必须是已声明的 CLASS。                                                                         | a class superclass must be a class rather than a record                     |
| L10  | 函数的 REPEAT 循环体无条件 RETURN，仍误报“并非所有执行路径都返回”，阻止合法函数运行。                                       | 返回路径分析考虑 REPEAT 至少执行一次。                                                             | an unconditional return in REPEAT satisfies a function return path          |
| L11  | 过程内或 IF 内定义子程序被静默接受，但当前执行模型没有注册这些定义。                                                        | 对不受支持的嵌套定义给出明确诊断，避免编辑器宣称可执行。                                           | nested definitions produce a diagnostic instead of being silently ignored   |
| L12  | CASE 标签 `3 TO 1` 和 `1 TO 2 TO 3` 静默通过，可能永远不匹配或忽略多余端点。                                                | 诊断逆序和超过两个端点的范围，并关联 CASE 规则来源。                                               | CASE rejects reversed or multiply chained range endpoints                   |
| L13  | 修改 `OUTPUT A` 为枚举成员 B，或修改隐式 `Obj ← NEW C()` 后的输出语句时，增量分析误报 UNDECLARED；全量分析没有问题。        | 增量依赖表包含枚举成员与隐式对象定义，并收集其类型依赖。                                           | incremental dependencies include enum members and implicit object variables |
| L14  | 前一行长度变化后，后一行关键字大小写诊断位置会移动，但其快速修复仍使用旧位置，可能改坏其他字符。                            | 统一移动保留诊断中每个修复编辑的原文偏移。                                                         | editing an earlier row remaps later quick fix edits                         |
| L15  | 增量编辑输入 `<-` 后规范化诊断被过滤掉，编辑器缺少应有警告/修复；片段级全局修复也不适用于整个文档。                         | 涉及规范化字符时重新进行全量分析，保留覆盖完整原文的正确修复。                                     | editing normalized punctuation retains a safe whole-document quick fix      |
| L16  | `MID(A[1,2],` 的参数提示错误地高亮第三参数，二维数组逗号被当作函数实参分隔符。                                              | 参数栈同时跟踪方括号，仅计算当前调用层的逗号。                                                     | signature parameter index excludes array subscript commas                   |
| L17  | 追踪表选择“循环”策略并隐藏重复值后，FOR 1..2 的值全变为空白，教学观察失效。                                                 | 重复值与前一个真正显示的筛选行比较，不再和被排除的 step 事件比较。                                 | trace repeated values are compared with the preceding visible filtered row  |

验证命令：

```powershell
npx tsx --test conformance/language-regressions.test.ts conformance/teaching.test.ts conformance/semantics.test.ts conformance/edges.test.ts
```

结果：**54/54 通过，0 跳过**，其中本次新增 17 项，且原有 1,000 组确定性解析器 fuzz 包含在既有测试内。完整核心测试与全仓库类型检查由主任务在所有代理修改冻结后汇总执行。没有将这次定向测试包装成完整工程验收。
