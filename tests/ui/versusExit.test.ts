import { describe, expect, it } from 'vitest';
import { versusExit } from '../../src/ui/App';

describe('where the screen goes when the Versus flow closes', () => {
  it('the list or the card, logged in: the Play menu it came from', () => {
    expect(versusExit('here', true)).toBe('play');
    expect(versusExit('card', true)).toBe('play');
  });
  it('the list or the card after a logout: the title, not a Play menu with nobody on it', () => {
    expect(versusExit('here', false)).toBe('title');
    expect(versusExit('card', false)).toBe('title');
  });
  it('a battle that ends: Home when logged in, the title when not', () => {
    expect(versusExit('battle', true)).toBe('home');
    expect(versusExit('battle', false)).toBe('title');
  });
});
