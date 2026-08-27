import browser from '../utils/browser-polyfill';

let port: ReturnType<typeof browser.runtime.connect> | null = null;

export function connectTranscriptKeepAlive(): void {
	disconnectTranscriptKeepAlive();
	try {
		port = browser.runtime.connect({ name: 'cn-transcript-keepalive' });
	} catch {
		port = null;
	}
}

export function disconnectTranscriptKeepAlive(): void {
	try {
		port?.disconnect();
	} catch {
		// Already disconnected.
	}
	port = null;
}
