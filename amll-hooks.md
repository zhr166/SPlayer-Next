# AMLL 私有 hook 与升级维护

当前补丁适配 `@applemusic-like-lyrics/core@0.5.2`。这些 hook 是 SPlayer 的私有协议，
不是 AMLL 的公开配置项。仅保留 Vue 中的字段不能使功能生效，必须同时存在对应包补丁。

## 入口与消费位置

| hook / 接入点                    | 写入或触发位置                                                    | 消费位置与约束                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `__amllIndependentRomanWordMask` | `AMLLLyrics.vue` 的 `processedLyrics`，正文为主文字且显示逐词发音 | `LyricLineEl.createWord` 拆分 DOM，`updateMaskImageSync` 选择路径，`generateWebAnimationBasedMaskImage` 分别生成两层动画                      |
| `__amllIndependentMainWordMask`  | 同上，发音经 `promotePronunciation` 提升为主文字                  | 消费位置相同；提升后 `word` 是发音，`romanWord` 是原正文，不得再次交换                                                                        |
| `__amllSkipWhitespaceSplit`      | `romanization.ts` 的 `promotePronunciation`                       | `normalizeSpaces` 跳过标准化，`rebuildElement → chunkAndSplitLyricWords` 保留音节内部空格和原始时间，只将边界空白提为排版节点                 |
| 重叠行抬高                       | `syncCurrentTime → syncAlignPosition`、配置 watcher               | `amll-player.ts` 子类读取 `timelineState.bufferedGroups`，统计其中主行；最终位置变化时调用 `setAlignPosition`、`setAlignAnchor`、`calcLayout` |
| 实例生命周期                     | `playerRef`、挂载后的异步身份检查                                 | 必须使用 `shallowRef` 保存 Core 实例，避免代理破坏实例身份检查                                                                                |

两个独立遮罩标记是同一功能在不同主文字设置下的入口。任一为 `true` 都要同时拆开正文和发音，
不能把独立发音遮罩放在仍有正文遮罩的祖先之下，否则两层遮罩相乘，发音仍受正文进度限制。
两个标记均不存在时沿用上游词容器和单层遮罩。

## 发音空格与重叠锚点

- 发音提升逐句检查显式排版：TTML 音译词之间的边界空格或 LRCN 本句发音中的内部空格表示应保留原样，句首句尾留白不作为依据。
  忽略符号、大小写和空白后相同的音节始终优先使用原文，即使本句存在手工空格；其余音节按本句的显式排版原样显示。
  没有显式排版的句子独立适配：CJK 音节间补空格，非 CJK 继承原文边界空格，不受其他句子的空格影响。
- `forceSyllableSpacing` 默认关闭；开启后发音提升忽略显式排版标记，统一在 CJK 音节之间补空格。
  音节内部文字和时间不拆分，等价原文仍优先复用，非 CJK 发音仍复制原文边界空格。
- `preserveRomanizationSpacing` 是解析器提供的语义信息；`preserveWordSpacing` 标记提升后的正文已经排版，供默认引擎使用。
  AMLL 另用 `__amllSkipWhitespaceSplit` 传给包内消费者。仅修改转换函数不够：上游优化和分词可能再次折叠空格、重分时长。
- 空格节点仍交给原有布局；不增加计时器、动画循环或跨曲目缓存。默认引擎保留完整音节时间并使用 `pre-wrap` 展示连续空格。
- 开启重叠抬高后只用前两条主行计算位置；首行仍播放时，第三行原地高亮，不参与边界约束。
  首行结束后由 `advanceOverlapAnchor` 清理已结束缓冲行并交接滚动锚点，原第二、第三行按新的两行重新对齐。
  关闭设置时保留 AMLL 原有的缓冲清理行为。
- `timelineState` 是受保护的内部 API，通过窄子类方法读取，不复制上游时间线状态机。升级时核对 `bufferedGroups` 的索引、
  `commitPlayerTimeState` 的清理时机、背景行归组规则及 seek 行为；不能退回单纯统计时间区间。
- 间奏布局以 `anchorLineIndex + 1` 的插槽为滚动基准，使用圆点自身高度应用对齐锚点，
  不使用前句或后句高度。ESM 与 CJS 的 `calcLayout` 补丁保持一致，正常播放和 seek 必须对齐到相同位置。

## 格式化 TTML 维护

`shared/utils/ttml.ts` 是渲染解析、手动导入检查、词库候选筛选和编辑保存共用的规则。
检测到元素之间含换行缩进即视为格式化文件，忽略元素间全部纯空白；`<space/>` 和叶子元素文本内的空格保留。
紧凑 TTML 的原有元素间空格不改变含义，元数据中的空格不能作为歌词已正确分词的证据。

