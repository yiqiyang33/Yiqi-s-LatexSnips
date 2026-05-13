# Yiqi's LatexSnips

Yiqi's LatexSnips 是一个面向 VS Code 的 LaTeX 数学公式 snippet 扩展。项目基于 HyperSnips，保留了类似 UltiSnips 的可编程 snippet 语法，并针对 Markdown / LaTeX 写作增加了数学环境识别和 `${VISUAL}` 选中文本替换能力。

仓库地址：<https://github.com/yiqiyang33/Yiqi-s-LatexSnips>

> 如果已经安装原版 HyperSnips，建议先禁用或卸载。两个扩展会注册相近的命令和 snippet 行为，同时启用时容易互相干扰。

## 功能特性

- 使用 `.hsnips` 文件管理 snippet。
- 支持普通触发词、正则触发词、Tabstop、优先级和 JavaScript 插值。
- 支持 `A` 自动展开 flag。
- 支持 `m` 数学环境限定 flag。
- 能识别 `$...$`、`$$...$$`、`\(...\)`、`\[...\]`、`equation`、`align`、`gather` 等数学环境。
- 使用统一 LaTeX context engine，在注释、Markdown code、`verbatim` / `minted` / `lstlisting`、`\text{}`、`\label{}` 等位置避免误触发。
- 在 `align`、矩阵、`cases`、`array`、`tabular` 等环境中按 Enter，可自动给当前行补 `\\` 后换行。
- 在 `align`、矩阵、`cases`、`array`、`tabular` 等环境中按 Tab，可优先插入列分隔符 ` & `。
- 支持当前位置转换 LaTeX 环境，例如 `align` ↔ `aligned`、`\[...\]` → `equation*`、`tabular` → `tabularx`。
- 提供 Monaco snippet 管理器，可搜索、诊断、预览并编辑完整 `.hsnips` 源码。
- 支持 `${VISUAL}`，可把最近选中的文本带入 snippet。
- 为 `.hsnips` 文件提供语法高亮。

## 快速开始

1. 在命令面板运行 `Yiqi's LatexSnips: Open Snippets Directory`。
2. 在打开的目录中新建目标语言对应的 snippet 文件，例如：
   - `markdown.hsnips`：用于 Markdown。
   - `latex.hsnips`：用于 LaTeX。
   - `all.hsnips`：用于所有语言。
3. 写入 snippet 并保存。保存 `.hsnips` 文件后，扩展会自动重新加载 snippets。

Markdown 默认可能不会弹出补全提示。建议在 VS Code 的 `settings.json` 中加入：

```json
"[markdown]": {
  "editor.quickSuggestions": true
}
```

## Snippet 目录

默认 snippet 目录如下：

- Windows：`%APPDATA%\Code\User\hsnips\(language).hsnips`
- macOS：`$HOME/Library/Application Support/Code/User/hsnips/(language).hsnips`
- Linux：`$HOME/.config/Code/User/hsnips/(language).hsnips`

也可以通过 `hsnips.windows`、`hsnips.mac`、`hsnips.linux` 配置项自定义路径。

## Context 配置

扩展内置了常见 LaTeX 数学、分行、分列和文本命令判断。若你有自定义环境，可以在 `settings.json` 里追加：

```json
{
  "hsnips.context.extraMathEnvironments": ["myproofmath"],
  "hsnips.context.extraRowBreakEnvironments": ["myalign"],
  "hsnips.context.extraAlignmentEnvironments": ["myarray"],
  "hsnips.context.extraTextLikeCommands": ["mytext"]
}
```

这些配置会同时影响 `m` 数学 snippet、智能 Enter、智能 Tab 和相关 context key。

## 基本语法

一个 `.hsnips` 文件可以包含 `global` JavaScript 代码块和多个 `snippet` 代码块：

```hsnips
global
// 当前文件内所有 snippet 可共享的 JavaScript 代码
endglobal

snippet trigger "description" flags
body
endsnippet
```

