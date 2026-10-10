import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../src/repo/memory';

const baseStory = {
  placeId: 'freedom-park-lagos',
  suggestedPlaceName: null,
  body: 'My grandfather worked at the prison before it closed and described the compound to us many times. This is a family account, not a published source.',
  sourceContext: 'Family oral account, told by my grandfather in the 1990s.',
  period: '1950s',
  attribution: 'pseudonym' as const,
  contributorName: 'A Lagos Island resident',
  contributorEmail: 'contributor@example.com',
  consentPublication: true,
  consentTerms: true,
  sensitivity: 'standard' as const,
  mediaUrls: [],
};

describe('community stories', () => {
  it('stores a submission as pending with a public reference', async () => {
    const repo = new MemoryRepository();
    const story = await repo.createStory(baseStory);
    expect(story.status).toBe('pending');
    expect(story.reference).toMatch(/^ECH-ST-[A-Z2-9]{8}$/);
    expect(story.reviewedAt).toBeNull();
  });

  it('never publishes an unmoderated story', async () => {
    const repo = new MemoryRepository();
    await repo.createStory(baseStory);
    expect(await repo.listStoriesForPlace('freedom-park-lagos', 'approved')).toHaveLength(0);
    expect(await repo.listStoriesForPlace('freedom-park-lagos', 'pending')).toHaveLength(1);
  });

  it('publishes only after a moderation decision, and records the reviewer', async () => {
    const repo = new MemoryRepository();
    const story = await repo.createStory(baseStory);
    const approved = await repo.moderateStory(story.id, {
      status: 'approved',
      moderationNote: 'Account verified as an oral testimonial; published as community testimony.',
      reviewedBy: 'moderator@example.com',
    });
    expect(approved.status).toBe('approved');
    expect(approved.reviewedBy).toBe('moderator@example.com');
    expect(approved.reviewedAt).not.toBeNull();
    expect(await repo.listStoriesForPlace('freedom-park-lagos', 'approved')).toHaveLength(1);
  });

  it('supports requesting corrections and rejection', async () => {
    const repo = new MemoryRepository();
    const story = await repo.createStory(baseStory);
    const correction = await repo.moderateStory(story.id, {
      status: 'needs_correction',
      moderationNote: 'Please add the approximate year if you can.',
      reviewedBy: 'moderator@example.com',
    });
    expect(correction.status).toBe('needs_correction');
    const rejected = await repo.moderateStory(story.id, {
      status: 'rejected',
      moderationNote: 'Duplicate of an existing submission.',
      reviewedBy: 'moderator@example.com',
    });
    expect(rejected.status).toBe('rejected');
    expect(await repo.listStoriesForPlace('freedom-park-lagos', 'approved')).toHaveLength(0);
  });

  it('keeps a contributor’s chosen attribution preference intact', async () => {
    const repo = new MemoryRepository();
    const anonymous = await repo.createStory({
      ...baseStory,
      attribution: 'anonymous',
      contributorName: null,
      contributorEmail: null,
    });
    expect(anonymous.attribution).toBe('anonymous');
    expect(anonymous.contributorName).toBeNull();
  });

  it('rejects moderation of a story that does not exist', async () => {
    const repo = new MemoryRepository();
    await expect(
      repo.moderateStory('does-not-exist', {
        status: 'approved',
        moderationNote: null,
        reviewedBy: 'moderator@example.com',
      }),
    ).rejects.toThrow(/not found/i);
  });
});