单曲手动导入遇到完全缺少合法空格的格式化文件时，警告并允许继续；批量手动导入集中提示文件数，允许继续导入或仅跳过这些文件。
本地词库自动匹配跳过该文件，继续同 ID、同标题候选或其他来源。词库返回原文本，编辑器可原样填入美化页；原始页与保存结果为紧凑 TTML。
编辑器使用与搜索页相同的 `STabs`，只在用户切换页签时同步文本，避免初始化时把原始美化排版覆盖。

## DOM、尺寸和时间轴约定

- `mainElement` 仍是上游词容器，供换行测量、上浮和强调动画使用，不直接承载独立模式的遮罩。
- `mainMaskElement` 只包含主文字及其 ruby；`romanMaskElement` 位于单独的发音容器内。
  缺失发音的词使用不换行空格保留行高，正文不得被清空。
- `.amll-main-mask` 与 `.amll-roman-mask` 四边预留 `1em` 绘制空间，用负边距抵消排版占位，
  供强调放大、字形外伸和 `g/j/p/y` 下伸使用。测量视图从宽高扣除两侧 padding，
  并将 padding 单独传给连续遮罩生成器，不能把绘制留白算进词间推进距离。
- 行级使用 `contain: layout style` 与 `content-visibility: visible`，避免 `auto` 隐含的 paint containment 再次裁切。
  歌词视口仍裁切滚动内容；离屏行继续由 core 的 `isInSight` / `hide` 卸载 DOM 和词动画。
- 尺寸在上游 `updateMaskImageSync` 链路中读取。每层临时建立测量视图，
  不修改原始 `splittedWords` 的布局宽高，也不保存跨歌曲的尺寸缓存。
- 两层复用 0.5.2 的累计宽度、`getWordFadeWidth()`、`getRubySegments()` 和裁剪边界插值。
  独立指各层按自身字宽计算进度，不是另起逐词计时器；渐变尾部仍会自然延续到下一词。
- 临时测量视图必须共享原词的 `maskAnimations` 数组。先取消并清空旧动画，再追加两层新动画；
  不能在临时对象上替换数组，否则上游的暂停、跳转、隐藏恢复和释放将找不到这些动画。
- 时间单位统一为毫秒。独立模式的零时长行使用至少 1ms 的动画分母，零尺寸元素等待下次测量。
- 支持标准遮罩时生成 `maskPosition` 帧；仅支持 WebKit 遮罩时使用 `webkitMaskPosition`。
  此分支同样由上游动画生命周期管理。

## 尚未迁移的旧 hook

以下字段仍由 `AMLLLyrics.vue` 写入，但本次 0.5.2 补丁没有恢复消费者：

| 字段                            | 0.5.1 的原消费位置                 |
| ------------------------------- | ---------------------------------- |
| `__amllDisableWordHighlight`    | 两种遮罩生成器，跳过遮罩并取消动画 |
| `__amllDisableEmphasize`        | `buildWord` 的强调判断             |
| `__amllDisableCjkEmphasis`      | `buildWord` 的 CJK 强调过滤        |
| `__amllFloatAnimationIntensity` | `initFloatAnimation` 的位移强度    |

这些字段存在不代表 AMLL 模式支持对应设置。后续迁移需独立验证；
自研引擎有自己的实现，不依赖这份补丁。旧补丁可从提交 `0a46468` 查询，
但其 ESM 与 CommonJS 内容曾有差异，不能直接复制为新版实现。

## 升级流程

1. 确认实际安装版本、`pnpm-workspace.yaml` 的 `patchedDependencies` 以及锁文件匹配。
2. 检查新版 `setLyricLines` 的克隆与优化步骤是否保留私有字段，以及缓冲组是否仍与滚动锚点同步。
3. 对照新版 `createWord`、`updateMaskImageSync`、遮罩生成器和 `disposeElements`，
   确认 DOM 包含关系、尺寸测量、动画数组所有权和释放流程。
4. 检查对齐 setter 是否会重新布局，以及重叠进入、退出、暂停切换时是否需要显式刷新。
5. 使用 `pnpm patch @applemusic-like-lyrics/core@<实际版本>` 创建编辑目录。
   在 ESM、CommonJS 和必要的 CSS 中同步迁移，再执行 `pnpm patch-commit <编辑目录>`；
   不手工修改生成的 patch hunk 或 hash。
