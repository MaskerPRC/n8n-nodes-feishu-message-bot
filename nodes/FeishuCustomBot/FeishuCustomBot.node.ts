import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	INodeProperties,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { createHmac } from 'node:crypto';

const messageTypeOptions = [
	{ name: '文本 (Text)', value: 'text' },
	{ name: '富文本 (Post)', value: 'post' },
	{ name: '群名片 (Share Chat)', value: 'share_chat' },
	{ name: '图片 (Image)', value: 'image' },
	{ name: '消息卡片 (Interactive Card)', value: 'interactive' },
];

const showForText = { messageType: ['text'] };
const showForPost = { messageType: ['post'] };
const showForShareChat = { messageType: ['share_chat'] };
const showForImage = { messageType: ['image'] };
const showForInteractive = { messageType: ['interactive'] };

const postElementTypeOptions = [
	{ name: '文本', value: 'text' },
	{ name: '超链接', value: 'a' },
	{ name: '@用户', value: 'at' },
	{ name: '图片', value: 'img' },
];

const cardModeOptions = [
	{ name: '简单模式（标题 + 正文 + 按钮）', value: 'simple' },
	{ name: '高级模式（完整 JSON）', value: 'raw' },
];

function toArray<T>(v: T[] | Record<string, T> | undefined): T[] {
	if (!v) return [];
	if (Array.isArray(v)) return v;
	return Object.keys(v)
		.sort((a, b) => Number(a) - Number(b))
		.map((k) => (v as Record<string, T>)[k]);
}

function buildPostContent(paragraphs: Array<{ elements?: Array<Record<string, unknown>> | Record<string, Record<string, unknown>> }>): unknown[][] {
	if (!paragraphs || !Array.isArray(paragraphs)) return [[]];
	return paragraphs.map((para) => {
		const elements = toArray(para.elements as Array<Record<string, unknown>> | Record<string, Record<string, unknown>> | undefined);
		if (!elements.length) return [];
		return elements
			.filter((el) => el?.elementType)
			.map((el) => {
				const tag = el.elementType as string;
				if (tag === 'text') {
					return { tag: 'text', text: el.text ?? '' };
				}
				if (tag === 'a') {
					return {
						tag: 'a',
						text: el.linkText ?? '',
						href: el.href ?? '',
					};
				}
				if (tag === 'at') {
					const atEl: Record<string, unknown> = { tag: 'at', user_id: el.userId ?? 'all' };
					if (el.userName) atEl.user_name = el.userName;
					return atEl;
				}
				if (tag === 'img') {
					return { tag: 'img', image_key: el.imageKey ?? '' };
				}
				return { tag: 'text', text: String(el.text ?? '') };
			});
	});
}

function buildRequestBody(
	messageType: string,
	params: Record<string, unknown>,
): Record<string, unknown> {
	if (messageType === 'text') {
		return {
			msg_type: 'text',
			content: { text: params.text ?? '' },
		};
	}
	if (messageType === 'share_chat') {
		return {
			msg_type: 'share_chat',
			content: { share_chat_id: params.shareChatId ?? '' },
		};
	}
	if (messageType === 'image') {
		return {
			msg_type: 'image',
			content: { image_key: params.imageKey ?? '' },
		};
	}
	if (messageType === 'post') {
		const lang = (params.postLanguage as string) || 'zh_cn';
		const title = (params.postTitle as string) || '';
		const rawParagraphs = params.postParagraphs;
		const paragraphs = toArray(
			Array.isArray(rawParagraphs)
				? rawParagraphs
				: rawParagraphs && typeof rawParagraphs === 'object'
					? (rawParagraphs as Record<string, { elements?: unknown }>)
					: [],
		) as Array<{ elements?: Array<Record<string, unknown>> | Record<string, Record<string, unknown>> }>;
		const content = buildPostContent(paragraphs);
		const postBlock: Record<string, unknown> = { title, content };
		const post: Record<string, unknown> = {};
		if (lang === 'zh_cn' || lang === 'both') post.zh_cn = postBlock;
		if (lang === 'en_us' || lang === 'both') post.en_us = { ...postBlock };
		return {
			msg_type: 'post',
			content: { post },
		};
	}
	if (messageType === 'interactive') {
		const cardMode = (params.cardMode as string) || 'simple';
		if (cardMode === 'raw') {
			const rawCard = params.cardJson as string;
			let card: Record<string, unknown>;
			try {
				card = typeof rawCard === 'string' ? JSON.parse(rawCard) : (rawCard as Record<string, unknown>);
			} catch {
				card = {};
			}
			return { msg_type: 'interactive', card };
		}
		// Simple card: header + one div (lark_md) + optional action button
		const headerTitle = (params.cardHeaderTitle as string) || '';
		const bodyMarkdown = (params.cardBodyMarkdown as string) || '';
		const buttonText = (params.cardButtonText as string) || '';
		const buttonUrl = (params.cardButtonUrl as string) || '';
		const elements: Record<string, unknown>[] = [];
		if (bodyMarkdown) {
			elements.push({
				tag: 'div',
				text: { tag: 'lark_md', content: bodyMarkdown },
			});
		}
		if (buttonText && buttonUrl) {
			elements.push({
				tag: 'action',
				actions: [
					{
						tag: 'button',
						text: { content: buttonText, tag: 'plain_text' },
						url: buttonUrl,
						type: 'default',
						value: {},
					},
				],
			});
		}
		return {
			msg_type: 'interactive',
			card: {
				header: headerTitle
					? { title: { tag: 'plain_text', content: headerTitle } }
					: undefined,
				elements: elements.length ? elements : [{ tag: 'div', text: { tag: 'plain_text', content: ' ' } }],
			},
		};
	}
	return {};
}

