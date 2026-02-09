import type { COLORS } from './const.js';

export type * from 'type-fest';
export type ColorType = 'success' | 'info' | 'error' | 'warning' | keyof typeof COLORS;
export type ManifestType = chrome.runtime.ManifestV3;
