import { describe, it, expect } from 'vitest';
import { isNonEmptyString, resolveSameOriginPath } from '@/utils/configValidation';

describe('isNonEmptyString', () => {
  it.each(['a', ' a '])('accepts %j', (value) => {
    expect(isNonEmptyString(value)).toBe(true);
  });

  it.each(['', ' ', undefined, null, 42])('rejects %j', (value) => {
    expect(isNonEmptyString(value)).toBe(false);
  });
});

// jsdom's page address in the tests is http://localhost:3000/, so "same origin" means that server
describe('resolveSameOriginPath', () => {
  it.each(['/api', '/some/nested/api'])('accepts the same-origin path %j', (value) => {
    expect(resolveSameOriginPath(value)).toEqual({ path: value, problem: null });
  });

  it('strips a trailing slash so paths can be appended safely', () => {
    expect(resolveSameOriginPath('/api/').path).toBe('/api');
  });

  it.each(['api', 'api/v1', './api', '../api'])('rejects the relative path %j', (value) => {
    expect(resolveSameOriginPath(value)).toEqual({ path: null, problem: 'must start with /' });
  });

  it.each([
    'https://evil.example/api',
    '//evil.example/api',
    '/\\evil.example/api', // slash + backslash
    '\\\\evil.example/api', // two backslashes
    '\\/evil.example/api', // backslash + slash
    '/\t/evil.example/api', // a tab between the slashes is removed
    '/\n/evil.example/api', // so is a line break
    'http://[', // can't be parsed at all (new URL throws)
  ])('rejects %j, which leads to another server', (value) => {
    expect(resolveSameOriginPath(value)).toEqual({
      path: null,
      problem: 'not on same-origin path',
    });
  });
});
