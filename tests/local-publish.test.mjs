import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  stageRelease,
  activateRelease,
  rollbackRelease,
  withPublishLock,
} from "../scripts/publish-local.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "blog-publish-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const siteRoot = join(root, "site");
  async function release(name) {
    const sourceDir = join(root, name);
    await mkdir(join(sourceDir, "_astro"), { recursive: true });
    await writeFile(join(sourceDir, "index.html"), `<h1>${name}</h1>`);
    await writeFile(join(sourceDir, "_astro", name + ".js"), name);
    return stageRelease({ sourceDir, siteRoot, name });
  }
  return { root, siteRoot, release };
}

test("stage does not publish; activation and rollback keep old hashed assets available", async (t) => {
  const { siteRoot, release } = await fixture(t);
  await release("first");
  await activateRelease({ siteRoot, name: "first" });
  await release("second");
  assert.equal(await readlink(join(siteRoot, "current")), "releases/first");
  await activateRelease({
    siteRoot,
    name: "second",
    verify: async (path) => {
      assert.equal(
        await readFile(join(path, "index.html"), "utf8"),
        "<h1>second</h1>",
      );
    },
  });
  assert.equal(await readlink(join(siteRoot, "previous")), "releases/first");
  assert.equal(
    await readFile(join(siteRoot, "_astro/first.js"), "utf8"),
    "first",
  );
  assert.equal(
    await readFile(join(siteRoot, "_astro/second.js"), "utf8"),
    "second",
  );
  await rollbackRelease({ siteRoot });
  assert.equal(await readlink(join(siteRoot, "current")), "releases/first");
  assert.equal(await readlink(join(siteRoot, "previous")), "releases/second");
});

test("a failed post-publication check restores both current and previous releases", async (t) => {
  const { siteRoot, release } = await fixture(t);
  for (const name of ["first", "second", "broken"]) await release(name);
  await activateRelease({ siteRoot, name: "first" });
  await activateRelease({ siteRoot, name: "second" });
  await assert.rejects(
    activateRelease({
      siteRoot,
      name: "broken",
      verify: async () => {
        throw new Error("simulated HTTP verification failure");
      },
    }),
    /simulated HTTP/,
  );
  assert.equal(await readlink(join(siteRoot, "current")), "releases/second");
  assert.equal(await readlink(join(siteRoot, "previous")), "releases/first");
});

test("invalid output cannot replace the live website", async (t) => {
  const { root, siteRoot, release } = await fixture(t);
  await release("live");
  await activateRelease({ siteRoot, name: "live" });
  const empty = join(root, "empty");
  await mkdir(empty);
  await assert.rejects(
    stageRelease({ sourceDir: empty, siteRoot, name: "invalid" }),
  );
  assert.equal(await readlink(join(siteRoot, "current")), "releases/live");
});

test("concurrent publication is rejected and the lock is released after failure", async (t) => {
  const { siteRoot } = await fixture(t);
  await assert.rejects(
    withPublishLock(siteRoot, async () => {
      await assert.rejects(
        withPublishLock(siteRoot, async () => {}),
        /另一个本地发布/,
      );
      throw new Error("simulated build failure");
    }),
    /simulated build/,
  );
  assert.equal(await withPublishLock(siteRoot, async () => "ready"), "ready");
});
