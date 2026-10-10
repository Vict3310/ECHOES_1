import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { FALLBACK_NOTICE, FALLBACK_PLACES } from '../data/fallback';
import type { Place } from './types';

export interface PlacesResult {
  places: Place[];
  isLoading: boolean;
  isOffline: boolean;
  error: unknown;
  disclaimer: string;
  sourcesChecked: string[];
  retry: () => void;
}

export function usePlaces(
  params: { category?: string; neighbourhood?: string; q?: string; needsResearch?: boolean } = {},
): PlacesResult {
  const query = useQuery({
    queryKey: ['places', params],
    queryFn: () => api.places(params),
  });

  const isOffline = query.isError;

  let places: Place[] = query.data?.places ?? [];
  if (isOffline && !params.category && !params.neighbourhood && !params.q && !params.needsResearch) {
    // Only the unfiltered view can be served from the bundled sample.
    places = FALLBACK_PLACES;
  }

  return {
    places,
    isLoading: query.isLoading,
    isOffline,
    error: query.error,
    disclaimer: query.data?.disclaimer ?? FALLBACK_NOTICE,
    sourcesChecked: query.data?.sourcesChecked ?? [],
    retry: () => void query.refetch(),
  };
}
