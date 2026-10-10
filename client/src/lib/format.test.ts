import { describe, expect, it } from 'vitest';
import {
  categoryLabel,
  formatDistanceKm,
  formatMeters,
  formatMinutes,
  formatMoney,
  formatSeconds,
  PLACE_CATEGORIES,
} from './format';

describe('display formatting', () => {
  it('formats money in the experience currency', () => {
    expect(formatMoney(1_500_000, 'NGN')).toMatch(/15,000/);
    expect(formatMoney(1_500_000, 'NGN')).toMatch(/₦|NGN/);
  });

  it('formats distances sensibly at both scales', () => {
    expect(formatDistanceKm(0.42)).toBe('420 m');
    expect(formatDistanceKm(3.256)).toBe('3.3 km');
    expect(formatDistanceKm(21.4)).toBe('21 km');
    expect(formatMeters(1250)).toBe('1.3 km');
  });

  it('formats durations from seconds and minutes', () => {
    expect(formatSeconds(600)).toBe('10 min');
    expect(formatSeconds(5400)).toBe('1 hr 30 min');
    expect(formatSeconds(7200)).toBe('2 hr');
    expect(formatMinutes(45)).toBe('45 min');
  });

  it('labels every place category the API can return', () => {
    for (const category of PLACE_CATEGORIES) {
      expect(categoryLabel(category)).not.toMatch(/-/);
      expect(categoryLabel(category).length).toBeGreaterThan(3);
    }
    expect(categoryLabel('heritage-site')).toBe('Heritage site');
  });
});
