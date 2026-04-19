import { describe, it, expect } from 'vitest';
import { GridManager } from '../src/game/systems/GridManager';

describe('GridManager', () => {
  it('initializes a 5x10 grid of empty cells', () => {
    const grid = new GridManager();
    expect(grid.getRows()).toBe(5);
    expect(grid.getCols()).toBe(10);
    expect(grid.isEmpty(0, 0)).toBe(true);
    expect(grid.isEmpty(4, 9)).toBe(true);
  });

  it('rejects out-of-bounds positions', () => {
    const grid = new GridManager();
    expect(grid.isValid(-1, 0)).toBe(false);
    expect(grid.isValid(5, 0)).toBe(false);
    expect(grid.isValid(0, 10)).toBe(false);
  });

  it('places and removes a unit ID', () => {
    const grid = new GridManager();
    grid.place(2, 3, 'unit-1');
    expect(grid.isEmpty(2, 3)).toBe(false);
    expect(grid.getUnitAt(2, 3)).toBe('unit-1');
    grid.remove(2, 3);
    expect(grid.isEmpty(2, 3)).toBe(true);
  });

  it('prevents placing on an occupied cell', () => {
    const grid = new GridManager();
    grid.place(0, 0, 'unit-1');
    expect(grid.place(0, 0, 'unit-2')).toBe(false);
  });

  it('converts grid position to pixel coordinates', () => {
    const grid = new GridManager();
    const pos = grid.toPixel(0, 0);
    expect(pos.x).toBeGreaterThan(0);
    expect(pos.y).toBeGreaterThan(0);
  });

  it('converts pixel coordinates to grid position', () => {
    const grid = new GridManager();
    const pixel = grid.toPixel(2, 5);
    const cell = grid.toGrid(pixel.x, pixel.y);
    expect(cell.row).toBe(2);
    expect(cell.col).toBe(5);
  });
});
