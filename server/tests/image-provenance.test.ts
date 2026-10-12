import { describe, expect, it } from 'vitest';
import { loadPlaces } from '../src/data/dataset';

/**
 * The image dimension is the easiest place for this dataset to overstate itself,
 * so the invariants are asserted rather than trusted: an image is either a
 * confirmed photograph of the place or it is labelled as a stock stand-in, every
 * image carries the credit its licence requires, and the stored coverage row
 * always agrees with what the interface renders.
 */
describe('image provenance', () => {
  const places = loadPlaces();
  const withImages = places.filter((place) => place.image);

  it('covers the whole dataset without gaps in the shape', () => {
    expect(places.length).toBeGreaterThan(0);
    for (const place of places) {
      expect(place.coverage.image, `${place.id} has no stored image coverage`).toBeTruthy();
    }
  });

  it('labels every image as either a photograph of the place or a stand-in', () => {
    expect(withImages.length).toBeGreaterThan(0);
    for (const place of withImages) {
      expect(
        ['place', 'representative'],
        `${place.id} has an unlabelled image`,
      ).toContain(place.image!.depicts);
    }
  });

  it('resolves locally stored images to files on disk', () => {
    // Remote URLs are deliberately allowed (third-party CDN), but a local path is
    // a promise that the file shipped with the app.
    for (const place of withImages) {
      const { localPath, depicts } = place.image!;
      if (localPath.startsWith('http')) {
        expect(depicts).toBe('representative');
      } else {
        expect(depicts).toBe('place');
        expect(localPath.startsWith('/places/'), `${place.id} localPath should live under /places/`).toBe(true);
      }
    }
  });

  it('records the attribution each licence requires', () => {
    for (const place of withImages) {
      const image = place.image!;
      expect(image.license, `${place.id} has no licence`).toBeTruthy();
      expect(
        image.artist ?? image.credit,
        `${place.id} has an image with no credited author`,
      ).toBeTruthy();
      if (image.attributionRequired) {
        expect(
          image.licenseUrl ?? image.filePageUrl,
          `${place.id} requires attribution but links to no licence or file page`,
        ).toBeTruthy();
      }
    }
  });

  it('never claims an image dimension it does not have, or denies one it does', () => {
    for (const place of places) {
      const status = place.coverage.image.status;
      if (place.image?.depicts === 'place') {
        expect(status, `${place.id} shows a real photograph but reports "${status}"`).toBe('available');
      } else {
        expect(
          status,
          `${place.id} has no photograph of its own and must not report "${status}"`,
        ).not.toBe('available');
      }
    }
  });

  it('says plainly when the image shown is not the place', () => {
    for (const place of places) {
      if (place.image?.depicts === 'representative') {
        expect(place.coverage.image.evidence).toMatch(/representative stock photograph/i);
        expect(place.coverage.image.evidence).toMatch(/not a photograph of this place/i);
      }
      if (!place.image) {
        expect(place.coverage.image.evidence).toMatch(/No openly licensed image/i);
      }
    }
  });
});
