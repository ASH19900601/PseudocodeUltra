# M1–M4 最终工程验收

> 以下是初始提交 `3d9bd86` 的历史验收记录。后续本机修复、269 项回归及未完成的规范/发布验证见 [2026-10-24 本机实测报告](LOCAL_REVIEW_2026-10-24.md)，不能用此处原始源码摘要和测试计数代表修改后的代码。

**结论：M1–M4 阶段功能已实现，本次完整工程验收通过。** 日期：2026-10-24（Asia/Shanghai）。原始方案见 [PROJECT_PLAN.md](PROJECT_PLAN.md)。M5 未列入本次范围。

最终记录为 [summary.json](validation/summary.json)，完成于 13:36:15。受测源码 SHA-256：`8b31499c126a9def27e0952999fe50eb760f4f1ff4358500c0c7ed54e84a1edf`。摘要包括 core、web、conformance、scripts、依赖声明与锁文件、TS/Playwright 配置、规范来源清单；不包括 Markdown 报告、截图和生成的验收记录。

## 阶段验收矩阵

| 阶段      | 完成项                                                                                                                                                                   | 实现与验收证据                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| M1        | 0478/2210 版本化方言；Unicode 规范化及原文位置映射；词法、Pratt/嵌套语法与错误恢复；符号/作用域/类型/控制流检查；基础类型、常量、数组、条件、循环、子程序及 INPUT/OUTPUT | `core/{dialects,lexer,parser,model,semantic,runtime}.ts`；`core.test.ts`、`semantics.test.ts`、`specification.test.ts`、`edges.test.ts` |
| M1 编辑器 | 方言高亮/补全/片段；签名和来源悬停；定义、重命名、折叠、大纲；缺终止符/大小写/赋值箭头/DECLARE 等修复；排版/续行行号；PDF 打印                                           | `core/{language,language-service,tools}.ts`、`web/{main,language.worker,print}.ts`；`teaching.test.ts` 和浏览器测试                     |
| M2        | 全部 Insert 函数及参数/返回类型；DATE/UTC；记录与数组深拷贝；文本文件/EOF/APPEND；BYREF cell 别名与 BYVAL；完整返回路径                                                  | `core/builtins.ts`、`runtime.ts`、`semantic.ts`；全部签名逐项正反例与诊断 golden；核心与原生测试                                        |
| M3        | 强类型枚举及序数运算；指针与空指针检查；类型化集合与值相等；随机文件；类、继承、构造器、SUPER、动态方法、PUBLIC/PRIVATE；递归、深度限制；文件对象图持久化                | `core/{runtime,model,semantic}.ts`；核心、边界、策略测试；`native/advanced.test.ts`、`native/snapshot.test.ts`                          |
| M4 调试   | 独立 Worker；断点、暂停/继续/停止、进入/跳过/跳出；INPUT 暂停；当前语句、调用栈、复杂变量展开与纯表达式监视；运行错误来源位置与栈                                        | `web/execution.worker.ts`、`core/runtime.ts`；真实 Chromium 调试、断点、监视、取消与持久化操作测试                                      |
| M4 教学   | 语句/变量变化/模块/循环/分支/从左到右追踪策略；可选列及重复值；复杂值展示；分页；填空批改；CSV 和真实 OOXML Excel；主程序/子程序/方法流程图及源行跳转；AST/Tokens        | `core/{trace,tools}.ts`、`web/main.ts`；教学单测、Excel ZIP/XML 检查和浏览器下载/分页测试                                               |
| M4 转换   | Python、Java、VB.NET 直接源码生成；所有阶段类型、子程序、BYREF、数组边界重基、递归、文件、类/继承/私有绑定；所选模糊语义策略；当前文件对象图初始化                       | `core/transpile.ts`、`core/native/`；三种目标语言原生编译或解析执行，输出对比解释器；共 34 项原生测试                                   |

转换器包含各目标语言自己的辅助运行时，仅使用相应标准库。Java/VB 生成程序不调用 Python 或 Node。记录/数组按值复制，对象保留引用身份；私有字段按声明类绑定；多层 SUPER 和动态方法分派有独立回归覆盖。随机文件的持久化和导出保留记录内的数组、枚举、集合、日期、指针引用与循环关系。

## 最终检查结果

完整命令：`bash scripts/install.sh && npm run accept`。安装脚本实际重复运行了 npm ci、工具链校验及生产构建，随后执行以下顺序验收：