function genSign(secret: string, timestamp: number): string {
	const stringToSign = `${timestamp}\n${secret}`;
	const hmac = createHmac('sha256', stringToSign);
	hmac.update('');
	return hmac.digest('base64');
}

const properties: INodeProperties[] = [
	{
		displayName: 'Webhook 地址',
		name: 'webhookUrl',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxx',
		description: '自定义机器人的 Webhook 地址，从群设置 → 群机器人 → 自定义机器人中获取',
	},
	{
		displayName: '签名密钥',
		name: 'signSecret',
		type: 'string',
		typeOptions: { password: true },
		default: '',
		description: '若在飞书中开启了「签名校验」安全设置，请填写此处，请求将自动携带 timestamp 与 sign',
	},
	{
		displayName: '消息类型',
		name: 'messageType',
		type: 'options',
		options: messageTypeOptions,
		default: 'text',
		description: '要发送的消息类型',
	},
	// --- 文本 ---
	{
		displayName: '文本内容',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		required: true,
		displayOptions: { show: showForText },
		description: '支持 &lt;at user_id="ou_xxx"&gt;名字&lt;/at&gt; @人，&lt;at user_id="all"&gt;所有人&lt;/at&gt; @所有人',
	},
	// --- 富文本 ---
	{
		displayName: '语言',
		name: 'postLanguage',
		type: 'options',
		options: [
			{ name: '中文', value: 'zh_cn' },
			{ name: 'English', value: 'en_us' },
			{ name: '中英双语', value: 'both' },
		],
		default: 'zh_cn',
		displayOptions: { show: showForPost },
	},
	{
		displayName: '标题',
		name: 'postTitle',
		type: 'string',
		default: '',
		displayOptions: { show: showForPost },
	},
	{
		displayName: '段落与内容',
		name: 'postParagraphs',
		type: 'collection',
		typeOptions: {
			multipleValues: true,
			multipleValueButtonText: '添加段落',
		},
		displayOptions: { show: showForPost },
		default: {},
		options: [
			{
				displayName: '本段元素',
				name: 'elements',
				type: 'collection',
				typeOptions: {
					multipleValues: true,
					multipleValueButtonText: '添加元素',
				},
				default: {},
				options: [
					{
						displayName: '链接地址',
						name: 'href',
						type: 'string',
						default: '',
						displayOptions: { show: { elementType: ['a'] } },
					},
					{
						displayName: '链接文字',
						name: 'linkText',
						type: 'string',
						default: '',
						displayOptions: { show: { elementType: ['a'] } },
					},
					{
						displayName: '图片 Key',
						name: 'imageKey',
						type: 'string',
						default: '',
						description: '通过上传图片接口获取',
						displayOptions: { show: { elementType: ['img'] } },
					},
					{
						displayName: '文本内容',
						name: 'text',
						type: 'string',
						default: '',
						displayOptions: { show: { elementType: ['text'] } },
					},
					{
						displayName: '用户 Open ID',
						name: 'userId',
						type: 'string',
						default: 'all',
						description: '填 all 表示 @所有人',
						displayOptions: { show: { elementType: ['at'] } },
					},
					{
						displayName: '用户名称（展示用）',
						name: 'userName',
						type: 'string',
						default: '',
						displayOptions: { show: { elementType: ['at'] } },
					},
					{
						displayName: '元素类型',
						name: 'elementType',
						type: 'options',
						options: postElementTypeOptions,
						default: 'text',
					},
				],
			},
		],
	},
	// --- 群名片 ---
	{
		displayName: '群 ID',
		name: 'shareChatId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: showForShareChat },
		description: '要分享的群聊 ID（如 oc_xxx）',
	},
	// --- 图片 ---
	{
		displayName: '图片 Key',
		name: 'imageKey',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: showForImage },
		description: '通过上传图片接口获取的 image_key',
	},
	// --- 消息卡片 ---
	{
		displayName: '卡片配置方式',
		name: 'cardMode',
		type: 'options',
		options: cardModeOptions,
		default: 'simple',
		displayOptions: { show: showForInteractive },
	},
	{
		displayName: '卡片标题',
		name: 'cardHeaderTitle',
		type: 'string',
		default: '',
		displayOptions: {
			show: { messageType: ['interactive'], cardMode: ['simple'] } as { messageType: string[]; cardMode: string[] },
		},
	},
	{
		displayName: '卡片正文（Lark 语法）',
		name: 'cardBodyMarkdown',
		type: 'string',
		typeOptions: { rows: 5 },
		default: '',
		placeholder: '**粗体**、[链接](url)、&lt;at ID=ou_xxx&gt;&lt;/at&gt;',
		displayOptions: {
			show: { messageType: ['interactive'], cardMode: ['simple'] } as { messageType: string[]; cardMode: string[] },
		},
	},
	{
		displayName: '按钮文字',
		name: 'cardButtonText',
		type: 'string',
		default: '',
		displayOptions: {
			show: { messageType: ['interactive'], cardMode: ['simple'] } as { messageType: string[]; cardMode: string[] },
		},
	},
	{
		displayName: '按钮链接',
		name: 'cardButtonUrl',
		type: 'string',
		default: '',
		displayOptions: {
			show: { messageType: ['interactive'], cardMode: ['simple'] } as { messageType: string[]; cardMode: string[] },
		},
	},
	{
		displayName: '卡片 JSON',
		name: 'cardJson',
		type: 'string',
		typeOptions: { rows: 10 },
		default: '{\n  "header": { "title": { "tag": "plain_text", "content": "标题" } },\n  "elements": []\n}',
		displayOptions: {
			show: { messageType: ['interactive'], cardMode: ['raw'] } as { messageType: string[]; cardMode: string[] },
		},
		description: '与请求体中 card 字段对应的完整 JSON，可使用消息卡片搭建工具生成',
	},
];

