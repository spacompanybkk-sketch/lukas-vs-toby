import { Color, Euler, Matrix4, Object3D, Quaternion, Vector3 } from 'three';

// Counts the allocations a piece of frame-loop code makes that can be seen from outside: a
// new array from a callback method (forEach, map, filter, …) or an array iterator (for…of,
// destructuring, spread), and a cloned three.js vector, matrix, quaternion, colour, euler or
// object. Object literals and closures cannot be watched this way; the classes avoid them in
// their update paths by construction (indexed loops over preallocated fields).

type Patch = { target: object; key: PropertyKey; original: unknown };

const ARRAY_METHODS = ['forEach', 'map', 'filter', 'reduce', 'find', 'findIndex', 'some', 'every', 'slice', 'concat', 'flatMap', 'entries', 'values', 'keys'] as const;
const CLONED = [Vector3, Matrix4, Quaternion, Color, Euler, Object3D] as const;

/** Runs `fn` and returns how many watched allocations it made, by name. */
export function allocationsIn(fn: () => void): Record<string, number> {
  const counts: Record<string, number> = {};
  const patches: Patch[] = [];
  const watch = (target: object, key: PropertyKey, label: string): void => {
    const original = (target as Record<PropertyKey, unknown>)[key] as (...args: unknown[]) => unknown;
    patches.push({ target, key, original });
    // Rest parameters and Reflect.apply use no iterator, so the wrapper cannot count itself.
    (target as Record<PropertyKey, unknown>)[key] = function (this: unknown, ...args: unknown[]): unknown {
      counts[label] = (counts[label] ?? 0) + 1;
      return Reflect.apply(original, this, args);
    };
  };
  for (let i = 0; i < CLONED.length; i++) watch(CLONED[i]!.prototype, 'clone', `${CLONED[i]!.name}.clone`);
  for (let i = 0; i < ARRAY_METHODS.length; i++) watch(Array.prototype, ARRAY_METHODS[i]!, `Array.${ARRAY_METHODS[i]}`);
  // Last, so setting up the watch does not count itself.
  watch(Array.prototype, Symbol.iterator, 'Array[Symbol.iterator]');
  try {
    fn();
  } finally {
    for (let i = patches.length - 1; i >= 0; i--) {
      const p = patches[i] as Patch;
      (p.target as Record<PropertyKey, unknown>)[p.key] = p.original;
    }
  }
  return counts;
}
