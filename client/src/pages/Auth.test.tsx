import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { usesSiteRail } from '../components/layout';
import Account from './Account';
import Auth from './Auth';
import ExperienceDetail from './ExperienceDetail';
import Guides from './Guides';
import GuideDashboard from './GuideDashboard';
import { GuideApplication } from '../components/GuideApplication';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('auth page', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        store: {} as Record<string, string>,
        getItem(key: string) {
          return this.store[key] ?? null;
        },
        setItem(key: string, value: string) {
          this.store[key] = String(value);
        },
        removeItem(key: string) {
          delete this.store[key];
        },
        clear() {
          this.store = {};
        },
      },
      configurable: true,
    });
  });

  it('keeps the auth flow off the site rail', () => {
    expect(usesSiteRail('/auth')).toBe(false);
    expect(usesSiteRail('/forgot-password')).toBe(false);
  });

  it('offers a password visibility toggle and a combined consent checkbox in register mode', () => {
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /register/i }));

    const passwordInput = screen.getByLabelText(/^Password$/i);
    expect(passwordInput).toHaveAttribute('type', 'password');

    const toggle = screen.getByRole('button', { name: /show password/i });
    fireEvent.click(toggle);
    expect(passwordInput).toHaveAttribute('type', 'text');

    const consent = screen.getByRole('checkbox', {
      name: /i confirm the details i have provided are correct and that i have read the privacy policy and terms & conditions/i,
    });
    expect(consent).toBeRequired();
  });

  it('blocks guides from the traveler account and travelers from the guide dashboard', () => {
    window.localStorage.setItem(
      'echoes_session',
      JSON.stringify({
        user: { id: 'guide-1', email: 'guide@example.com', name: 'Ada Guide', role: 'organizer' },
        token: 'guide-token',
      }),
    );

    renderWithClient(
      <MemoryRouter>
        <Account />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /guide dashboard/i })).toBeInTheDocument();

    window.localStorage.setItem(
      'echoes_session',
      JSON.stringify({
        user: { id: 'traveler-1', email: 'traveler@example.com', name: 'Sam Visitor', role: 'visitor' },
        token: 'traveler-token',
      }),
    );

    renderWithClient(
      <MemoryRouter>
        <GuideDashboard />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /traveler account/i })).toBeInTheDocument();
  });

  it('requires a signed-in traveler before the booking form is available', async () => {
    vi.spyOn(api, 'experience').mockResolvedValue({
      experience: {
        id: 'exp-1',
        slug: 'lagos-heritage-walk',
        isSampleData: true,
        title: 'Lagos Heritage Walk',
        organizer: 'Ada Guide',
        placeId: 'place-1',
        summary: 'A short description.',
        meetingPoint: 'Lekki',
        coordinates: { lat: 6.52, lng: 3.38 },
        durationMinutes: 90,
        currency: 'NGN',
        priceMinor: 20000,
        cancellationTerms: 'Free cancellation up to 24 hours before the experience.',
        accessibility: 'Step-free route',
        languages: ['English'],
        schedules: [
          {
            scheduleId: 'sched-1',
            startsAt: '2026-11-04T09:00:00.000Z',
            remaining: 4,
            soldOut: false,
          },
        ],
        placeName: 'Lekki Arts & Crafts Market',
      },
      provider: {
        environment: 'sandbox',
        configured: true,
        missing: [],
        simulationAllowed: true,
        transportReady: true,
      },
    });

    renderWithClient(
      <MemoryRouter initialEntries={['/experiences/exp-1']}>
        <Routes>
          <Route path="/experiences/:id" element={<ExperienceDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/sign in to book/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue to payment/i })).not.toBeInTheDocument();
  });

  it('requires a single consent checkbox before a guide application can be submitted', () => {
    render(
      <MemoryRouter>
        <GuideApplication token="guide-token" defaultName="Ada Guide" />
      </MemoryRouter>,
    );

    const consent = screen.getByRole('checkbox', {
      name: /i confirm the details i have provided are correct and that i have read the privacy policy and terms & conditions/i,
    });
    expect(consent).toBeRequired();
    expect(screen.getByRole('button', { name: /submit for review/i })).toBeDisabled();
  });

  it('shows guide trust signals, review snippets, and near-me controls on the marketplace', async () => {
    vi.spyOn(api, 'guides').mockResolvedValue({
      guides: [
        {
          id: 'guide-1',
          name: 'Ada Nwosu',
          role: 'History storyteller',
          city: 'Lagos',
          rating: 4.9,
          specialties: ['History', 'Food'],
          bio: 'I guide neighbourhood walks across Lagos with context, humour and local recommendations.',
          availability: 'Available this week',
          priceFrom: '₦15,000',
          avatarUrl: null,
        },
      ],
    });

    renderWithClient(
      <MemoryRouter>
        <Guides />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/4.9/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /near me/i })).toBeInTheDocument();
    expect(screen.getByText(/recent review/i)).toBeInTheDocument();
    expect(screen.getByText(/book now/i)).toBeInTheDocument();
  });
});
