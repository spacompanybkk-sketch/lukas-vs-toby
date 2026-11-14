import { Mesh, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { Weather, type WeatherKind } from '../../src/render/world/Weather';
import { allocationsIn } from './allocations';

const KINDS: WeatherKind[] = ['fireflies', 'dust', 'snow', 'embers'];

describe('Weather', () => {
  it('is nothing at all in a world without weather', () => {
    const none = new Weather('none');
    expect(none.mesh).toBeNull();
    expect(() => (none.update(3), none.dispose())).not.toThrow();
  });

  it.each(KINDS)('draws %s as one instanced mesh that never writes depth or casts a shadow', (kind) => {
    const weather = new Weather(kind);
    const mesh = weather.mesh as Mesh;
    expect(mesh).toBeInstanceOf(Mesh);
    expect((mesh.geometry as unknown as { instanceCount: number }).instanceCount).toBeGreaterThan(20);
    const material = mesh.material as ShaderMaterial;
    expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(true);
    expect(mesh.castShadow).toBe(false);
    // Under the health bars, which draw at 20 with no depth test.
    expect(mesh.renderOrder).toBeLessThan(20);
    weather.dispose();
  });

  it.each(KINDS)('moves %s on by one uniform write, allocating nothing', (kind) => {
    const weather = new Weather(kind);
    const uniform = ((weather.mesh as Mesh).material as ShaderMaterial).uniforms.uTime as { value: number };
    const counts = allocationsIn(() => {
      for (let i = 0; i < 100; i++) weather.update(i / 60);
    });
    expect(counts).toEqual({});
    expect(uniform.value).toBeCloseTo(99 / 60, 6);
    weather.dispose();
  });

  it('blinks fireflies hard on and off (square pixels, never a soft fade) with a glow that stays tight', () => {
    const weather = new Weather('fireflies');
    const material = (weather.mesh as Mesh).material as ShaderMaterial;
    expect(material.vertexShader).toContain('step(0.35, blink)');
    expect(material.vertexShader).not.toContain('smoothstep(0.15, 0.6, blink)');
    expect(material.uniforms.uGlow!.value).toBeLessThanOrEqual(2);
    weather.dispose();
  });
});
