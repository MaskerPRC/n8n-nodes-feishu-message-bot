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
	{ name: '表单配置（卡片 2.0）', value: 'form' },
	{ name: '高级模式（完整 JSON）', value: 'raw' },
];

const card2WidthModeOptions = [
	{ name: '默认 (600px)', value: 'default' },
	{ name: '紧凑 (400px)', value: 'compact' },
	{ name: '撑满宽度', value: 'fill' },
];

const card2HeaderTemplateOptions = [
	{ name: 'Default', value: 'default' },
	{ name: 'Blue', value: 'blue' },
	{ name: 'Wathet', value: 'wathet' },
	{ name: 'Turquoise', value: 'turquoise' },
	{ name: 'Green', value: 'green' },
	{ name: 'Yellow', value: 'yellow' },
	{ name: 'Orange', value: 'orange' },
	{ name: 'Red', value: 'red' },
	{ name: 'Carmine', value: 'carmine' },
	{ name: 'Violet', value: 'violet' },
	{ name: 'Purple', value: 'purple' },
	{ name: 'Indigo', value: 'indigo' },
	{ name: 'Grey', value: 'grey' },
];

const card2BodyElementTypeOptions = [
	{ name: '富文本 Markdown (Markdown)', value: 'markdown' },
	{ name: '按钮 (Button)', value: 'button' },
	{ name: '图片 (Img)', value: 'img' },
	{ name: '分割线 (Hr)', value: 'hr' },
	{ name: '人员 (Person)', value: 'person' },
	{ name: '人员列表 (Person_list)', value: 'person_list' },
	{ name: '分栏 (Column_set)', value: 'column_set' },
	{ name: '交互容器 (Interactive_container)', value: 'interactive_container' },
	{ name: '折叠面板 (Collapsible_panel)', value: 'collapsible_panel' },
	{ name: '表单容器 (Form)', value: 'form' },
];

const showCardForm = {
	messageType: ['interactive'],
	cardMode: ['form'],
} as { messageType: string[]; cardMode: string[] };

function toArray<T>(v: T[] | Record<string, T> | undefined): T[] {
	if (!v) return [];
	if (Array.isArray(v)) return v;
	return Object.keys(v)
		.sort((a, b) => Number(a) - Number(b))
		.map((k) => (v as Record<string, T>)[k]);
}

/** 构建卡片 2.0 单个简单元素（含 person / person_list），支持 elementType / col_elType / c_elType */
function buildCard2SimpleElement(el: Record<string, unknown>): Record<string, unknown> {
	const tag = (el.elementType ?? el.col_elType ?? el.c_elType) as string;
	const out: Record<string, unknown> = {};
	if (el.element_id && String(el.element_id).trim()) out.element_id = String(el.element_id).trim();
	if (tag === 'plain_text' || tag === 'markdown') {
		out.tag = 'markdown';
		out.content = String(el.content ?? '');
		return out;
	}
	if (tag === 'button') {
		out.tag = 'button';
		out.text = { tag: 'plain_text', content: String(el.button_text ?? '') };
		out.url = String(el.button_url ?? '');
		out.type = el.button_type || 'default';
		return out;
	}
	if (tag === 'img') {
		out.tag = 'img';
		out.img_key = el.img_key ?? '';
		return out;
	}
	if (tag === 'hr') {
		out.tag = 'hr';
		return out;
	}
	if (tag === 'person') {
		out.tag = 'person';
		out.user_id = el.user_id ?? '';
		if (el.person_size) out.size = el.person_size;
		if (el.person_show_avatar != null) out.show_avatar = Boolean(el.person_show_avatar);
		if (el.person_show_name != null) out.show_name = Boolean(el.person_show_name);
		if (el.person_style) out.style = el.person_style;
		if (el.person_margin && String(el.person_margin).trim()) out.margin = String(el.person_margin).trim();
		return out;
	}
	if (tag === 'person_list') {
		out.tag = 'person_list';
		const rawPersons = toArray(el.person_list_ids as Array<Record<string, unknown>> | Record<string, Record<string, unknown>> | undefined);
		out.persons = rawPersons
			.filter((p) => p && (p.id != null && String(p.id).trim() !== ''))
			.map((p) => ({ id: String(p.id).trim() }));
		if (el.person_list_size) out.size = el.person_list_size;
		if (el.person_list_show_avatar != null) out.show_avatar = Boolean(el.person_list_show_avatar);
		if (el.person_list_show_name != null) out.show_name = Boolean(el.person_list_show_name);
		if (el.person_list_lines != null && Number(el.person_list_lines) > 0) out.lines = Number(el.person_list_lines);
		if (el.person_list_drop_invalid != null) out.drop_invalid_user_id = Boolean(el.person_list_drop_invalid);
		if (el.person_list_margin && String(el.person_list_margin).trim()) out.margin = String(el.person_list_margin).trim();
		if (el.person_list_icon_token && String(el.person_list_icon_token).trim()) {
			const iconObj: Record<string, unknown> = {
				tag: 'standard_icon',
				token: String(el.person_list_icon_token).trim(),
			};
			if (el.person_list_icon_color && String(el.person_list_icon_color).trim())
				iconObj.color = String(el.person_list_icon_color).trim();
			out.icon = iconObj;
		} else if (el.person_list_icon_img_key && String(el.person_list_icon_img_key).trim()) {
			out.icon = {
				tag: 'custom_icon',
				img_key: String(el.person_list_icon_img_key).trim(),
			};
		}
		return out;
	}
	return out;
}

