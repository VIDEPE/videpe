import { describe, it, expect, vi, afterEach } from 'vitest';
import { getHostAppConfig } from '@/hostApp/hostAppConfig';

const VALID_HOSTAPP = {
  name: 'Host App',
  apiBase: '/datasets',
};

describe('getHostAppConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when no runtime config is present (e.g. app-config.js missing)', () => {
    expect(getHostAppConfig(undefined)).toBeNull();
  });

  it('returns null when the HostApp is disabled (the GitHub Pages default)', () => {
    expect(getHostAppConfig({ hostApp: null })).toBeNull();
  });

  it('returns null, without a warning, for a config that leaves the hostApp section out', () => {
    // e.g. Shanoir's deployment, which only writes its own section: left out means switched off
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shanoirOnly = {
      shanoir: {
        authority: 'https://shanoir.example/auth/realms/shanoir-ng',
        clientId: 'videpe',
        apiBase: '/shanoir-ng/datasets',
      },
    };
    expect(getHostAppConfig(shanoirOnly)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns the validated config', () => {
    expect(getHostAppConfig({ hostApp: VALID_HOSTAPP })).toEqual(VALID_HOSTAPP);
  });

  it('strips a trailing slash from apiBase so paths can be appended safely', () => {
    const config = getHostAppConfig({
      hostApp: { ...VALID_HOSTAPP, apiBase: '/datasets/' },
    });
    expect(config.apiBase).toBe('/datasets');
  });

  it.each(['name', 'apiBase'])('returns null and warns when %s is missing', (field) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hostApp = { ...VALID_HOSTAPP, [field]: undefined };
    expect(getHostAppConfig({ hostApp })).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(field));
  });

  // Every field × every blank value, as [field, value] rows: [['name', ''], ['name', ' '], …]
  it.each(['name', 'apiBase'].flatMap((field) => ['', ' '].map((value) => [field, value])))(
    'returns null and warns when %s is %j',
    (field, value) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const hostApp = { ...VALID_HOSTAPP, [field]: value };
      expect(getHostAppConfig({ hostApp })).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(field));
    }
  );

  // The tricky paths are tested in configValidation.test.js (resolveSameOriginPath); one case
  // of each kind here shows getHostAppConfig rejects them and names the reason in the warning.
  it('returns null and warns when apiBase is a relative path', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hostApp = { ...VALID_HOSTAPP, apiBase: 'api' };
    expect(getHostAppConfig({ hostApp })).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('apiBase (must start with /)'));
  });

  it.each([
    'https://evil.example/api',
    '/\\evil.example/api', // slash + backslash: starts with '/', but leads to another server
  ])('returns null and warns when apiBase %j is not a same-origin path', (value) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hostApp = { ...VALID_HOSTAPP, apiBase: value };
    expect(getHostAppConfig({ hostApp })).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('apiBase (not on same-origin path'));
  });

  it.each(['/api', '/some/nested/api'])('accepts the same-origin path %j', (value) => {
    expect(getHostAppConfig({ hostApp: { ...VALID_HOSTAPP, apiBase: value } })?.apiBase).toBe(
      value
    );
  });
});
