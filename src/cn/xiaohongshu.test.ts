import { afterEach, describe, expect, test, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import browser from '../utils/browser-polyfill';
import { extractXiaohongshuNote, extractXiaohongshuNoteAsync, getXiaohongshuNoteId, getXiaohongshuVideoSource } from './xiaohongshu';

vi.mock('../utils/browser-polyfill', () => ({
	default: { runtime: { sendMessage: async () => ({}) } },
}));

const NOTE_ID = '6a8b2b3e0000000035027b70';
const NOTE_URL = `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=abc`;

function pageWithNote(note: object, comments: object[] = []): Document {
	const state = JSON.stringify({ note: { noteDetailMap: { [NOTE_ID]: { note, comments: { list: comments } } } } })
		.replace('"__UNDEF__"', 'undefined');
	const { document } = parseHTML(`
		<html><head><script>window.__INITIAL_STATE__=${state}</script></head><body></body></html>
	`);
	return document as unknown as Document;
}

describe('Xiaohongshu overlay', () => {
	test('detects note URLs', () => {
		expect(getXiaohongshuNoteId(NOTE_URL)).toBe(NOTE_ID);
		expect(getXiaohongshuNoteId(`https://www.xiaohongshu.com/discovery/item/${NOTE_ID}`)).toBe(NOTE_ID);
		expect(getXiaohongshuNoteId('https://www.xiaohongshu.com/explore')).toBeNull();
		expect(getXiaohongshuNoteId(`https://example.com/explore/${NOTE_ID}`)).toBeNull();
	});

	test('extracts image note with stable image URLs and cleaned topics', () => {
		const doc = pageWithNote({
			type: 'normal',
			title: '博物馆',
			desc: '第一行 <b>\n#看展[话题]# #博物馆打卡[话题]#',
			user: { nickname: 'Robinson Chan' },
			extra: '__UNDEF__',
			imageList: [
				{ fileId: 'notes_pre_post/aaa', urlDefault: 'http://sns-webpic-qc.xhscdn.com/202610080900/sig/notes_pre_post/aaa!nd_dft_wlteh_webp_3' },
				{ fileId: '', urlDefault: 'http://sns-webpic-qc.xhscdn.com/202610080900/sig/notes_pre_post/bbb!nd_dft_wlteh_webp_3' },
			],
		});

		const result = extractXiaohongshuNote(NOTE_URL, doc)!;

		expect(result.title).toBe('博物馆');
		expect(result.author).toBe('Robinson Chan');
		expect(result.content).toContain('<p>第一行 &lt;b&gt;</p>');
		expect(result.content).toContain('#看展 #博物馆打卡');
		expect(result.content).toContain('<img src="https://sns-img-qc.xhscdn.com/notes_pre_post/aaa">');
		expect(result.content).toContain('<img src="https://sns-img-qc.xhscdn.com/notes_pre_post/bbb">');
		expect(result.content).not.toContain('<video');
	});

	test('extracts video note with unsigned stream URL and cover poster', () => {
		const doc = pageWithNote({
			type: 'video',
			title: '',
			desc: '机器人',
			user: { nickname: '光明日报' },
			imageList: [{ fileId: 'spectrum/cover' }],
			video: {
				media: {
					stream: {
						EF4: [{ masterUrl: 'http://sns-video-zl.xhscdn.com/stream/79/110/259/x_259.mp4?sign=s&t=1' }],
						EF5: [],
					},
				},
			},
		});

		const result = extractXiaohongshuNote(NOTE_URL, doc)!;

		expect(result.title).toBeUndefined();
		expect(result.content).toContain(
			'<video controls src="https://sns-video-zl.xhscdn.com/stream/79/110/259/x_259.mp4" poster="https://sns-img-qc.xhscdn.com/spectrum/cover">'
		);
		expect(result.content).not.toContain('<img');
	});

	test('exposes the video source for transcription', () => {
		expect(getXiaohongshuVideoSource({
			type: 'video',
			video: {
				capa: { duration: 856 },
				media: { stream: { EF4: [{
					masterUrl: 'http://sns-video-qc.xhscdn.com/stream/1/110/259/a_259.mp4?sign=s',
					backupUrls: ['http://sns-video-bd.xhscdn.com/stream/1/110/259/a_259.mp4?sign=s'],
				}] } },
			},
		})).toEqual({
			urls: [
				'https://sns-video-qc.xhscdn.com/stream/1/110/259/a_259.mp4',
				'https://sns-video-bd.xhscdn.com/stream/1/110/259/a_259.mp4',
				'https://sns-video-zl.xhscdn.com/stream/1/110/259/a_259.mp4',
				'https://sns-video-hw.xhscdn.com/stream/1/110/259/a_259.mp4',
			],
			durationSec: 856,
		});
		expect(getXiaohongshuVideoSource({ type: 'normal', imageList: [] })).toBeNull();
	});

	test('returns null when the page state is for a different note', () => {
		const doc = pageWithNote({ type: 'normal', desc: 'x' });
		expect(extractXiaohongshuNote('https://www.xiaohongshu.com/explore/ffffffffffffffffffffffff', doc)).toBeNull();
	});

	test('ignores feed-card stubs that lack desc', () => {
		const doc = pageWithNote({ type: 'normal', imageList: [{ fileId: 'stub' }] });
		expect(extractXiaohongshuNote(NOTE_URL, doc)).toBeNull();
	});
});

describe('Xiaohongshu AI comments', () => {
	const human = (id: string, content: string, extra: object = {}) =>
		({ id, content, userInfo: { nickname: '网友', aiAgent: false }, ...extra });
	const ai = (id: string, content: string, extra: object = {}) =>
		({ id, content, userInfo: { nickname: '点点', aiAgent: true }, ...extra });

	test('collects AI replies in threads with the question they answer', () => {
		const doc = pageWithNote({ type: 'normal', desc: '正文' }, [
			human('c1', '@点点 总结一下', {
				subComments: [
					human('s1', '同问'),
					ai('s2', '要点一\n要点二', { targetComment: { id: 'c1' } }),
				],
			}),
			human('c2', '普通评论'),
		]);

		const content = extractXiaohongshuNote(NOTE_URL, doc)!.content;

		expect(content).toContain('<h2>官方解读（点点）</h2>');
		expect(content).toContain('<blockquote><p>网友：@点点 总结一下</p></blockquote>');
		expect(content).toContain('<p><strong>点点：</strong></p><p>要点一</p><p>要点二</p>');
		expect(content).not.toContain('普通评论');
		expect(content).not.toContain('同问');
	});

	test('keeps top-level AI comments without a question block', () => {
		const doc = pageWithNote({ type: 'normal', desc: '正文' }, [ai('c1', '逐字稿全文')]);
		const content = extractXiaohongshuNote(NOTE_URL, doc)!.content;
		expect(content).toContain('<h2>官方解读（点点）</h2><p><strong>点点：</strong></p><p>逐字稿全文</p>');
	});

	test('omits the section when no AI replies are loaded', () => {
		const doc = pageWithNote({ type: 'normal', desc: '正文' }, [human('c1', '普通评论')]);
		expect(extractXiaohongshuNote(NOTE_URL, doc)!.content).not.toContain('官方解读');
	});
});

describe('Xiaohongshu overlay (modal / runtime state)', () => {
	afterEach(() => vi.restoreAllMocks());

	test('prefers the runtime note over the server-rendered state', async () => {
		const doc = pageWithNote({ type: 'normal', desc: '旧的首页数据' });
		vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({
			success: true,
			note: { type: 'normal', desc: '弹窗里的笔记', imageList: [{ fileId: 'modal/img' }] },
			comments: [{ id: 'c1', content: '弹窗里的解读', userInfo: { nickname: '点点', aiAgent: true } }],
		} as never);

		const result = (await extractXiaohongshuNoteAsync(NOTE_URL, doc))!;

		expect(result.content).toContain('弹窗里的笔记');
		expect(result.content).toContain('https://sns-img-qc.xhscdn.com/modal/img');
		expect(result.content).toContain('弹窗里的解读');
	});

	test('falls back to the server-rendered state when runtime has no full note', async () => {
		const doc = pageWithNote({ type: 'normal', desc: '详情页数据' });
		vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ success: true, note: null } as never);

		const result = (await extractXiaohongshuNoteAsync(NOTE_URL, doc))!;

		expect(result.content).toContain('详情页数据');
	});
});