6. 运行 `pnpm typecheck`、`pnpm test` 并重新构建渲染产物。
   `amll-regression.spec.ts` 覆盖双层遮罩、ruby、缺失发音、零时长、动画释放、发音空格及缓冲锚点切换；
   `engine/seek-ghost.spec.ts` 覆盖自研引擎的重叠抬高与背景行排除，`engine/pronunciation-spacing.spec.ts` 验证发音 DOM 排版。
   `ttmlImport.spec.ts`、`localLyricRepo.spec.ts`、`LyricOptimizeDialog.spec.ts` 分别检查 TTML 空格往返、词库回退和编辑页签保存。
7. 使用真实 Electron 检查宽窄发音、强调、ruby、换行、缩放、跳转、暂停与隐藏恢复，
   并按 `AGENTS.md` 要求采样内存。DOM 测试的尺寸和动画是模拟值，不能替代视觉验收。

`lyric-kit` 补丁扩展声明中的语言集合，允许传递 `yue / und-Hani`，
并修正逐字发音对齐时的空白词占用与结束边界误配，不改写运行时的语言判断。
应用展示仍采用本分支的保守语言识别与中文发音过滤。

### 2026-09-13 裁切修复补充

- Electron 120 行隔离夹具复现强调字顶部裁切，扩展独立遮罩并关闭行级绘制裁切后显示完整；文字内容宽度与排版位置不变。
- 前后初始 DOM 节点均为 126、动画均为 72；长距离跳转后均为 164 / 96，销毁后播放器节点为 0。
- 各运行 60 秒的 Browser / GPU / Tab 工作集约为 98 / 167 / 243MB 与 99 / 158 / 233MB。
  这是离屏 Electron 夹具的单次样本，不代表完整应用内存或长期性能结论。
- 强制音节分隔覆盖 CJK 手工分隔、原文等价优先、非 CJK 边界空格、独立空白词元及暂停时切换恢复。
- 呼吸点夹具确认多行前句不再把圆点推向下方；逻辑坐标测试覆盖顶部、居中、底部锚点与正常播放/seek 一致性。
- 最终 Vitest 258 项、Node/Web 类型检查、修改文件 ESLint 和 `electron-vite build` 通过；未执行 Rust 原生构建及完整应用打包。

### 2026-09-12 历史验证

## Git 提交 Hook

上游新增 Husky 和 lint-staged，`prepare` 初始化 `core.hooksPath=.husky/_`。
`.husky/pre-commit` 对暂存代码运行 ESLint 修复和 Prettier，文档及配置运行 Prettier。
使用项目锁定的 Node 24 与 pnpm 12；不要通过跳过 Hook 完成同步提交。
生成的依赖补丁不能手工改 hunk 或 hash，也不应按普通源码格式化。

## 升级与验证

1. 拉取上游并记录目标提交，保留合并前的本地特性与可恢复引用
2. 对照实际安装版本、`patchedDependencies` 和锁文件，检查私有字段经过克隆、优化后仍存在
3. 检查 DOM 包含关系、尺寸测量、animator 释放和时间线快照协议
4. 通过 `pnpm patch` 编辑实际版本，再执行 `pnpm patch-commit`；同步 ESM、CommonJS、声明和 CSS
5. 运行 `pnpm typecheck`、`pnpm test`、`pnpm lint` 和 `pnpm exec electron-vite build`
6. 用真实 Electron 检查 ruby、宽窄发音、强调、换行、跳转、暂停与资源销毁，记录 60 秒内存样本
7. 提交前对全部纳入提交的可格式化文件执行 Prettier，并让提交 Hook 正常运行

### 2026-10-26 验证范围

合并前：Node 45 项、Vitest 258 项、Node/Web 类型检查通过。
合并后：Node 66 项、Vitest 705 项、Node/Web 类型、全仓 ESLint 与生产构建通过。
其中设置迁移回归覆盖旧总开关、分项关闭与再次恢复配置。

真实 Electron 对照夹具同时渲染 AMLL 与默认引擎，各加载 120 行，包含 ruby、
宽发音、强调与对唱。暂停前后帧计数相同，销毁后两套播放器节点和动画均为 0。
60 秒 Browser/GPU/Tab 工作集约为 110/118/160 MB 与 102/123/176 MB。
新版最终持有 338 个动画，基线 166 个，视口内构建量和布局也不同，因此不能据此断言内存无回归。
夹具窗口未显示，RAF 约 1Hz；此样本只用于常驻资源与释放对照，不代表完整播放器前台负载。
已尝试 `pnpm test:native`，在编译依赖 `signalsmith-stretch / ffmpeg_audio_sys` 时
因本机缺少 `libclang` 中断，音频引擎尚未执行到 Rust 测试用例。
单独运行其余三个原生 crate 的测试命令通过：音频捕获和任务栏模块编译成功，
媒体控制模块的 Discord 关闭/重启测试通过。
未执行安装包构建及完整应用的 10 分钟内存验收。

