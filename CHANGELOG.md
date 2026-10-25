# 0.4.0

- Localize added UI strings with Thunderbird’s standard WebExtension i18n API. Support English, Simplified/Traditional Chinese, German, French, Spanish and Japanese; existing native menu labels remain native.
- Rename to Native Sort & Groups / 原生排序与分组; keep the add-on ID for upgrades.
- Add an original icon, MPL-2.0 license, public source/support links, privacy disclosure and reviewer notes.
- Make XPI builds reproducible with Python’s standard library and remove the redundant standalone model from the package.
- Verify native behavior with official English and Chinese Thunderbird UI and synthetic local messages.

# 0.3.0

- 发件域名成为普通排序字段，移除“实验视图”菜单项。
- 原生排序字段改为有序多选，按选择顺序显示 1、2、3…，移除后自动重编号。
- “按排序分组”独立控制平铺排序和多级分组；支持 16 个字段自由组合。
- 修复原生菜单刷新覆盖扩展状态，以及 checked="false" 仍有勾选属性的问题。
- 升降序、字段及分组开关按文件夹保存，保留原生话题模式和表格单列点击行为。
- 新增菜单反馈、任意四级 / 十六级、平铺排序、禁用后偏好恢复测试，并保留编辑与撤销回归。
- 多级能力仍使用内部扩展接口，未宣称是官方稳定原生多级排序 API。

# 0.2.0

- 选中日期 / 域名标题后，复用原生右侧摘要，并支持从摘要点击打开邮件。
- 统一虚拟选择到真实消息头 / URI / 索引的映射，支持混选、跨文件夹及重复选择去重。
- 恢复常用原生编辑和原生撤销；去掉统一只读拦截及提示条。
- 保留原生展开箭头与键盘交互，显式处理索引边界和原生后端通知。
- 保留默认折叠与来源按最新邮件时间倒序；刷新维护选择、焦点、滚动位置。
- 修复原生排序菜单事件冒泡、重启分组后错误恢复过时视图标志、选择高亮更新问题。
- 增加真实 Thunderbird 158.0.1 的鼠标 / 键盘、编辑 / 撤销、快速筛选、统一未读和禁用清理验收。
- 尚未开放列表拖拽、线程专属操作及选择带星标邮件；更多版本与真实 IMAP 并发尚未验证。