const CARD2_CONTAINER_TAGS = ['column_set', 'interactive_container', 'collapsible_panel', 'form'];

/** 从集合构建卡片 2.0 元素数组（支持简单类型与容器递归） */
function buildCard2Elements(
	raw: Array<Record<string, unknown>> | Record<string, Record<string, unknown>> | undefined,
): Record<string, unknown>[] {
	const arr = toArray(raw);
	return arr
		.filter((el) => el && (el.elementType || el.col_elType || el.c_elType))
		.map((el) => {
			const tag = el.elementType as string | undefined;
			if (tag && CARD2_CONTAINER_TAGS.includes(tag)) return buildCard2Element(el);
			return buildCard2SimpleElement(el);
		});
}

/** 表单容器内子元素构建（按钮可带 form_action_type、name） */
function buildCard2FormElements(
	raw: Array<Record<string, unknown>> | Record<string, Record<string, unknown>> | undefined,
): Record<string, unknown>[] {
	const arr = toArray(raw);
	return arr
		.filter((el) => el && (el.elementType || el.col_elType || el.c_elType))
		.map((el) => {
			const tag = (el.elementType ?? el.c_elType) as string | undefined;
			if (tag && CARD2_CONTAINER_TAGS.includes(tag)) return buildCard2Element(el);
			const out = buildCard2SimpleElement(el);
			if (out.tag === 'button') {
				if (el.form_action_type) out.form_action_type = el.form_action_type;
				if (el.form_button_name != null && String(el.form_button_name).trim())
					out.name = String(el.form_button_name).trim();
			}
			return out;
		});
}

