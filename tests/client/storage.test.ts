// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { readStored, writeStored } from '../../src/client/storage.js';

afterEach(() => localStorage.clear());

describe('remembering things across a rename', () => {
  it('reads and writes under the app’s own name', () => {
    writeStored('locale', 'uk');
    expect(localStorage.getItem('duren.locale')).toBe('uk');
    expect(readStored('locale')).toBe('uk');
  });

  it('adopts what the old name left behind', () => {
    // The game was called Durak first. Renaming the keys outright would have
    // quietly reset everybody's language, theme and deck, and dropped the token
    // holding their seat in a live room.
    localStorage.setItem('durak.settings', '{"skin":"classic"}');
    expect(readStored('settings')).toBe('{"skin":"classic"}');
    expect(localStorage.getItem('duren.settings')).toBe('{"skin":"classic"}');
  });

  it('leaves the old key alone, so an older tab keeps working', () => {
    localStorage.setItem('durak.token', 'abc');
    readStored('token');
    expect(localStorage.getItem('durak.token')).toBe('abc');
  });

  it('prefers the current name once there is something under it', () => {
    localStorage.setItem('durak.locale', 'sk');
    localStorage.setItem('duren.locale', 'en');
    expect(readStored('locale')).toBe('en');
  });

  it('says nothing rather than inventing a default', () => {
    expect(readStored('nothing-here')).toBeNull();
  });
});
