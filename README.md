# n8n-nodes-feishu-message-bot

n8n 社区节点：通过飞书（Lark）自定义机器人 Webhook 向群聊发送消息。

## 功能

- **文本消息**：支持 @指定人、@所有人
- **富文本 (Post)**：多段落、文本/链接/@用户/图片元素
- **群名片**：分享群聊
- **图片**：通过 image_key 发送
- **消息卡片**：简单模式（标题+正文+按钮）或高级模式（完整 JSON）
- **签名校验**：可选，填写密钥后自动携带 timestamp 与 sign

## 安装

### 在 n8n 中安装

1. 打开 n8n：**设置** → **Community nodes** → **Install**
2. 输入包名：`n8n-nodes-feishu-message-bot`
3. 安装完成后，在节点列表中找到 **Feishu Custom Bot**

### 获取 Webhook 地址

1. 在飞书群聊中：**设置** → **群机器人** → **添加机器人** → **自定义机器人**
2. 设置名称与描述后添加，复制生成的 **Webhook 地址**
3. 若开启「签名校验」安全设置，复制**密钥**并填入节点的「签名密钥」参数

## 使用

1. 在流程中添加 **Feishu Custom Bot** 节点
2. 填写 **Webhook 地址**（必填）
3. 若机器人开启了签名校验，填写 **签名密钥**
4. 选择 **消息类型**，按类型填写对应内容（均为表单配置，无需手写 JSON）

## 开发

```bash
# 安装依赖
npm install

# 本地开发（启动 n8n 并监听节点变更）
npm run dev

# 构建
npm run build

# 代码检查
npm run lint
```

## 相关文档

- [飞书 - 自定义机器人使用指南](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)
- [支持发送的消息类型](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot#support-message-type)

## 许可证

[MIT](LICENSE.md)