0.5.2 的历史实现与验收记录可从合并前提交 `d9e1735f` 查询。

## 2026-10-29 问题反馈维护

### 非连续高亮

AMLL 0.6.0 的布局把首个锚点到最后高亮行之间的全部行视为激活，
当一条长行覆盖多条短行时，已经结束的中间行也会进入渐变高亮模式。
补丁改为只消费时间线的 `highlightedGroups`，ESM 和 CommonJS 同步修正。
正常播放与跳转均覆盖此场景，真实重叠行继续允许同时高亮。
上游在短暂空隙中保留上一行高亮的规则保持不变，原始歌词的行结束时间也不被改写。

### QQ 音乐逐字发音

QQ 的正文与发音格式独立识别，不能把正文的 QRC/LRC 格式直接赋给音译。
已有缓存读取时修正音译格式，无需清空整个歌词缓存。
QRC/XML 和纯文本 QRC 发音先按行时间配对，再复用 lyric-kit 按音节区间写入 `romanWord`，
支持一个正文词对应多个罗马音音节，同时保留逐行 `romanLyric`、ruby 和正文原时间。
逐行 LRC 发音仅作为副行展示，不拆成伪造的逐字时间。

参考文件中的正文、音译均为 66 行，音译与正文存在 1ms 误差和不同分词。
实测写入 660 个带字母或数字词的发音，201 个 ruby 词的内容与正文时间保持不变。
未写入发音的 46 个词是 41 个片头元数据字和 5 个音译源未单独标记的小假名。
对齐时跳过纯空白正文与音译词，避免零时长空格消耗下一字的发音；
结束边界附近开始的音节留给下一字，避免缺少独立发音的小假名抢占后续音节。
音译源没有提供的音节保持为空，不复制相邻发音或生成拼音。

### TTML 与 LRCN 统一对唱规则

按用户选择统一采用 LRCN 的顺序规则，两种解析器共用 `src/utils/lyric/duet.ts`。
TTML 元数据仅提供 Agent 类型，不再把第一个 `person` 固定为主唱。

| 行为         | 统一规则                                    |
| ------------ | ------------------------------------------- |
| 首个普通声部 | Agent 为 `v2` 时右侧，否则左侧              |
| 后续普通声部 | 与上一普通 Agent 相同时保持方向，变化时翻转 |
| `group`      | 非对唱，不更新上一普通声部状态              |
| `other`      | 固定对唱，不更新上一普通声部状态            |
| 缺省 Agent   | 以 `undefined` 参与比较，可能导致翻转       |
| 背景行       | 继承所属主行方向，不更新普通声部状态        |

例如 `v1 → v2 → v3 → v1`：TTML 和 LRCN 都为左、右、左、右。
每首歌词独立创建方向状态，上一首的声部不会影响下一首。
两者最终只保留 `isDuet` 布尔值，没有独立的合唱居中状态。
AMLL 和默认引擎自动水平对齐时，非对唱行通常靠左、对唱行靠右；
默认引擎的显式水平对齐设置可以覆盖该布局。
对唱方向不决定高亮时间，多行是否同时播放仍由各行时间范围决定。

用户确认误高亮发生在 AMLL 且跨歌曲出现，回归测试覆盖 TTML、LRCN、QRC
解析后进入 AMLL 的实际高亮状态，以及正反跳转和更换歌词数据。
两种模块入口均检查结束行熄灭，同时保留合法重叠行的同时高亮。

### 本次验证与清理

66 项 Node 测试、756 项 Vitest 测试、全仓 ESLint、Node/Web 类型检查通过。
离线冻结锁文件安装与 electron-vite 生产构建通过。
AMLL 与 lyric-kit 的 ESM/CommonJS 入口均有行为回归覆盖。
用户提供的 QRC 文件已按完整内容解析，并逐词比对正文时间与 ruby 未被修改。

真实 Electron 同尺寸夹具连续运行 60 秒，修复前激活状态为 `[true,true,true,true]`，
修复后为 `[true,false,false,true]`，正常播放与强制跳转一致。
Browser/GPU/Tab 工作集分别约为 102/94/93 MB 与 102/98/93 MB；
两侧销毁后播放器子节点和动画均为 0，无渲染错误。
夹具窗口未显示，实测 RAF 约 1Hz，样本不代表完整播放器的前台负载或长期内存验收。

审计报告 `AUDIT_REPORT.md`、`audit/` 及对应的临时忽略项已清理。
本次补丁编辑目录、测试脚本、截图、夹具用户数据和日志在验证后删除，
保留正式依赖补丁、回归测试和此维护说明。
