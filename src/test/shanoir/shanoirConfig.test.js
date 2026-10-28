import { describe, it, expect, vi, afterEach } from 'vitest';
import { getShanoirConfig } from '@/shanoir/shanoirConfig';

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

  // Every field × every blank value, as [field, value] rows: [['authority', ''], ['authority', ' '], …]
  it.each(
    ['authority', 'clientId', 'apiBase'].flatMap((field) =>
      ['', ' '].map((value) => [field, value])
    )
  )('returns null and warns when %s is %j', (field, value) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shanoir = { ...VALID_SHANOIR, [field]: value };
    expect(getShanoirConfig({ shanoir })).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(field));
  });

  it('treats unfilled deployment placeholders as missing', () => {
    // Shanoir's nginx entrypoint substitutes placeholders like SHANOIR_KEYCLOAK_URL at
    // startup — if that step is skipped, the raw placeholder must not be used as a URL.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shanoir = { ...VALID_SHANOIR, authority: 'SHANOIR_KEYCLOAK_URL/realms/shanoir-ng' };
    expect(getShanoirConfig({ shanoir })).toBeNull();
  });

  // The Shanoir access token is sent to apiBase, so it must stay on the viewer host, proxied
  // there as the integration guide describes. The tricky paths are tested in
  // configValidation.test.js (resolveSameOriginPath); one case of each kind here.
  it('returns null and warns when apiBase is a relative path', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shanoir = { ...VALID_SHANOIR, apiBase: 'shanoir-ng/datasets' };
    expect(getShanoirConfig({ shanoir })).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('apiBase (must start with /)'));
  });

  it.each([
    'https://shanoir.example/shanoir-ng/datasets',
    '/\\evil.example/api', // slash + backslash: starts with '/', but leads to another server
  ])('returns null and warns when apiBase %j is not a same-origin path', (value) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shanoir = { ...VALID_SHANOIR, apiBase: value };
    expect(getShanoirConfig({ shanoir })).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('apiBase (not on same-origin path)'));
  });
});
