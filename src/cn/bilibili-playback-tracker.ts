type BilibiliPlayerOperation = 'playing' | 'paused';

function normalizeOperation(value: unknown): BilibiliPlayerOperation | null {
	if (typeof value !== 'string') {
		return null;
	}

	const normalized = value.toLowerCase();
	if (normalized === 'playing' || normalized.includes('play')) return 'playing';
	if (normalized === 'paused' || normalized.includes('pause')) return 'paused';
	return null;
}

function extractOperation(payload: unknown): BilibiliPlayerOperation | null {
	if (!payload || typeof payload !== 'object') {
		return null;
	}

	const data = payload as Record<string, unknown>;

	// 常见字段（type/state/playerState/event）
	const direct =
		normalizeOperation(data.type)
		|| normalizeOperation(data.state)
		|| normalizeOperation(data.playerState)
		|| normalizeOperation(data.event);
	if (direct) return direct;

	// 常见嵌套字段（info/value/data）
	return extractOperation(data.info) || extractOperation(data.value) || extractOperation(data.data);
}

function parseBilibiliPlayerOperation(data: unknown): BilibiliPlayerOperation | null {
	if (typeof data !== 'string') {
		return extractOperation(data);
	}

	const raw = data.trim();
	if (!raw) return null;

	if (raw.startsWith('playerOperation-')) {
		const payloadText = raw.slice('playerOperation-'.length);
		try {
			return extractOperation(JSON.parse(payloadText));
		} catch {
			return null;
		}
	}

	try {
		return extractOperation(JSON.parse(raw));
	} catch {
		return normalizeOperation(raw);
	}
}

type PlaybackState = 'playing' | 'paused' | 'none';

function isSameState(current: PlaybackState, next: PlaybackState): boolean {
	return current === next;
}

export interface BilibiliPlaybackTracker {
	startTracking: (videoTime: number) => void;
	stopTracking: () => void;
	getEstimatedTime: () => number;
	handlePlayerMessage: (data: unknown) => boolean;
	syncPlaybackState: (state: PlaybackState) => void;
}

/**
 * 创建 Bilibili 播放时间追踪器。
 *
 * 由于 reader mode 中的 Bilibili 使用跨域 iframe，父页面无法直接读取
 * `currentTime`，因此这里基于“最近一次已知视频时间 + 系统时间差”估算当前进度，
 * 并在收到播放器的 `playing/paused` 消息时冻结或恢复估算时间。
 */
export function createBilibiliPlaybackTracker(initialVideoTime = 0): BilibiliPlaybackTracker {
	let playbackOriginSystem = Date.now();
	let playbackOriginVideo = initialVideoTime;
	let tracking = false;
	let playbackState: PlaybackState = 'none';

	const getEstimatedTime = (): number => {
		if (!tracking) return playbackOriginVideo;
		return playbackOriginVideo + (Date.now() - playbackOriginSystem) / 1000;
	};

	const startTracking = (videoTime: number): void => {
		playbackOriginVideo = videoTime;
		playbackOriginSystem = Date.now();
		tracking = true;
		playbackState = 'playing';
	};

	const stopTracking = (): void => {
		if (tracking) {
			playbackOriginVideo = getEstimatedTime();
			tracking = false;
		}
		playbackState = 'paused';
	};

	const syncPlaybackState = (state: PlaybackState): void => {
		if (isSameState(playbackState, state)) return;

		if (state === 'playing') {
			startTracking(getEstimatedTime());
			return;
		}
		if (state === 'paused') {
			stopTracking();
			return;
		}
		playbackState = 'none';
	};

	const handlePlayerMessage = (data: unknown): boolean => {
		const operation = parseBilibiliPlayerOperation(data);
		if (!operation) return false;

		if (operation === 'paused') {
			stopTracking();
		} else {
			startTracking(getEstimatedTime());
		}

		return true;
	};

	return {
		startTracking,
		stopTracking,
		getEstimatedTime,
		handlePlayerMessage,
		syncPlaybackState,
	};
}