export class FeishuCustomBot implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Feishu Custom Bot',
		name: 'feishuCustomBot',
		icon: 'file:feishu.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["messageType"]}}',
		description: '通过 Webhook 向飞书群发送文本、富文本、图片、群名片或消息卡片',
		defaults: { name: 'Feishu Custom Bot' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties,
		usableAsTool: true,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const results: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const webhookUrl = this.getNodeParameter('webhookUrl', i) as string;
				const signSecret = this.getNodeParameter('signSecret', i, '') as string;
				const messageType = this.getNodeParameter('messageType', i) as string;

				const params: Record<string, unknown> = {
					text: this.getNodeParameter('text', i, ''),
					shareChatId: this.getNodeParameter('shareChatId', i, ''),
					imageKey: this.getNodeParameter('imageKey', i, ''),
					postLanguage: this.getNodeParameter('postLanguage', i, 'zh_cn'),
					postTitle: this.getNodeParameter('postTitle', i, ''),
					postParagraphs: this.getNodeParameter('postParagraphs', i, []),
					cardMode: this.getNodeParameter('cardMode', i, 'simple'),
					cardHeaderTitle: this.getNodeParameter('cardHeaderTitle', i, ''),
					cardBodyMarkdown: this.getNodeParameter('cardBodyMarkdown', i, ''),
					cardButtonText: this.getNodeParameter('cardButtonText', i, ''),
					cardButtonUrl: this.getNodeParameter('cardButtonUrl', i, ''),
					cardJson: this.getNodeParameter('cardJson', i, ''),
				};

				let body = buildRequestBody(messageType, params) as Record<string, unknown>;

				if (signSecret) {
					const timestamp = Math.floor(Date.now() / 1000);
					body = {
						timestamp: String(timestamp),
						sign: genSign(signSecret, timestamp),
						...body,
					};
				}

				const response = await this.helpers.httpRequest({
					method: 'POST',
					url: webhookUrl,
					headers: { 'Content-Type': 'application/json' },
					body,
					json: true,
				});

				results.push({
					json: response as IDataObject,
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					results.push({
						json: { error: (error as Error).message } as IDataObject,
						pairedItem: { item: i },
					});
				} else {
					throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
				}
			}
		}

		return [results];
	}
}
