import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createBilibiliPlaybackTracker } from './bilibili-playback-tracker';


describe('createBilibiliPlaybackTracker', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('freezes estimated time after paused message', () => {
		const tracker = createBilibiliPlaybackTracker(12);

		tracker.startTracking(12);
		vi.advanceTimersByTime(1500);
		expect(tracker.getEstimatedTime()).toBeCloseTo(13.5, 1);

		expect(tracker.handlePlayerMessage('playerOperation-{"type":"paused","value":{}}')).toBe(true);
		const pausedTime = tracker.getEstimatedTime();

		vi.advanceTimersByTime(3000);

		expect(tracker.getEstimatedTime()).toBeCloseTo(pausedTime, 5);
	});

	test('resumes estimated time after playing message', () => {
		const tracker = createBilibiliPlaybackTracker(20);

		tracker.startTracking(20);
		vi.advanceTimersByTime(1000);
		tracker.handlePlayerMessage('playerOperation-{"type":"paused","value":{}}');
		const pausedTime = tracker.getEstimatedTime();

		vi.advanceTimersByTime(2000);
		expect(tracker.getEstimatedTime()).toBeCloseTo(pausedTime, 5);

		expect(tracker.handlePlayerMessage('playerOperation-{"type":"playing","value":{}}')).toBe(true);
		vi.advanceTimersByTime(2500);

		expect(tracker.getEstimatedTime()).toBeCloseTo(pausedTime + 2.5, 1);
	});

	test('supports object-style player messages', () => {
		const tracker = createBilibiliPlaybackTracker(5);
		tracker.startTracking(5);
		vi.advanceTimersByTime(1000);

		expect(tracker.handlePlayerMessage({ data: { type: 'paused' } })).toBe(true);
		const pausedTime = tracker.getEstimatedTime();
		vi.advanceTimersByTime(2000);
		expect(tracker.getEstimatedTime()).toBeCloseTo(pausedTime, 5);

		expect(tracker.handlePlayerMessage({ type: 'playing' })).toBe(true);
		vi.advanceTimersByTime(1000);
		expect(tracker.getEstimatedTime()).toBeCloseTo(pausedTime + 1, 1);
	});

	test('syncs with playback state fallback', () => {
		const tracker = createBilibiliPlaybackTracker(0);
		tracker.startTracking(0);
		vi.advanceTimersByTime(1200);

		tracker.syncPlaybackState('paused');
		const pausedTime = tracker.getEstimatedTime();
		vi.advanceTimersByTime(1800);
		expect(tracker.getEstimatedTime()).toBeCloseTo(pausedTime, 5);

		tracker.syncPlaybackState('playing');
		vi.advanceTimersByTime(800);
		expect(tracker.getEstimatedTime()).toBeCloseTo(pausedTime + 0.8, 1);
	});
});
