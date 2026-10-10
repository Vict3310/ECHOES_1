import { describe, expect, it } from 'vitest';
import { boundingBox, distanceKm, formatDistance, formatDuration, isValidCoordinate } from '../src/lib/geo';

describe('geo helpers', () => {
  it('validates coordinate ranges', () => {
    expect(isValidCoordinate({ lat: 6.45, lng: 3.39 })).toBe(true);
    expect(isValidCoordinate({ lat: 91, lng: 3.39 })).toBe(false);
    expect(isValidCoordinate({ lat: 6.45, lng: 181 })).toBe(false);
    expect(isValidCoordinate({ lat: Number.NaN, lng: 3.39 })).toBe(false);
    expect(isValidCoordinate({ lng: 3.39 })).toBe(false);
  });

  it('computes great-circle distances', () => {
    const freedomPark = { lat: 6.4505, lng: 3.3953 };
    const nationalMuseum = { lat: 6.4433, lng: 3.4022 };
    const km = distanceKm(freedomPark, nationalMuseum);
    expect(km).toBeGreaterThan(0.5);
    expect(km).toBeLessThan(2);
    expect(distanceKm(freedomPark, freedomPark)).toBeCloseTo(0, 5);
  });

  it('builds a bounding box that contains the centre', () => {
    const box = boundingBox({ lat: 6.45, lng: 3.39 }, 5);
    expect(box.minLat).toBeLessThan(6.45);
    expect(box.maxLat).toBeGreaterThan(6.45);
    expect(box.minLng).toBeLessThan(3.39);
    expect(box.maxLng).toBeGreaterThan(3.39);
  });

  it('formats distances and durations for display', () => {
    expect(formatDistance(0.4)).toBe('400 m');
    expect(formatDistance(3.25)).toBe('3.3 km');
    expect(formatDistance(24)).toBe('24 km');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(120)).toBe('2 hr');
    expect(formatDuration(95)).toBe('1 hr 35 min');
  });
});
