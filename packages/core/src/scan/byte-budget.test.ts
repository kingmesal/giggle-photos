import { describe, expect, test } from "bun:test";
import { ByteBudget } from "./byte-budget";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ByteBudget", () => {
  test("admits requests that fit and blocks the one that does not", async () => {
    const budget = new ByteBudget(100);
    const releaseA = await budget.acquire(60);
    let bAdmitted = false;
    const b = budget.acquire(50).then((release) => {
      bAdmitted = true;
      return release;
    });
    await tick();
    expect(bAdmitted).toBe(false);
    expect(budget.bytesInUse).toBe(60);
    releaseA();
    const releaseB = await b;
    expect(bAdmitted).toBe(true);
    expect(budget.bytesInUse).toBe(50);
    releaseB();
    expect(budget.bytesInUse).toBe(0);
  });

  test("a request larger than the whole budget runs alone instead of deadlocking", async () => {
    const budget = new ByteBudget(100);
    const releaseSmall = await budget.acquire(10);
    let hugeAdmitted = false;
    const huge = budget.acquire(500).then((release) => {
      hugeAdmitted = true;
      return release;
    });
    await tick();
    expect(hugeAdmitted).toBe(false);
    releaseSmall();
    const releaseHuge = await huge;
    expect(hugeAdmitted).toBe(true);
    expect(budget.bytesInUse).toBe(500);
    releaseHuge();
  });

  test("is FIFO: a waiting large request is not overtaken by later small ones", async () => {
    const budget = new ByteBudget(100);
    const order: string[] = [];
    const releaseFirst = await budget.acquire(80);
    const track = (name: string) => (release: () => void) => {
      order.push(name);
      return release;
    };
    const large = budget.acquire(90).then(track("large"));
    const small = budget.acquire(10).then(track("small"));
    await tick();
    expect(order).toEqual([]);
    releaseFirst();
    (await large)();
    (await small)();
    expect(order).toEqual(["large", "small"]);
  });

  test("release is idempotent", async () => {
    const budget = new ByteBudget(100);
    const release = await budget.acquire(40);
    release();
    release();
    expect(budget.bytesInUse).toBe(0);
  });

  test("rejects a non-positive limit", () => {
    expect(() => new ByteBudget(0)).toThrow();
  });
});
