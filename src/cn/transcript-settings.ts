import { initializeSettingToggle } from '../utils/ui-utils';
import { debounce } from '../utils/debounce';
import { getTranscriptSettings, setTranscriptSettings } from './transcript-cache';

export async function initializeTranscriptSettings(): Promise<void> {
	const toggle = document.getElementById('cn-transcript-enabled') as HTMLInputElement | null;
	const apiKeyInput = document.getElementById('cn-funasr-api-key') as HTMLInputElement | null;
	if (!toggle) return;

	const settings = await getTranscriptSettings();
	initializeSettingToggle('cn-transcript-enabled', settings.enabled, async (checked) => {
		const current = await getTranscriptSettings();
		await setTranscriptSettings({ ...current, enabled: checked });
	});

	if (apiKeyInput) {
		apiKeyInput.value = settings.dashscopeApiKey || '';
		const saveKey = debounce(async () => {
			const current = await getTranscriptSettings();
			await setTranscriptSettings({
				...current,
				dashscopeApiKey: apiKeyInput.value.trim(),
			});
		}, 500);
		apiKeyInput.addEventListener('input', saveKey);
	}
}
