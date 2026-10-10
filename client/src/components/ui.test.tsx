import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GapRow, StatusPill } from './ui';
import { COVERAGE_LABELS } from '../lib/knowledge';
import type { KnowledgeGap } from '../lib/types';

describe('coverage presentation', () => {
  it('describes a missing dimension as not found in the checked sources', () => {
    render(<StatusPill status="missing" />);
    expect(screen.getByText(COVERAGE_LABELS.missing)).toBeInTheDocument();
    expect(screen.getByText(/checked sources/i)).toBeInTheDocument();
  });

  it('labels conflicts distinctly from missing data', () => {
    render(<StatusPill status="conflicting" />);
    expect(screen.getByText(COVERAGE_LABELS.conflicting)).toBeInTheDocument();
  });
});

describe('gap rows', () => {
  const gap: KnowledgeGap = {
    dimension: 'image',
    status: 'missing',
    label: 'Openly licensed image',
    severity: 'high',
    evidence: 'No openly licensed image from the checked sources was confirmed for reuse.',
    contributionHint: 'A photograph released under an open licence would help visitors.',
  };

  it('shows the evidence behind a flag, not just a score', () => {
    render(<GapRow gap={gap} />);
    expect(screen.getByText('Openly licensed image')).toBeInTheDocument();
    expect(screen.getByText(/No openly licensed image from the checked sources/)).toBeInTheDocument();
    expect(screen.getByText(/How to help/)).toBeInTheDocument();
  });
});