/** 构建卡片 2.0 单个 body 元素（含容器） */
function buildCard2Element(el: Record<string, unknown>): Record<string, unknown> {
	const tag = el.elementType as string;
	const out: Record<string, unknown> = {};
	if (el.element_id && String(el.element_id).trim()) out.element_id = String(el.element_id).trim();

	if (tag === 'column_set') {
		out.tag = 'column_set';
		if (el.flex_mode) out.flex_mode = el.flex_mode;
		if (el.horizontal_spacing) out.horizontal_spacing = el.horizontal_spacing;
		if (el.horizontal_align) out.horizontal_align = el.horizontal_align;
		if (el.margin) out.margin = el.margin;
		if (el.background_style) out.background_style = el.background_style;
		const rawColumns = toArray(el.columns as Array<Record<string, unknown>> | undefined);
		out.columns = rawColumns.map((col) => {
			const column: Record<string, unknown> = { tag: 'column' };
			if (col.column_width) column.width = col.column_width;
			if (col.column_weight != null) column.weight = Number(col.column_weight) || 1;
			if (col.vertical_align) column.vertical_align = col.vertical_align;
			if (col.vertical_spacing) column.vertical_spacing = col.vertical_spacing;
			if (col.direction) column.direction = col.direction;
			if (col.padding) column.padding = col.padding;
			if (col.margin) column.margin = col.margin;
			if (col.background_style) column.background_style = col.background_style;
			column.elements = buildCard2Elements(col.column_elements as Array<Record<string, unknown>> | undefined);
			return column;
		});
		return out;
	}

	if (tag === 'interactive_container') {
		out.tag = 'interactive_container';
		if (el.container_width) out.width = el.container_width;
		if (el.direction) out.direction = el.direction;
		if (el.horizontal_spacing) out.horizontal_spacing = el.horizontal_spacing;
		if (el.horizontal_align) out.horizontal_align = el.horizontal_align;
		if (el.vertical_align) out.vertical_align = el.vertical_align;
		if (el.vertical_spacing) out.vertical_spacing = el.vertical_spacing;
		if (el.background_style) out.background_style = el.background_style;
		if (el.has_border != null) out.has_border = Boolean(el.has_border);
		if (el.border_color) out.border_color = el.border_color;
		if (el.padding) out.padding = el.padding;
		if (el.corner_radius) out.corner_radius = el.corner_radius;
		const behaviors: Record<string, unknown>[] = [];
		if (el.action_type === 'open_url' && el.action_url) {
			behaviors.push({
				type: 'open_url',
				default_url: el.action_url,
				pc_url: el.action_pc_url || el.action_url,
				ios_url: el.action_ios_url || el.action_url,
				android_url: el.action_android_url || el.action_url,
			});
		}
		if (el.action_type === 'callback' && el.callback_value != null) {
			try {
				const value = typeof el.callback_value === 'string' ? JSON.parse(el.callback_value as string) : el.callback_value;
				behaviors.push({ type: 'callback', value });
			} catch {
				behaviors.push({ type: 'callback', value: {} });
			}
		}
		if (behaviors.length) out.behaviors = behaviors;
		out.elements = buildCard2Elements(el.container_elements as Array<Record<string, unknown>> | undefined);
		return out;
	}

	if (tag === 'collapsible_panel') {
		out.tag = 'collapsible_panel';
		if (el.panel_expanded != null) out.expanded = Boolean(el.panel_expanded);
		if (el.panel_header_title != null && String(el.panel_header_title).trim()) {
			const header: Record<string, unknown> = {
				title: { tag: 'plain_text', content: String(el.panel_header_title).trim() },
			};
			if (el.panel_header_background_color) header.background_color = el.panel_header_background_color;
			out.header = header;
		}
		if (el.panel_background_color) out.background_color = el.panel_background_color;
		if (el.panel_border_color || el.panel_border_corner_radius) {
			const border: Record<string, unknown> = {};
			if (el.panel_border_color) border.color = el.panel_border_color;
			if (el.panel_border_corner_radius) border.corner_radius = el.panel_border_corner_radius;
			out.border = border;
		}
		out.elements = buildCard2Elements(el.container_elements as Array<Record<string, unknown>> | undefined);
		return out;
	}

	if (tag === 'form') {
		out.tag = 'form';
		if (el.form_name) out.name = String(el.form_name);
		out.elements = buildCard2FormElements(el.container_elements as Array<Record<string, unknown>> | undefined);
		return out;
	}

	// 简单类型
	return buildCard2SimpleElement(el);
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
		if (cardMode === 'form') {
			// Card JSON 2.0 表单配置
			const card: Record<string, unknown> = { schema: '2.0' };
			const config: Record<string, unknown> = { update_multi: true };
			if (params.card2_config_summary != null && String(params.card2_config_summary).trim() !== '') {
				config.summary = { content: String(params.card2_config_summary).trim() };
			}
			if (params.card2_config_width_mode) {
				config.width_mode = params.card2_config_width_mode;
			}
			if (params.card2_config_enable_forward !== undefined) {
				config.enable_forward = Boolean(params.card2_config_enable_forward);
			}
			card.config = config;

			const cardLink: Record<string, string> = {};
			if (params.card2_card_link_url) cardLink.url = String(params.card2_card_link_url);
			if (params.card2_card_link_pc_url) cardLink.pc_url = String(params.card2_card_link_pc_url);
			if (params.card2_card_link_ios_url) cardLink.ios_url = String(params.card2_card_link_ios_url);
			if (params.card2_card_link_android_url) cardLink.android_url = String(params.card2_card_link_android_url);
			if (Object.keys(cardLink).length) card.card_link = cardLink;

			const headerTitle = (params.card2_header_title as string) || '';
			if (headerTitle) {
				const header: Record<string, unknown> = {
					title: { tag: 'plain_text', content: headerTitle },
				};
				if (params.card2_header_subtitle) {
					header.subtitle = {
						tag: 'plain_text',
						content: String(params.card2_header_subtitle),
					};
				}
				if (params.card2_header_template && params.card2_header_template !== 'default') {
					header.template = params.card2_header_template;
				}
				card.header = header;
			}

			const body: Record<string, unknown> = {
				direction: params.card2_body_direction || 'vertical',
			};
			if (params.card2_body_padding) body.padding = String(params.card2_body_padding);
			const rawElements = params.card2_body_elements;
			const elementsArr = toArray(
				Array.isArray(rawElements)
					? rawElements
					: rawElements && typeof rawElements === 'object'
						? (rawElements as Record<string, Record<string, unknown>>)
						: [],
			) as Array<Record<string, unknown>>;
			body.elements = elementsArr.filter((el) => el?.elementType).map(buildCard2Element);
			if ((body.elements as unknown[]).length === 0) body.elements = [{ tag: 'markdown', content: ' ' }];
			card.body = body;
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
	// --- 卡片 2.0 表单 ---
	{
		displayName: '摘要（聊天栏预览文案）',
		name: 'card2_config_summary',
		type: 'string',
		default: '',
		displayOptions: { show: showCardForm },
		description: 'Config.summary.content，自定义聊天栏消息预览文案',
	},
	{
		displayName: '卡片宽度',
		name: 'card2_config_width_mode',
		type: 'options',
		options: card2WidthModeOptions,
		default: 'default',
		displayOptions: { show: showCardForm },
	},
	{
		displayName: '允许转发',
		name: 'card2_config_enable_forward',
		type: 'boolean',
		default: true,
		displayOptions: { show: showCardForm },
	},
	{
		displayName: '卡片整体跳转链接',
		name: 'card2_card_link_url',
		type: 'string',
		default: '',
		displayOptions: { show: showCardForm },
		description: '点击卡片跳转的默认链接',
	},
	{
		displayName: 'PC 端链接',
		name: 'card2_card_link_pc_url',
		type: 'string',
		default: '',
		displayOptions: { show: showCardForm },
	},
	{
		displayName: 'iOS 端链接',
		name: 'card2_card_link_ios_url',
		type: 'string',
		default: '',
		displayOptions: { show: showCardForm },
	},
	{
		displayName: 'Android 端链接',
		name: 'card2_card_link_android_url',
		type: 'string',
		default: '',
		displayOptions: { show: showCardForm },
	},
	{
		displayName: '标题',
		name: 'card2_header_title',
		type: 'string',
		default: '',
		displayOptions: { show: showCardForm },
	},
	{
		displayName: '副标题',
		name: 'card2_header_subtitle',
		type: 'string',
		default: '',
		displayOptions: { show: showCardForm },
	},
	{
		displayName: '标题主题',
		name: 'card2_header_template',
		type: 'options',
		options: card2HeaderTemplateOptions,
		default: 'default',
		displayOptions: { show: showCardForm },
	},
	{
		displayName: '正文排列方向',
		name: 'card2_body_direction',
		type: 'options',
		options: [
			{ name: '垂直', value: 'vertical' },
			{ name: '水平', value: 'horizontal' },
		],
		default: 'vertical',
		displayOptions: { show: showCardForm },
	},
	{
		displayName: '正文内边距',
		name: 'card2_body_padding',
		type: 'string',
		default: '',
		placeholder: '12px 8px 12px 8px',
		displayOptions: { show: showCardForm },
	},
	{
		displayName: '正文元素',
		name: 'card2_body_elements',
		type: 'collection',
		typeOptions: {
			multipleValues: true,
			multipleValueButtonText: '添加元素',
		},
		displayOptions: { show: showCardForm },
		default: {},
		options: [
			{
				displayName: '按钮链接',
				name: 'button_url',
				type: 'string',
				default: '',
				displayOptions: { show: { elementType: ['button'] } },
			},
			{
				displayName: '按钮文字',
				name: 'button_text',
				type: 'string',
				default: '',
				displayOptions: { show: { elementType: ['button'] } },
			},
			{
				displayName: '按钮样式',
				name: 'button_type',
				type: 'options',
				options: [
					{ name: 'Default', value: 'default' },
					{ name: 'Primary', value: 'primary' },
					{ name: 'Danger', value: 'danger' },
				],
				default: 'default',
				displayOptions: { show: { elementType: ['button'] } },
			},
			{
				displayName: '内容',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				displayOptions: { show: { elementType: ['markdown'] } },
			},
			{
				displayName: '图片 Key',
				name: 'img_key',
				type: 'string',
				default: '',
				displayOptions: { show: { elementType: ['img'] } },
			},
			{
				displayName: '元素 ID',
				name: 'element_id',
				type: 'string',
				default: '',
				description: 'Element_id，同一卡片内唯一，字母/数字/下划线，以字母开头，最多 20 字符',
			},
			{
				displayName: '元素类型',
				name: 'elementType',
				type: 'options',
				options: card2BodyElementTypeOptions,
				default: 'markdown',
			},
			// --- 人员 person ---
			{
				displayName: '用户 ID',
				name: 'user_id',
				type: 'string',
				default: '',
				description: '人员的 Open ID / User ID / Union ID',
				displayOptions: { show: { elementType: ['person'] } },
			},
			{
				displayName: '头像尺寸',
				name: 'person_size',
				type: 'options',
				options: [
					{ name: 'Extra_small', value: 'extra_small' },
					{ name: 'Large', value: 'large' },
					{ name: 'Medium', value: 'medium' },
					{ name: 'Small', value: 'small' },
				],
				default: 'medium',
				displayOptions: { show: { elementType: ['person'] } },
			},
			{
				displayName: '显示头像',
				name: 'person_show_avatar',
				type: 'boolean',
				default: true,
				displayOptions: { show: { elementType: ['person'] } },
			},
			{
				displayName: '显示用户名',
				name: 'person_show_name',
				type: 'boolean',
				default: false,
				displayOptions: { show: { elementType: ['person'] } },
			},
			{
				displayName: '展示样式',
				name: 'person_style',
				type: 'options',
				options: [
					{ name: 'Capsule (胶囊)', value: 'capsule' },
					{ name: 'Normal (默认)', value: 'normal' },
				],
				default: 'normal',
				displayOptions: { show: { elementType: ['person'] } },
			},
			{
				displayName: '外边距',
				name: 'person_margin',
				type: 'string',
				default: '',
				placeholder: '0px 0px 0px 0px',
				displayOptions: { show: { elementType: ['person'] } },
			},
			// --- 人员列表 person_list ---
			{
				displayName: '人员列表',
				name: 'person_list_ids',
				type: 'collection',
				typeOptions: { multipleValues: true, multipleValueButtonText: '添加人员' },
				default: {},
				displayOptions: { show: { elementType: ['person_list'] } },
				options: [
					{
						displayName: '用户 ID',
						name: 'id',
						type: 'string',
						default: '',
						description: 'Open ID / User ID / Union ID',
					},
				],
			},
			{
				displayName: '头像尺寸',
				name: 'person_list_size',
				type: 'options',
				options: [
					{ name: 'Extra_small', value: 'extra_small' },
					{ name: 'Large', value: 'large' },
					{ name: 'Medium', value: 'medium' },
					{ name: 'Small', value: 'small' },
				],
				default: 'medium',
				displayOptions: { show: { elementType: ['person_list'] } },
			},
			{
				displayName: '显示头像',
				name: 'person_list_show_avatar',
				type: 'boolean',
				default: true,
				displayOptions: { show: { elementType: ['person_list'] } },
			},
			{
				displayName: '显示用户名',
				name: 'person_list_show_name',
				type: 'boolean',
				default: true,
				displayOptions: { show: { elementType: ['person_list'] } },
			},
			{
				displayName: '最大显示行数',
				name: 'person_list_lines',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 0,
				description: '0 表示不限制',
				displayOptions: { show: { elementType: ['person_list'] } },
			},
			{
				displayName: '忽略无效用户 ID',
				name: 'person_list_drop_invalid',
				type: 'boolean',
				default: false,
				displayOptions: { show: { elementType: ['person_list'] } },
			},
			{
				displayName: '外边距',
				name: 'person_list_margin',
				type: 'string',
				default: '',
				placeholder: '0px 0px 0px 0px',
				displayOptions: { show: { elementType: ['person_list'] } },
			},
			{
				displayName: '前缀图标 Token',
				name: 'person_list_icon_token',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description: '图标库 token，与自定义图片二选一',
				displayOptions: { show: { elementType: ['person_list'] } },
			},
			{
				displayName: '前缀图标颜色',
				name: 'person_list_icon_color',
				type: 'color',
				default: '',
				placeholder: 'blue',
				displayOptions: { show: { elementType: ['person_list'] } },
			},
			{
				displayName: '前缀图标图片 Key',
				name: 'person_list_icon_img_key',
				type: 'string',
				default: '',
				description: '自定义图标时使用，与 Token 二选一',
				displayOptions: { show: { elementType: ['person_list'] } },
			},
			// --- 分栏 column_set ---
			{
				displayName: '列配置',
				name: 'columns',
				type: 'collection',
				typeOptions: { multipleValues: true, multipleValueButtonText: '添加列' },
				default: {},
				displayOptions: { show: { elementType: ['column_set'] } },
				options: [
					{
						displayName: '列内元素',
						name: 'column_elements',
						type: 'collection',
						typeOptions: { multipleValues: true, multipleValueButtonText: '添加元素' },
						default: {},
						options: [
							{ displayName: '内容', name: 'content', type: 'string', typeOptions: { rows: 2 }, default: '', displayOptions: { show: { col_elType: ['markdown'] } } },
							{ displayName: '元素类型', name: 'col_elType', type: 'options', options: [{ name: 'Button', value: 'button' }, { name: 'Hr', value: 'hr' }, { name: 'Img', value: 'img' }, { name: 'Markdown', value: 'markdown' }, { name: 'Person', value: 'person' }, { name: 'Person_list', value: 'person_list' }], default: 'markdown' },
							{ displayName: '按钮链接', name: 'button_url', type: 'string', default: '', displayOptions: { show: { col_elType: ['button'] } } },
							{ displayName: '按钮文字', name: 'button_text', type: 'string', default: '', displayOptions: { show: { col_elType: ['button'] } } },
							{ displayName: '按钮样式', name: 'button_type', type: 'options', options: [{ name: 'Default', value: 'default' }, { name: 'Primary', value: 'primary' }, { name: 'Danger', value: 'danger' }], default: 'default', displayOptions: { show: { col_elType: ['button'] } } },
							{ displayName: '图片 Key', name: 'img_key', type: 'string', default: '', displayOptions: { show: { col_elType: ['img'] } } },
							{ displayName: '用户 ID', name: 'user_id', type: 'string', default: '', displayOptions: { show: { col_elType: ['person'] } } },
							{ displayName: '头像尺寸', name: 'person_size', type: 'options', options: [{ name: 'Extra_small', value: 'extra_small' }, { name: 'Large', value: 'large' }, { name: 'Medium', value: 'medium' }, { name: 'Small', value: 'small' }], default: 'medium', displayOptions: { show: { col_elType: ['person'] } } },
							{ displayName: '显示头像', name: 'person_show_avatar', type: 'boolean', default: true, displayOptions: { show: { col_elType: ['person'] } } },
							{ displayName: '显示用户名', name: 'person_show_name', type: 'boolean', default: false, displayOptions: { show: { col_elType: ['person'] } } },
							{ displayName: '展示样式', name: 'person_style', type: 'options', options: [{ name: 'Capsule (胶囊)', value: 'capsule' }, { name: 'Normal (默认)', value: 'normal' }], default: 'normal', displayOptions: { show: { col_elType: ['person'] } } },
							{ displayName: '人员列表', name: 'person_list_ids', type: 'collection', typeOptions: { multipleValues: true, multipleValueButtonText: '添加人员' }, default: {}, displayOptions: { show: { col_elType: ['person_list'] } }, options: [{ displayName: '用户 ID', name: 'id', type: 'string', default: '' }] },
							{ displayName: '列表头像尺寸', name: 'person_list_size', type: 'options', options: [{ name: 'Extra_small', value: 'extra_small' }, { name: 'Large', value: 'large' }, { name: 'Medium', value: 'medium' }, { name: 'Small', value: 'small' }], default: 'medium', displayOptions: { show: { col_elType: ['person_list'] } } },
							{ displayName: '列表显示头像', name: 'person_list_show_avatar', type: 'boolean', default: true, displayOptions: { show: { col_elType: ['person_list'] } } },
							{ displayName: '列表显示用户名', name: 'person_list_show_name', type: 'boolean', default: true, displayOptions: { show: { col_elType: ['person_list'] } } },
						],
					},
					{ displayName: '列宽', name: 'column_width', type: 'options', options: [{ name: 'Auto', value: 'auto' }, { name: 'Weighted', value: 'weighted' }], default: 'weighted' },
					{ displayName: '列权重', name: 'column_weight', type: 'number', typeOptions: { minValue: 1, maxValue: 5 }, default: 1 },
					{ displayName: '列垂直对齐', name: 'vertical_align', type: 'options', options: [{ name: 'Bottom', value: 'bottom' }, { name: 'Center', value: 'center' }, { name: 'Top', value: 'top' }], default: 'top' },
					{ displayName: '列垂直间距', name: 'vertical_spacing', type: 'options', options: [{ name: 'Extra_large (16px)', value: 'extra_large' }, { name: 'Large (12px)', value: 'large' }, { name: 'Medium (8px)', value: 'medium' }, { name: 'Small (4px)', value: 'small' }], default: 'medium' },
					{ displayName: '列排列方向', name: 'direction', type: 'options', options: [{ name: '水平', value: 'horizontal' }, { name: '垂直', value: 'vertical' }], default: 'vertical' },
					{ displayName: '列内边距', name: 'padding', type: 'string', default: '', placeholder: '8px' },
					{ displayName: '列外边距', name: 'margin', type: 'string', default: '', placeholder: '4px 0' },
					{ displayName: '列背景样式', name: 'background_style', type: 'options', options: [{ name: 'Default', value: 'default' }, { name: 'Grey', value: 'grey' }], default: 'default' },
				],
			},
			{
				displayName: '分栏背景样式',
				name: 'background_style',
				type: 'options',
				options: [{ name: 'Default', value: 'default' }, { name: 'Grey', value: 'grey' }],
				default: 'default',
				displayOptions: { show: { elementType: ['column_set'] } },
			},
			{
				displayName: 'Flex 模式',
				name: 'flex_mode',
				type: 'options',
				options: [
					{ name: 'Bisect', value: 'bisect' },
					{ name: 'Flow', value: 'flow' },
					{ name: 'None', value: 'none' },
					{ name: 'Stretch', value: 'stretch' },
					{ name: 'Trisect', value: 'trisect' },
				],
				default: 'none',
				displayOptions: { show: { elementType: ['column_set'] } },
			},
			{
				displayName: '水平对齐',
				name: 'horizontal_align',
				type: 'options',
				options: [{ name: 'Left', value: 'left' }, { name: 'Center', value: 'center' }, { name: 'Right', value: 'right' }],
				default: 'left',
				displayOptions: { show: { elementType: ['column_set', 'interactive_container'] } },
			},
			{
				displayName: '水平间距',
				name: 'horizontal_spacing',
				type: 'options',
				options: [
					{ name: 'Small (4px)', value: 'small' },
					{ name: 'Medium (8px)', value: 'medium' },
					{ name: 'Large (12px)', value: 'large' },
					{ name: 'Extra_large (16px)', value: 'extra_large' },
				],
				default: 'medium',
				displayOptions: { show: { elementType: ['column_set', 'interactive_container'] } },
			},
			{
				displayName: '外边距',
				name: 'margin',
				type: 'string',
				default: '',
				placeholder: '4px 0px 4px 0px',
				displayOptions: { show: { elementType: ['column_set'] } },
			},
			// --- 交互容器 interactive_container ---
			{
				displayName: '容器内元素',
				name: 'container_elements',
				type: 'collection',
				typeOptions: { multipleValues: true, multipleValueButtonText: '添加元素' },
				default: {},
				displayOptions: { show: { elementType: ['interactive_container', 'collapsible_panel', 'form'] } },
				options: [
					{ displayName: '按钮链接', name: 'button_url', type: 'string', default: '', displayOptions: { show: { c_elType: ['button'] } } },
					{ displayName: '按钮文字', name: 'button_text', type: 'string', default: '', displayOptions: { show: { c_elType: ['button'] } } },
					{ displayName: '按钮样式', name: 'button_type', type: 'options', options: [{ name: 'Default', value: 'default' }, { name: 'Primary', value: 'primary' }, { name: 'Danger', value: 'danger' }], default: 'default', displayOptions: { show: { c_elType: ['button'] } } },
					{ displayName: '内容', name: 'content', type: 'string', typeOptions: { rows: 2 }, default: '', displayOptions: { show: { c_elType: ['markdown'] } } },
					{ displayName: '元素类型', name: 'c_elType', type: 'options', options: [{ name: 'Button', value: 'button' }, { name: 'Hr', value: 'hr' }, { name: 'Img', value: 'img' }, { name: 'Markdown', value: 'markdown' }, { name: 'Person', value: 'person' }, { name: 'Person_list', value: 'person_list' }], default: 'markdown' },
					{ displayName: '图片 Key', name: 'img_key', type: 'string', default: '', displayOptions: { show: { c_elType: ['img'] } } },
					{ displayName: '用户 ID', name: 'user_id', type: 'string', default: '', displayOptions: { show: { c_elType: ['person'] } } },
					{ displayName: '头像尺寸', name: 'person_size', type: 'options', options: [{ name: 'Extra_small', value: 'extra_small' }, { name: 'Large', value: 'large' }, { name: 'Medium', value: 'medium' }, { name: 'Small', value: 'small' }], default: 'medium', displayOptions: { show: { c_elType: ['person'] } } },
					{ displayName: '显示头像', name: 'person_show_avatar', type: 'boolean', default: true, displayOptions: { show: { c_elType: ['person'] } } },
					{ displayName: '显示用户名', name: 'person_show_name', type: 'boolean', default: false, displayOptions: { show: { c_elType: ['person'] } } },
					{ displayName: '展示样式', name: 'person_style', type: 'options', options: [{ name: 'Capsule (胶囊)', value: 'capsule' }, { name: 'Normal (默认)', value: 'normal' }], default: 'normal', displayOptions: { show: { c_elType: ['person'] } } },
					{ displayName: '人员列表', name: 'person_list_ids', type: 'collection', typeOptions: { multipleValues: true, multipleValueButtonText: '添加人员' }, default: {}, displayOptions: { show: { c_elType: ['person_list'] } }, options: [{ displayName: '用户 ID', name: 'id', type: 'string', default: '' }] },
					{ displayName: '列表头像尺寸', name: 'person_list_size', type: 'options', options: [{ name: 'Extra_small', value: 'extra_small' }, { name: 'Large', value: 'large' }, { name: 'Medium', value: 'medium' }, { name: 'Small', value: 'small' }], default: 'medium', displayOptions: { show: { c_elType: ['person_list'] } } },
					{ displayName: '列表显示头像', name: 'person_list_show_avatar', type: 'boolean', default: true, displayOptions: { show: { c_elType: ['person_list'] } } },
					{ displayName: '列表显示用户名', name: 'person_list_show_name', type: 'boolean', default: true, displayOptions: { show: { c_elType: ['person_list'] } } },
					{ displayName: '表单按钮名称', name: 'form_button_name', type: 'string', default: '', description: '表单内按钮唯一标识，提交时回传', displayOptions: { show: { elementType: ['form'], c_elType: ['button'] } } },
					{ displayName: '表单操作类型', name: 'form_action_type', type: 'options', options: [{ name: '提交 (Submit)', value: 'submit' }, { name: '重置 (Reset)', value: 'reset' }], default: 'submit', description: '表单内至少需一个提交按钮', displayOptions: { show: { elementType: ['form'], c_elType: ['button'] } } },
				],
			},
			{
				displayName: '交互类型',
				name: 'action_type',
				type: 'options',
				options: [
					{ name: '打开链接 (Open_url)', value: 'open_url' },
					{ name: '回传 (Callback)', value: 'callback' },
				],
				default: 'open_url',
				displayOptions: { show: { elementType: ['interactive_container'] } },
			},
			{
				displayName: '跳转链接',
				name: 'action_url',
				type: 'string',
				default: '',
				displayOptions: { show: { elementType: ['interactive_container'], action_type: ['open_url'] } },
			},
			{
				displayName: 'Callback 回传值 (JSON)',
				name: 'callback_value',
				type: 'string',
				default: '{}',
				placeholder: '{"key":"value"}',
				displayOptions: { show: { elementType: ['interactive_container'], action_type: ['callback'] } },
			},
			{
				displayName: '表单名称',
				name: 'form_name',
				type: 'string',
				default: '',
				description: 'Form 容器的唯一标识，同一卡片内唯一',
				displayOptions: { show: { elementType: ['form'] } },
			},
			{
				displayName: '面板标题',
				name: 'panel_header_title',
				type: 'string',
				default: '',
				displayOptions: { show: { elementType: ['collapsible_panel'] } },
			},
			{
				displayName: '默认展开',
				name: 'panel_expanded',
				type: 'boolean',
				default: false,
				displayOptions: { show: { elementType: ['collapsible_panel'] } },
			},
			{
				displayName: '面板背景色',
				name: 'panel_background_color',
				type: 'options',
				options: [{ name: 'Default', value: 'default' }, { name: 'Grey', value: 'grey' }],
				default: 'default',
				displayOptions: { show: { elementType: ['collapsible_panel'] } },
			},
			{
				displayName: '标题区背景色',
				name: 'panel_header_background_color',
				type: 'options',
				options: [{ name: 'Default', value: 'default' }, { name: 'Grey', value: 'grey' }, { name: 'Yellow', value: 'yellow' }],
				default: 'default',
				displayOptions: { show: { elementType: ['collapsible_panel'] } },
			},
			{
				displayName: '边框颜色',
				name: 'panel_border_color',
				type: 'options',
				options: [{ name: 'Grey', value: 'grey' }],
				default: 'grey',
				displayOptions: { show: { elementType: ['collapsible_panel'] } },
			},
			{
				displayName: '边框圆角',
				name: 'panel_border_corner_radius',
				type: 'string',
				default: '5px',
				placeholder: '5px',
				displayOptions: { show: { elementType: ['collapsible_panel'] } },
			},
			{
				displayName: '垂直对齐',
				name: 'vertical_align',
				type: 'options',
				options: [{ name: 'Top', value: 'top' }, { name: 'Center', value: 'center' }, { name: 'Bottom', value: 'bottom' }],
				default: 'top',
				displayOptions: { show: { elementType: ['interactive_container'] } },
			},
			{
				displayName: '垂直间距',
				name: 'vertical_spacing',
				type: 'options',
				options: [
					{ name: 'Small (4px)', value: 'small' },
					{ name: 'Medium (8px)', value: 'medium' },
					{ name: 'Large (12px)', value: 'large' },
					{ name: 'Extra_large (16px)', value: 'extra_large' },
				],
				default: 'medium',
				displayOptions: { show: { elementType: ['interactive_container'] } },
			},
			{
				displayName: '背景样式',
				name: 'background_style',
				type: 'options',
				options: [{ name: 'Default', value: 'default' }, { name: 'Grey', value: 'grey' }],
				default: 'default',
				displayOptions: { show: { elementType: ['interactive_container'] } },
			},
			{
				displayName: '显示边框',
				name: 'has_border',
				type: 'boolean',
				default: true,
				displayOptions: { show: { elementType: ['interactive_container'] } },
			},
			{
				displayName: '边框颜色',
				name: 'border_color',
				type: 'options',
				options: [{ name: 'Grey', value: 'grey' }],
				default: 'grey',
				displayOptions: { show: { elementType: ['interactive_container'] } },
			},
			{
				displayName: '内边距',
				name: 'padding',
				type: 'string',
				default: '4px 12px 4px 12px',
				placeholder: '4px 12px 4px 12px',
				displayOptions: { show: { elementType: ['interactive_container'] } },
			},
			{
				displayName: '圆角',
				name: 'corner_radius',
				type: 'string',
				default: '8px',
				displayOptions: { show: { elementType: ['interactive_container'] } },
			},
			{
				displayName: '容器宽度',
				name: 'container_width',
				type: 'options',
				options: [{ name: 'Fill', value: 'fill' }, { name: 'Auto', value: 'auto' }],
				default: 'fill',
				displayOptions: { show: { elementType: ['interactive_container'] } },
			},
			{
				displayName: '排列方向',
				name: 'direction',
				type: 'options',
				options: [{ name: '垂直', value: 'vertical' }, { name: '水平', value: 'horizontal' }],
				default: 'vertical',
				displayOptions: { show: { elementType: ['interactive_container'] } },
			},
		],
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
					card2_config_summary: this.getNodeParameter('card2_config_summary', i, ''),
					card2_config_width_mode: this.getNodeParameter('card2_config_width_mode', i, 'default'),
					card2_config_enable_forward: this.getNodeParameter('card2_config_enable_forward', i, true),
					card2_card_link_url: this.getNodeParameter('card2_card_link_url', i, ''),
					card2_card_link_pc_url: this.getNodeParameter('card2_card_link_pc_url', i, ''),
					card2_card_link_ios_url: this.getNodeParameter('card2_card_link_ios_url', i, ''),
					card2_card_link_android_url: this.getNodeParameter('card2_card_link_android_url', i, ''),
					card2_header_title: this.getNodeParameter('card2_header_title', i, ''),
					card2_header_subtitle: this.getNodeParameter('card2_header_subtitle', i, ''),
					card2_header_template: this.getNodeParameter('card2_header_template', i, 'default'),
					card2_body_direction: this.getNodeParameter('card2_body_direction', i, 'vertical'),
					card2_body_padding: this.getNodeParameter('card2_body_padding', i, ''),
					card2_body_elements: this.getNodeParameter('card2_body_elements', i, []),
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

				const resp = response as Record<string, unknown>;
				if (resp.code !== undefined && resp.code !== 0) {
					const errMsg = resp.msg || resp.StatusMessage || JSON.stringify(resp);
					throw new NodeOperationError(this.getNode(), `Feishu API error (code: ${resp.code}): ${errMsg}`, { itemIndex: i });
				}

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
