import browser from '../utils/browser-polyfill';
import { debounce } from '../utils/debounce';

export async function initializeFeishuSettings(): Promise<void> {
	const appIdInput = document.getElementById('feishu-app-id') as HTMLInputElement;
	const appSecretInput = document.getElementById('feishu-app-secret') as HTMLInputElement;
	if (!appIdInput || !appSecretInput) return;

	const data = await browser.storage.local.get('feishu_settings');
	const settings = (data.feishu_settings || {}) as { appId?: string; appSecret?: string };

	appIdInput.value = settings.appId || '';
	appSecretInput.value = settings.appSecret || '';

	const saveFeishuSettings = debounce(async () => {
		await browser.storage.local.set({
			feishu_settings: {
				appId: appIdInput.value.trim(),
				appSecret: appSecretInput.value.trim(),
			}
		});
	}, 500);

	appIdInput.addEventListener('input', saveFeishuSettings);
	appSecretInput.addEventListener('input', saveFeishuSettings);
}
