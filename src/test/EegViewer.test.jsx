import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EegViewer } from '@/components/EegViewer';

vi.mock('uplot-react', () => ({ default: () => null }));

describe('EegViewer', () => {
  describe('Loading data', () => {
    it('it loads test data and shows it', () => {
      expect(false).toBe(true);
    });
  });
});