| 检查                         | 结果                             | 原始证据                                                                           |
| ---------------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| 官方资料                     | 8 份固定 SHA-256 均通过          | [specifications.log](validation/specifications.log)、[来源清单](spec-sources.json) |
| 核心/规范/语义/语言服务/教学 | 153 / 153                        | [core.tap](validation/core.tap)                                                    |
| Python / Java / VB.NET 原生  | 34 / 34                          | [native.tap](validation/native.tap)                                                |
| 真实 Chromium 端到端         | 19 / 19，0 跳过                  | [browser.json](validation/browser.json)                                            |
| TypeScript + Vite 生产构建   | 通过                             | [build.log](validation/build.log)                                                  |
| 性能阈值断言                 | 通过                             | [performance.json](validation/performance.json)                                    |
| 生产构建浏览器 smoke         | AS/A2 执行通过，无页面或网络错误 | [production.log](validation/production.log)                                        |

合计 **206 项测试通过，0 失败、0 跳过**。核心测试另含 1,000 组确定性 malformed-token fuzz；恶意深表达式/块、循环类型、继承环和恢复边界有专门测试。内置函数测试覆盖正例、错误参数个数、类型反例及错误信息/位置/来源断言。

浏览器验收覆盖编辑与 INPUT、断点与单步/跳过/跳出/停止、纯监视、IndexedDB、所有方言示例、快速修复、版本和严格程度持久化、成员补全和签名、折叠与续行、PDF 转义、流程图跳转、AST、三语言转换、追踪填空/Excel/CSV/翻页及窄屏布局。

GitHub Actions 已配置执行同一 `npm run accept` 并上传验收记录。本报告记录本环境真实运行结果；远端 CI 的运行状态以 GitHub Actions 为准。

## 性能验收的条件

| 场景                                         | 本次测量    | 阈值                 |
| -------------------------------------------- | ----------- | -------------------- |
| 10,000,000 次标量累加循环                    | 34.77 ms    | < 1,000 ms           |
| 100,000 行完成冷分析后的一次非结构性编辑诊断 | 9.69 ms     | < 100 ms             |
| 同一 100,000 行文档的冷分析                  | 2,916.12 ms | 记录，不纳入增量阈值 |

循环测量使用预热后的高速执行，关闭追踪；AST 优化器对受支持的标量语句生成内部操作，未支持结构回退到树解释器。高速模式仍受指令上限约束，UI 可以直接终止 Worker。

增量测量是已经建立语法/类型上下文后的一处顶层非结构性修改。声明、类型、模块和其他结构性修改使缓存失效并重新完整分析。没有把冷分析、所有编辑形态或开启逐语句快照的速度宣称为上述指标。此结果是当前机器上的可重复场景基准，不是所有硬件的延迟保证。

## 已明确的边界

- 当前实现对应 0478/2210 2026–2028 v6，9618 Guide 2026 与 2027–2029；未来版本需要按 changelog 更新。2210 2029–2031 改为 Python，不能继续套用旧伪代码配置。
- 默认 100,000 指令，可在 UI 调整；默认调用深度 128，单数组最多 100,000 元素，解析器对过深/过复杂输入返回诊断。这些属于工程资源政策。
- 浏览器最多保留 50,000 条追踪事件，超限会明确显示截断；表格每页 200 行，CSV/Excel 导出全部保留且符合当前筛选条件的行。高速模式不产生追踪。
- 文件是内存/IndexedDB 虚拟文件，不直接读取用户磁盘路径；生成代码嵌入初始虚拟文件并保留同一文件模型。数据不会自动跨浏览器或跨设备同步。
- 模糊语义的默认值和可选值见 [SOURCES.md](SOURCES.md)。官方资料来源与本项目政策分别标示。
- 语料由规范规则、Insert 函数、原创复杂场景、模糊测试和三语言对照组成。没有声称覆盖历年真题全集、每个官方示例组合或第三方 Pseudocode Pro 全部行为，也不构成对任意程序的形式证明。

M5 的考试倒计时、真题起始代码、题库与作业自动判分、教师端、账户、桌面版和付费体系未实现。M4 的追踪表填空批改已经实现，与 M5 的题库自动判分是不同功能。

## 环境与复现

本次环境：Node.js 24.19.0、Python 3.12.14、Java 21 JRE + ECJ 3.40、.NET SDK 8.0.100、系统 Chromium。项目需要 Node.js 22+。SDK 按 Microsoft 官方 metadata 的 SHA-512 校验，ECJ 按 Maven Central 发布校验值验证并保留 TLS；npm 使用 lockfile 的 integrity。

```bash
npm ci
npm run setup:toolchains
npm run accept
```

ECJ/.NET 默认位于 `/workspace/.tools`；其他位置用 `PSEUDO_TOOLS_DIR`、`ECJ_JAR`、`DOTNET_BIN`。浏览器用 `CHROMIUM_PATH` 覆盖，官方资料缓存用 `PSEUDO_SPEC_CACHE` 覆盖。应用本身不需要秘密凭据。

环境安装脚本及启动说明已经保存为云环境配置草稿；保存草稿不会发布，也没有在新的云任务中验证恢复。请在环境设置中审阅、保存并发布。现有代码与验收证据保留在当前工作区。