`trigger` 可以是普通字符串，也可以是用反引号包裹的正则表达式。正则触发词如果没有以 `$` 结尾，解析时会自动补上行尾匹配。

```hsnips
snippet RR "Real numbers" iAm
\mathbb{R}
endsnippet
```

在数学环境中输入 `RR`，会自动展开为 `\mathbb{R}`。

## Flags

`flags` 写在 snippet 描述后面，用来控制触发行为：

- `A`：自动展开，触发词匹配后立即展开。
- `i`：允许在单词内部展开。
- `w`：按 word boundary 匹配。
- `b`：只在行首展开。
- `M`：启用多行正则匹配。
- `m`：只在数学环境中展开。
- `t`：只在非数学环境中展开，适合 `align`、`dm` 这类会创建 display math 的 snippet。

其中 `i`、`w`、`b` 主要用于普通字符串触发词；正则 snippet 常用 `A`、`M`、`m`。

## JavaScript 插值

snippet body 中可以用两个反引号包裹 JavaScript 代码。代码会在展开时执行，也会在相关 tabstop 内容变化时重新计算。

```hsnips
snippet dategreeting "Current date"
Today is ``rv = new Date().toDateString()``.
endsnippet
```

插值代码中可使用的变量：

- `rv`：返回值，会替换当前插值位置。
- `t`：tabstop 内容数组。
- `m`：正则触发词的匹配结果数组。
- `w`：当前 workspace URI。
- `path`：当前文档 URI。

同一个 snippet 内，前一个插值块中定义的变量可以被后续插值块继续使用。代码块中也可以使用 Node.js 的 `require`。

## 正则展开示例

```hsnips
snippet `((\d+)|(\d*)(\\)?([A-Za-z]+)((\^|_)(\{\d+\}|\d))*)/` "Fraction" Am
\frac{``rv = m[1]``}{$1}$0
endsnippet
```

在数学环境中输入 `1/`，会展开为：

```tex
\frac{1}{}
```

这里的 `A` 表示自动展开，`m` 表示只在数学环境中生效。

## 多行公式辅助

在 `align`、`align*`、`aligned`、`gather`、矩阵、`cases`、`array`、`tabular` 等多行/分列环境中，按 Enter 会自动处理换行：

```tex
\begin{align}
a &= b
% 按 Enter 后变为：
a &= b \\

\end{align}
```

以下情况只执行普通换行，不会重复补 `\\`：

- 当前行为空。
- 当前行只有 `\begin{...}` 或 `\end{...}`。
- 当前行已经以 `\\` 结尾。
- 光标右侧还有非空内容。

在矩阵类环境中，按 Tab 会插入 ` & `，用于快速切换到下一列：

```tex
\begin{bmatrix}
a & b \\
c & d
\end{bmatrix}
```

当前支持 Tab 插入 ` & ` 的环境包括 `align`、`align*`、`aligned`、`alignedat`、`matrix`、`pmatrix`、`bmatrix`、`Bmatrix`、`vmatrix`、`Vmatrix`、`smallmatrix`、`cases`、`array`、`tabular`、`tabular*`、`tabularx`、`longtable`。

在这些环境中，Tab 会优先插入 ` & `，不会被 snippet placeholder 跳转抢走；这对矩阵 snippet 展开后光标停在空单元格行的情况也生效。如果当前行不适合插入 ` & `，例如 `\begin{...}` / `\end{...}` 行、已经以 `\\` 结尾的行、注释中或 Markdown 代码块中，则退回默认 Tab/snippet 行为。

如果修改或本地编译后按键行为没有变化，先执行 `npm run compile`，然后在 VS Code / Cursor 中运行 `Developer: Reload Window`。按键绑定和 `out/` 编译产物都需要重新加载后才会被当前扩展实例使用。

Enter 逻辑同时带有文档变更兜底：如果其他扩展或编辑器模式先把 Enter 处理成了普通换行，扩展会在换行后立即检查上一行并补上缺失的 `\\`。

