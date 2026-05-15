/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { createTexturePool } from "@workglow/util/media";
import { describe, expect, test, vi } from "vitest";

interface FakeTexture {
  w: number;
  h: number;
  destroyed: boolean;
  destroy: () => void;
}

function makeFakeDevice(onCreate?: (t: FakeTexture) => void): GPUDevice {
  return {
    createTexture: ({ size }: { size: [number, number, number] }) => {
      const t: FakeTexture = {
        w: size[0],
        h: size[1],
        destroyed: false,
        destroy() {
          this.destroyed = true;
        },
      };
      onCreate?.(t);
      return t;
    },
  } as unknown as GPUDevice;
}

describe("TexturePool", () => {
  test("releasing then re-acquiring the same size class returns the same texture", () => {
    const created: FakeTexture[] = [];
    const pool = createTexturePool(
      makeFakeDevice((t) => created.push(t)),
      { capacityPerSize: 8 }
    );
    const a = pool.acquire(64, 64, "rgba8unorm") as unknown as FakeTexture;
    pool.release(a as unknown as GPUTexture);
    const b = pool.acquire(64, 64, "rgba8unorm") as unknown as FakeTexture;
    expect(b).toBe(a);
    expect(created).toHaveLength(1);
  });

  test("size-class miss creates a new texture", () => {
    const created: FakeTexture[] = [];
    const pool = createTexturePool(
      makeFakeDevice((t) => created.push(t)),
      { capacityPerSize: 8 }
    );
    const a = pool.acquire(64, 64, "rgba8unorm") as unknown as FakeTexture;
    pool.release(a as unknown as GPUTexture);
    pool.acquire(128, 128, "rgba8unorm");
    expect(created).toHaveLength(2);
  });

  test("evicts when bucket is full (destroys the over-cap texture)", () => {
    // Acquire three distinct textures of the same size class while the bucket
    // is empty, then release all three. The third release exceeds the cap of 2.
    const destroyed: FakeTexture[] = [];
    const fakeDevice = {
      createTexture: () => {
        const t: FakeTexture = {
          w: 8,
          h: 8,
          destroyed: false,
          destroy() {
            this.destroyed = true;
            destroyed.push(this);
          },
        };
        return t;
      },
    } as unknown as GPUDevice;
    const pool = createTexturePool(fakeDevice, { capacityPerSize: 2 });
    const a = pool.acquire(8, 8, "rgba8unorm");
    const b = pool.acquire(8, 8, "rgba8unorm");
    const c = pool.acquire(8, 8, "rgba8unorm");
    pool.release(a);
    pool.release(b);
    pool.release(c);
    expect(destroyed).toHaveLength(1);
  });

  test("does not evict on heavy reuse of the same texture (length-based, not count-based)", () => {
    const destroyed: FakeTexture[] = [];
    const fakeDevice = {
      createTexture: () => {
        const t: FakeTexture = {
          w: 8,
          h: 8,
          destroyed: false,
          destroy() {
            this.destroyed = true;
            destroyed.push(this);
          },
        };
        return t;
      },
    } as unknown as GPUDevice;
    const pool = createTexturePool(fakeDevice, { capacityPerSize: 2 });
    let t = pool.acquire(8, 8, "rgba8unorm");
    for (let i = 0; i < 50; i++) {
      pool.release(t);
      t = pool.acquire(8, 8, "rgba8unorm");
    }
    expect(destroyed).toHaveLength(0); // only one texture ever lived; reuse counts must not destroy it
  });

  test("release of a non-pool texture is a no-op (does not throw)", () => {
    const pool = createTexturePool(makeFakeDevice(), { capacityPerSize: 8 });
    const fake = { destroyed: false, destroy: vi.fn() } as unknown as GPUTexture;
    expect(() => pool.release(fake)).not.toThrow();
  });

  test("double-release of the same texture is idempotent (no duplicate entries)", () => {
    const destroyed: FakeTexture[] = [];
    const fakeDevice = {
      createTexture: () => {
        const t: FakeTexture = {
          w: 8,
          h: 8,
          destroyed: false,
          destroy() {
            this.destroyed = true;
            destroyed.push(this);
          },
        };
        return t;
      },
    } as unknown as GPUDevice;
    const pool = createTexturePool(fakeDevice, { capacityPerSize: 8 });
    const a = pool.acquire(8, 8, "rgba8unorm");
    pool.release(a);
    pool.release(a);
    pool.release(a);
    // drain should only destroy one entry, not three
    pool.drain();
    expect(destroyed).toHaveLength(1);
  });

  test("releasing a capacity-evicted texture again is a no-op (no double-destroy push)", () => {
    const destroyed: FakeTexture[] = [];
    const fakeDevice = {
      createTexture: () => {
        const t: FakeTexture = {
          w: 8,
          h: 8,
          destroyed: false,
          destroy() {
            this.destroyed = true;
            destroyed.push(this);
          },
        };
        return t;
      },
    } as unknown as GPUDevice;
    const pool = createTexturePool(fakeDevice, { capacityPerSize: 1 });
    const a = pool.acquire(8, 8, "rgba8unorm");
    const b = pool.acquire(8, 8, "rgba8unorm");
    pool.release(a); // pooled
    pool.release(b); // exceeds cap → destroyed
    expect(destroyed).toHaveLength(1);
    // releasing b again must not re-destroy nor push
    pool.release(b);
    expect(destroyed).toHaveLength(1);
    // after drain, only a is destroyed (one new entry)
    pool.drain();
    expect(destroyed).toHaveLength(2);
  });

  test("drain destroys all pooled textures and clears the pool", () => {
    const destroyed: FakeTexture[] = [];
    const fakeDevice = {
      createTexture: () => {
        const t: FakeTexture = {
          w: 8,
          h: 8,
          destroyed: false,
          destroy() {
            this.destroyed = true;
            destroyed.push(this);
          },
        };
        return t;
      },
    } as unknown as GPUDevice;
    const pool = createTexturePool(fakeDevice, { capacityPerSize: 8 });
    pool.release(pool.acquire(8, 8, "rgba8unorm"));
    pool.release(pool.acquire(16, 16, "rgba8unorm"));
    pool.drain();
    expect(destroyed).toHaveLength(2);
    // After drain, acquiring should create fresh textures.
    pool.acquire(8, 8, "rgba8unorm");
    expect(destroyed).toHaveLength(2); // no extra destroys from drain
  });
});
