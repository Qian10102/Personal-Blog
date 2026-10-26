import test from "node:test";
import assert from "node:assert/strict";
import { loadAllRows } from "../src/lib/load-all-rows.ts";

test("reads all 2970 vocabulary rows through server caps, including smaller caps", async () => {
  const source = Array.from({ length: 2970 }, (_, id) => ({ id }));
  for (const cap of [1000, 250]) {
    const rows = await loadAllRows(async (from, to) => ({
      data: source.slice(from, Math.min(to + 1, from + cap)),
      error: null,
    }));
    assert.deepEqual(rows, source);
  }
});

test("handles empty tables and an exact page boundary", async () => {
  for (const length of [0, 1000, 2000]) {
    const source = Array.from({ length }, (_, id) => id);
    const result = await loadAllRows(async (from, to) => ({
      data: source.slice(from, to + 1),
      error: null,
    }));
    assert.deepEqual(result, source);
  }
});

test("a failed later page rejects rather than returning a partial vocabulary", async () => {
  const error = new Error("network failure");
  await assert.rejects(
    loadAllRows(async (from) =>
      from === 0
        ? { data: Array.from({ length: 1000 }, (_, id) => id), error: null }
        : { data: null, error },
    ),
    error,
  );
});
