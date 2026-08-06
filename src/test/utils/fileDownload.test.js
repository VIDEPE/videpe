import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadTextFile } from '@/utils/fileDownload';

describe('downloadTextFile', () => {
  let createObjectURLSpy;
  let revokeObjectURLSpy;
  let clickSpy;
  let appendChildSpy;
  let removeChildSpy;
  let anchor;

  beforeEach(() => {
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // Intercepts only the <a> the function creates for the download — other elements
    // (jsdom's own setup, React internals if any run during this test) still go through
    // the real createElement.
    const realCreateElement = document.createElement.bind(document);
    clickSpy = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
      const el = realCreateElement(tagName);
      if (tagName === 'a') {
        anchor = el;
        anchor.click = clickSpy;
      }
      return el;
    });
    appendChildSpy = vi.spyOn(document.body, 'appendChild');
    removeChildSpy = vi.spyOn(document.body, 'removeChild');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a Blob object URL and triggers a download via a temporary anchor', () => {
    downloadTextFile('<xml>content</xml>', 'montage.mtg', 'text/xml');

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blob = createObjectURLSpy.mock.calls[0][0];
    expect(blob.type).toBe('text/xml');

    expect(anchor.download).toBe('montage.mtg');
    expect(anchor.href).toBe('blob:mock-url');
    expect(appendChildSpy).toHaveBeenCalledWith(anchor);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(removeChildSpy).toHaveBeenCalledWith(anchor);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  it('defaults the mime type to text/xml when not given', () => {
    downloadTextFile('content', 'file.mtg');
    const blob = createObjectURLSpy.mock.calls[0][0];
    expect(blob.type).toBe('text/xml');
  });
});
