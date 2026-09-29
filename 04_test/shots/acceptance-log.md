# 预置资源文件夹分组 · 真实 UI 验收记录

- 方式：Tabbit（Playwright）新标签加载 http://127.0.0.1:3080/（拉取热重载后的新 client bundle），
  打开工作台「测试」项目 → 窗格工具行「预置资源」→ 实跑用户路径；每步以 aria snapshot + localStorage 断言验证。
- 时间：2026-09-29；插件 dsh-worktable v0.3.6。

## 步骤与断言

| # | 动作 | 断言结果 |
|---|------|----------|
| 1 | 头部出现「＋ 文件夹」「＋ 新增条目」与面包屑「根目录」 | aria snapshot 命中 ✅ |
| 2 | 弹窗新建文件夹「项目A」 | 行渲染「项目A 0」（计数徽标），截图 presets-folder-created.png，modlens 视觉复核通过 ✅ |
| 3 | 新增条目表单「所属文件夹」下拉 | options = [根目录, 项目A]，默认值 ""（根目录，随当前层）✅ |
| 4 | 保存条目「测试后台」(https://admin.example.com/login) | 根目录同时显示文件夹行与条目卡 ✅ |
| 5 | HTML5 拖拽条目卡 → 文件夹行 | localStorage：folderId root→"fmumv3b93j1zo"(项目A)；计数徽标 0→1；toast「已移动到「项目A」」✅ |
| 6 | 点击文件夹进入 | 面包屑「根目录 › 项目A」，条目卡在层内 ✅ |
| 7 | 层内新建「子B」 | 嵌套成功（folders: 子B parentId=项目A id），截图 presets-nested.png，modlens 视觉复核通过 ✅ |
| 8 | 拖拽条目 →「根目录」面包屑节点 | folderId 回 ""（移回根层）✅ |
| 9 | 两步确认删除：条目「删除?」、子B/项目A「删除（含 0 项）？」（连带计数文案） | 删除后 store 复位 {"entries":[],"folders":[]}，空态提示恢复 ✅ |

## 现场还原

- dsh.worktable.view.v1 写回验收前原始串（213 字节，逐字节一致 verified）
- dsh.worktable.presets.v1 removeItem（验收前为 null）
- Tabbit scratch 标签已关闭，用户标签全部保留（finish keep:true）

## 视觉证据

- presets-folder-created.png —— 文件夹创建态（reviewed via modlens）
- presets-nested.png —— 嵌套层级态：面包屑「根目录 › 项目A」、子B 行、层内条目卡（reviewed via modlens）
