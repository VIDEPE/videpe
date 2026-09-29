import { describe, it, expect, vi, afterEach } from 'vitest';
import { getShanoirConfig } from '@/config/appConfig';

const VALID_SHANOIR = {
  authority: 'https://shanoir.example/auth/realms/shanoir-ng',
  clientId: 'videpe',
  apiBase: '/shanoir-ng/datasets',
};

describe('getShanoirConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when no runtime config is present (e.g. app-config.js missing)', () => {
    expect(getShanoirConfig(undefined)).toBeNull();
  });

  it('returns null when Shanoir is disabled (the GitHub Pages default)', () => {
    expect(getShanoirConfig({ shanoir: null })).toBeNull();
  });

  it('returns the validated config', () => {
    expect(getShanoirConfig({ shanoir: VALID_SHANOIR })).toEqual(VALID_SHANOIR);
  });

  it('strips a trailing slash from apiBase so paths can be appended safely', () => {
    const config = getShanoirConfig({
      shanoir: { ...VALID_SHANOIR, apiBase: '/shanoir-ng/datasets/' },
    });
    expect(config.apiBase).toBe('/shanoir-ng/datasets');
  });

  it.each(['authority', 'clientId', 'apiBase'])(
    'returns null and warns when %s is missing',
    (field) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const shanoir = { ...VALID_SHANOIR, [field]: undefined };
      expect(getShanoirConfig({ shanoir })).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(field));
    }
  );

  it('treats unfilled deployment placeholders as missing', () => {
    // Shanoir's nginx entrypoint substitutes placeholders like SHANOIR_KEYCLOAK_URL at
    // startup — if that step is skipped, the raw placeholder must not be used as a URL.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shanoir = { ...VALID_SHANOIR, authority: 'SHANOIR_KEYCLOAK_URL/realms/shanoir-ng' };
    expect(getShanoirConfig({ shanoir })).toBeNull();
  });
});
