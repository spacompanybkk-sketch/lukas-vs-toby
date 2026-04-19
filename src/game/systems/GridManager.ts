import { GRID_ROWS, GRID_COLS, TILE_SIZE, GRID_OFFSET_X, GRID_OFFSET_Y } from '../constants';

export class GridManager {
  private cells: (string | null)[][];

  constructor() {
    this.cells = Array.from({ length: GRID_ROWS }, () =>
      Array.from({ length: GRID_COLS }, () => null)
    );
  }

  getRows(): number { return GRID_ROWS; }
  getCols(): number { return GRID_COLS; }

  isValid(row: number, col: number): boolean {
    return row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS;
  }

  isEmpty(row: number, col: number): boolean {
    return this.isValid(row, col) && this.cells[row][col] === null;
  }

  getUnitAt(row: number, col: number): string | null {
    if (!this.isValid(row, col)) return null;
    return this.cells[row][col];
  }

  place(row: number, col: number, unitId: string): boolean {
    if (!this.isValid(row, col) || !this.isEmpty(row, col)) return false;
    this.cells[row][col] = unitId;
    return true;
  }

  remove(row: number, col: number): void {
    if (this.isValid(row, col)) {
      this.cells[row][col] = null;
    }
  }

  toPixel(row: number, col: number): { x: number; y: number } {
    return {
      x: GRID_OFFSET_X + col * TILE_SIZE + TILE_SIZE / 2,
      y: GRID_OFFSET_Y + row * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  toGrid(x: number, y: number): { row: number; col: number } {
    return {
      row: Math.floor((y - GRID_OFFSET_Y) / TILE_SIZE),
      col: Math.floor((x - GRID_OFFSET_X) / TILE_SIZE),
    };
  }
}
