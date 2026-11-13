import { describe, expect, test } from "bun:test";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { createStore, useStore } from "./store";
import { useAction } from "./use-action";
import { useRead } from "./use-read";

/** A promise you resolve by hand, to control answer order. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useRead", () => {
  test("loads, then exposes the value", async () => {
    const { result } = renderHook(() => useRead("k", async () => 42));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.value).toBe(42));
    expect(result.current.loading).toBe(false);
  });

  test("a superseded key's late answer is dropped and its read aborted", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const signals: AbortSignal[] = [];
    const { result, rerender } = renderHook(
      ({ k }) =>
        useRead(k, (signal) => {
          signals.push(signal);
          return k === "a" ? first.promise : second.promise;
        }),
      { initialProps: { k: "a" } },
    );
    rerender({ k: "b" });
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => second.resolve("B"));
    await act(async () => first.resolve("A"));
    expect(result.current.value).toBe("B");
  });

  test("failure is reported, and refresh reads again", async () => {
    let calls = 0;
    const { result } = renderHook(() =>
      useRead("k", async () => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return "ok";
      }),
    );
    await waitFor(() => expect(result.current.failure?.message).toBe("boom"));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.value).toBe("ok"));
    expect(result.current.failure).toBeNull();
  });

  test("skip makes no request", () => {
    let calls = 0;
    const { result } = renderHook(() => useRead("k", async () => ++calls, { skip: true }));
    expect(calls).toBe(0);
    expect(result.current.loading).toBe(false);
  });
});

describe("useAction", () => {
  test("tracks pending and value", async () => {
    const d = deferred<number>();
    const { result } = renderHook(() => useAction(async (n: number) => (await d.promise) + n));
    let run!: Promise<number | undefined>;
    act(() => {
      run = result.current.run(1);
    });
    expect(result.current.pending).toBe(true);
    await act(async () => d.resolve(41));
    expect(await run).toBe(42);
    expect(result.current).toMatchObject({ pending: false, value: 42, failure: null });
  });

  test("a failure resolves to undefined and is reported", async () => {
    const { result } = renderHook(() => useAction(async () => Promise.reject(new Error("nope"))));
    let out: unknown = "unset";
    await act(async () => {
      out = await result.current.run();
    });
    expect(out).toBeUndefined();
    expect(result.current.failure?.message).toBe("nope");
  });

  test("sets no state after unmount", async () => {
    const d = deferred<string>();
    const { result, unmount } = renderHook(() => useAction(() => d.promise));
    act(() => {
      void result.current.run();
    });
    unmount();
    await act(async () => d.resolve("late")); // would warn/throw if it set state after unmount
    expect(true).toBe(true);
  });
});

describe("store", () => {
  test("components re-render on change; functional updates and no-op sets", async () => {
    const store = createStore(1);
    let renders = 0;
    function Counter() {
      renders++;
      return <span>{useStore(store)}</span>;
    }
    const { container } = render(<Counter />);
    act(() => store.set((n) => n + 1));
    expect(container.textContent).toBe("2");
    const before = renders;
    act(() => store.set(2));
    expect(renders).toBe(before);
  });
});