## 环境转换

运行 `Yiqi's LatexSnips: Convert LaTeX Environment` 可以转换当前光标所在环境：

- `align`、`align*`、`aligned`、`equation`、`equation*`、`split`、`gather`、`gather*`
- `matrix`、`pmatrix`、`bmatrix`、`Bmatrix`、`vmatrix`、`Vmatrix`、`smallmatrix`、`cases`
- `array`、`tabular`、`tabular*`、`tabularx`、`longtable`

如果光标在 `\[...\]` 或 `$$...$$` 内，会把 display math delimiter 转为所选环境。如果有选区且不在已有环境内，会用目标环境包裹选区。转换到表格类环境时会保留已有列格式；没有列格式时会提示输入，默认是 `c`，`tabularx` / `tabular*` 默认使用 `\linewidth`。

## Snippet 管理器

运行 `Yiqi's LatexSnips: Open Snippet Manager` 可以打开 Webview 管理器：

- 按 `.hsnips` 文件浏览 snippet。
- 搜索 trigger、description、flags 和 body。
- 过滤有诊断、重复 trigger、自动展开、数学限定、动态和正则 snippet。
- 查看重复 trigger、非法 flags、空 trigger、缺少 `endsnippet` 等诊断。
- 使用内置 Monaco 编辑器直接编辑当前 `.hsnips` 文件完整源码；动态 snippet、正则 snippet 和 `global` 代码都可以在源码中修改。
- 点击列表中的 snippet 会跳转到源码位置；移动编辑器光标时，右侧详情会跟随当前 snippet。
- `New` 会在当前文件末尾插入简单 snippet 模板；`Delete` 会删除当前 snippet 源码块。两者都只修改 Webview buffer，点击 `Save` 后才写回磁盘。
- `Open Source` 仍可回到 VS Code / Cursor 原生编辑器中的源码位置。

管理器保存前会检查文件 hash、mtime，以及 VS Code / Cursor 中是否存在未保存的同名 `.hsnips` 文档；如果源文件被外部修改，会要求先 Reload，避免覆盖手动改动。若 Monaco 资源加载失败，管理器会自动降级到普通文本编辑区。

## `${VISUAL}`

`${VISUAL}` 会替换为最近 5 秒内选中的文本，适合用来包裹已有公式片段。

```hsnips
snippet fr "Fraction" iAm
\frac{${1:${VISUAL}}}{$2}
endsnippet
```

例如先选中 `x+y`，再在数学环境中输入 `fr`，可以得到：

```tex
\frac{x+y}{}
```

## 常用命令

扩展提供以下命令：

- `Yiqi's LatexSnips: Open Snippets Directory`
- `Yiqi's LatexSnips: Open Snippet File`
- `Yiqi's LatexSnips: Open Snippet Manager`
- `Yiqi's LatexSnips: Reload Snippets`
- `Yiqi's LatexSnips: Convert LaTeX Environment`
- `Yiqi's LatexSnips: Smart Math Enter`
- `Yiqi's LatexSnips: Insert Matrix Column Separator`
- `Yiqi's LatexSnips: Smart Alignment Tab`

## 开发

安装依赖并编译：

```sh
npm install
npm run compile
```

常用脚本：

- `npm run compile`：编译 TypeScript 到 `out/`。
- `npm run watch`：开发时持续编译。
- `npm run lint`：运行 TypeScript 静态检查。
- `npm test`：运行核心 LaTeX 编辑逻辑测试。
- `npm run check`：依次运行静态检查和测试。

Snippet Manager 使用 `monaco-editor` 的本地运行时资源，因此打包 VSIX 时会包含 Monaco 文件。后续若要继续压缩 VSIX 体积，可以把 Monaco runtime 单独 vendor 到更小的资源目录或引入 bundling。

## 致谢

本项目派生自 HyperSnips 系列的可编程 snippet 引擎。当前仓库在原有能力基础上，面向 LaTeX / Markdown 数学写作继续维护和增强。
