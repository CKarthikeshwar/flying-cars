import { describe, expect, it } from 'vitest';
import { unsupportedMessage, webglAvailable } from '../../src/ui/unsupported';

describe('webglAvailable', () => {
  it('is true when the browser hands out a WebGL context', () => {
    expect(webglAvailable(() => ({ getContext: () => ({}) }))).toBe(true);
  });

  it('falls back to the older WebGL when the newer one is missing', () => {
    const asked: string[] = [];
    const ok = webglAvailable(() => ({
      getContext: (kind: string) => {
        asked.push(kind);
        return kind === 'webgl' ? {} : null;
      },
    }));
    expect(ok).toBe(true);
    expect(asked).toEqual(['webgl2', 'webgl']);
  });

  it('is false when there is no context, or the browser throws', () => {
    expect(webglAvailable(() => ({ getContext: () => null }))).toBe(false);
    expect(
      webglAvailable(() => {
        throw new Error('blocked');
      }),
    ).toBe(false);
  });
});

describe('unsupportedMessage', () => {
  it('says something different for a missing WebGL and for a failed start', () => {
    const webgl = unsupportedMessage('webgl');
    const error = unsupportedMessage('error');
    expect(webgl.title).not.toBe(error.title);
    expect(webgl.lines.join(' ')).toMatch(/WebGL/);
    expect(error.lines.join(' ')).toMatch(/Reload/);
  });
});
