# 暗色主题与工作区布局调整

2026-10-24，在 Windows 本机开发服务器完成。依据用户要求，实际打开 [Pseudocode Pro 0478 编辑器](https://www.pseudocode.pro/0478)，参考其紧凑顶栏、左右代码/输出分栏、深色编辑底和高亮层次；保留本项目名称及现有练习、考试、调试功能。

## 本次变化

- 取消宽侧轨和大标题留白，改为紧凑顶栏与横向导航。桌面左侧为大编辑区，右侧为输出和功能标签，右下方放置调试工具；窄屏按编辑器、输出、调试顺序排列。
- 统一浅色与暗色的背景、面板、边框、文字、强调色及成功/警告/错误色。暗色使用深藏蓝底、蓝色关键字、紫色字符串、暖色类型名，正文与辅助文字提高可读性。
- CodeMirror 真正切换暗色主题及语法高亮，覆盖选区、光标、补全、搜索、折叠和提示弹层。此前仅切换页面 CSS，编辑器仍套用浅色高亮，暗底上的关键词和字符串难以辨认。
- 流程图、代码预览、输入框、表格、文件对话框、练习反馈、考试和 Insert 面板统一主题；移除暗色里的浅底残留。
- 保存主题偏好，首次加载提前设置暗色画布；主题按钮具有当前状态和切换目标。切换通过编辑器 Compartment 完成，保留源码、光标、选择和 Undo。

## 实际界面

- [修改前暗色](review/ui-redesign/before-dark.png)
- [修改后桌面暗色](review/ui-redesign/after-dark-1440.png) / [浅色](review/ui-redesign/after-light-1440.png)
- [修改后窄屏暗色](review/ui-redesign/after-dark-390.png) / [浅色](review/ui-redesign/after-light-390.png)
- [暗色流程图](review/ui-redesign/flow-dark-1440.png)
- [暗色练习判分](review/ui-redesign/practice-dark-1440.png)
- [暗色考试](review/ui-redesign/exam-dark-1440.png)

截图来自本机实际 Edge，桌面 1440×1000、窄屏 390×844。确认代码执行输出 `Alex · 2008 · 90`、练习提交 100 分和考试保存/执行输出 `42`；无页面异常或页面横向溢出。长代码在编辑区内横向滚动，调试区可独立滚动。截图禁用过渡动画，避免把主题切换中间帧误当作最终配色。

## 验证

| 检查              | 结果               | 记录                                                        |
| ----------------- | ------------------ | ----------------------------------------------------------- |
| TypeScript        | 通过               | [汇总](review/ui-redesign/verification.json)                |
| 核心测试          | 222/222            | [core.tap](review/ui-redesign/core.tap)                     |
| 真实 Edge 浏览器  | 57/57，0 失败/跳过 | [browser.json](review/ui-redesign/browser.json)             |
| 桌面/窄屏实际渲染 | 已查看             | [visual-checks.json](review/ui-redesign/visual-checks.json) |

新增 5 项主题回归覆盖保存/刷新、两次切换后的源码/光标/Undo、暗色代码文字对比度至少 4.5:1、实际绘制光标及选区、补全/搜索暗色弹层和两种宽度的页面溢出。其他 52 项浏览器测试仍覆盖运行、文件、调试、追踪、练习、考试和十万行输入。

复现：`npm run check`、`npm test`、`npm run test:e2e`。本轮没有修改语言解释和代码转换逻辑，未重复原生工具链测试；未执行生产构建、安装包打包或 GitHub 推送。受测源码摘要及包含范围在机器汇总中，Markdown、截图和生成的验收记录不在摘要内。

本机仍通过 [http://127.0.0.1:5173](http://127.0.0.1:5173) 使用；刷新已有页面，右上角可切换浅色/暗色。
