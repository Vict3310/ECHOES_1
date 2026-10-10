import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRepository } from '../src/repo/memory';

let repo: MemoryRepository;

beforeEach(() => {
  repo = new MemoryRepository();
});

const customer = {
  customerName: 'Ada Obi',
  customerEmail: 'ada@example.com',
  customerPhone: '+2348000000000',
  notes: null,
};

describe('bookings', () => {
  it('prices a booking on the server from the experience, not from client input', async () => {
    const booking = await repo.createBooking({
      experienceId: 'sample-afrobeat-walk',
      scheduleId: 'sun-1500',
      participants: 3,
      ...customer,
    });
    expect(booking.unitPriceMinor).toBe(1_500_000);
    expect(booking.totalMinor).toBe(4_500_000);
    expect(booking.currency).toBe('NGN');
    expect(booking.status).toBe('pending_payment');
  });

  it('refuses a booking for a sold-out date', async () => {
    await expect(
      repo.createBooking({
        experienceId: 'sample-afrobeat-walk',
        scheduleId: 'sat-1600', // capacity 12, baseline booked 12
        participants: 1,
        ...customer,
      }),
    ).rejects.toThrow(/fully booked/i);
  });

  it('refuses a booking that exceeds the remaining seats and reports the remainder', async () => {
    await expect(
      repo.createBooking({
        experienceId: 'sample-adire-workshop',
        scheduleId: 'fri-1000', // capacity 8, baseline booked 2
        participants: 7,
        ...customer,
      }),
    ).rejects.toThrow(/Only 6 places remain/i);
  });

  it('accounts for pending and confirmed bookings when calculating remaining seats', async () => {
    const booking = await repo.createBooking({
      experienceId: 'sample-adire-workshop',
      scheduleId: 'fri-1000',
      participants: 5,
      ...customer,
    });
    expect(booking.totalMinor).toBe(5 * 2_200_000);
    expect(await repo.seatsBooked('fri-1000')).toBe(5);

    // Only one seat left (8 - 2 baseline - 5 now held).
    await expect(
      repo.createBooking({
        experienceId: 'sample-adire-workshop',
        scheduleId: 'fri-1000',
        participants: 2,
        ...customer,
      }),
    ).rejects.toThrow(/Only 1 place remains/i);
  });

  it('releases seats when a booking is cancelled', async () => {
    const first = await repo.createBooking({
      experienceId: 'sample-afrobeat-walk',
      scheduleId: 'sun-1500',
      participants: 12,
      ...customer,
    });
    await expect(
      repo.createBooking({
        experienceId: 'sample-afrobeat-walk',
        scheduleId: 'sun-1500',
        participants: 1,
        ...customer,
      }),
    ).rejects.toThrow(/fully booked/i);

    await repo.updateBookingStatus(first.id, 'cancelled');
    expect(await repo.seatsBooked('sun-1500')).toBe(0);
    const retry = await repo.createBooking({
      experienceId: 'sample-afrobeat-walk',
      scheduleId: 'sun-1500',
      participants: 1,
      ...customer,
    });
    expect(retry.status).toBe('pending_payment');
  });

  it('rejects unknown experiences and unknown dates', async () => {
    await expect(
      repo.createBooking({ experienceId: 'nope', scheduleId: 'sun-1500', participants: 1, ...customer }),
    ).rejects.toThrow(/Experience not found/i);
    await expect(
      repo.createBooking({
        experienceId: 'sample-afrobeat-walk',
        scheduleId: 'nope',
        participants: 1,
        ...customer,
      }),
    ).rejects.toThrow(/not available/i);
  });

  it('marks every catalogue experience as sample data', async () => {
    const experiences = await repo.listExperiences();
    expect(experiences.length).toBeGreaterThan(0);
    for (const experience of experiences) {
      expect(experience.isSampleData).toBe(true);
    }
  });
});
