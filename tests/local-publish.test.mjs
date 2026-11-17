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
import { dirname, join } from "node:path";
import { createServer } from "node:http";
import {
  stageRelease,
  activateRelease,
  rollbackRelease,
  withPublishLock,
  verifyLocal,
} from "../scripts/publish-local.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "blog-publish-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const siteRoot = join(root, "site");
  async function release(name, extraFiles = {}) {
    const sourceDir = join(root, name);
    await mkdir(join(sourceDir, "_astro"), { recursive: true });
    await writeFile(join(sourceDir, "index.html"), `<h1>${name}</h1>`);
    await writeFile(join(sourceDir, "_astro", name + ".js"), name);
    for (const [file, content] of Object.entries(extraFiles)) {
      const path = join(sourceDir, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
    return stageRelease({ sourceDir, siteRoot, name });
  }
  return { root, siteRoot, release };
}

async function verificationServer(t, handler) {
  const server = createServer((request, response) => {
    Promise.resolve()
      .then(() => handler(request, response))
      .catch((error) => response.destroy(error));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

async function serveRelease(releasePath, request, response) {
  let name = decodeURIComponent(request.url.slice(1));
  if (!name || name.endsWith("/")) name += "index.html";
  response.end(await readFile(join(releasePath, name)));
}

test("verification accepts a matching release immediately and checks every learning page and asset", async (t) => {
  const { release } = await fixture(t);
  const staged = await release("new", {
    "vocabulary/index.html": "vocabulary",
    "vocabulary/conjugation/index.html": "conjugation",
    "review-planner/index.html": "planner",
    "_astro/z-last.js": "last asset",
  });
  const requested = [];
  const baseUrl = await verificationServer(t, (request, response) => {
    requested.push(request.url);
    return serveRelease(staged.path, request, response);
  });
  await verifyLocal(staged.path, {
    baseUrl,
    timeoutMs: 2000,
    onRetry: () => assert.fail("Matching content should not retry"),
  });
  assert.deepEqual(
    requested.sort(),
    [
      "/",
      "/vocabulary/",
      "/vocabulary/conjugation/",
      "/review-planner/",
      "/_astro/new.js",
      "/_astro/z-last.js",
    ].sort(),
  );
});

test("verification waits for stale HTML, missing assets and stale later assets to converge", async (t) => {
  const { release } = await fixture(t);
  const staged = await release("new", { "_astro/z-last.js": "last asset" });
  let homeRequests = 0;
  let firstAssetRequests = 0;
  let lastAssetRequests = 0;
  const failures = [];
  const baseUrl = await verificationServer(t, (request, response) => {
    if (request.url === "/" && ++homeRequests <= 2)
      return response.end("previous homepage");
    if (request.url === "/_astro/new.js" && ++firstAssetRequests === 1) {
      response.statusCode = 404;
      return response.end("not synced yet");
    }
    if (request.url === "/_astro/z-last.js" && ++lastAssetRequests === 1)
      return response.end("previous asset");
    return serveRelease(staged.path, request, response);
  });
  await verifyLocal(staged.path, {
    baseUrl,
    timeoutMs: 2000,
    intervalMs: 5,
    onRetry: (error) => failures.push(error.message),
  });
  assert.equal(homeRequests, 5);
  assert.equal(failures.length, 4);
  assert.match(failures[0], /返回内容与发布版本不一致/);
  assert.match(failures[2], /HTTP 404/);
  assert.match(failures[3], /z-last\.js/);
});

test("verification recovers from connection errors and response body timeouts", async (t) => {
  const { release } = await fixture(t);
  const staged = await release("new");
  let homeRequests = 0;
  const failures = [];
  const baseUrl = await verificationServer(t, (request, response) => {
    if (request.url === "/") {
      homeRequests++;
      if (homeRequests === 1) return response.destroy();
      if (homeRequests === 2) {
        response.writeHead(200);
        response.flushHeaders();
        return; // Headers arrive, but the body never finishes.
      }
    }
    return serveRelease(staged.path, request, response);
  });
  await verifyLocal(staged.path, {
    baseUrl,
    timeoutMs: 2000,
    intervalMs: 5,
    requestTimeoutMs: 100,
    onRetry: (error) => failures.push(error),
  });
  assert.equal(homeRequests, 3);
  assert.equal(failures.length, 2);
  assert.match(failures[1].cause.name, /^(AbortError|TimeoutError)$/);
});

test("persistent content mismatch expires, restores release links and releases the publish lock", async (t) => {
  const { siteRoot, release } = await fixture(t);
  await release("first");
  await activateRelease({ siteRoot, name: "first" });
  await release("second");
  await activateRelease({ siteRoot, name: "second" });
  await release("broken");
  const baseUrl = await verificationServer(t, (_request, response) => {
    response.end("permanently wrong content");
  });
  await assert.rejects(
    withPublishLock(siteRoot, () =>
      activateRelease({
        siteRoot,
        name: "broken",
        verify: (path) =>
          verifyLocal(path, {
            baseUrl,
            timeoutMs: 100,
            intervalMs: 10,
            onRetry: () => {},
          }),
      }),
    ),
    /等待 Docker 文件同步超时.*本机网站内容检查失败/,
  );
  assert.equal(await readlink(join(siteRoot, "current")), "releases/second");
  assert.equal(await readlink(join(siteRoot, "previous")), "releases/first");
  await assert.rejects(readFile(join(siteRoot, ".publish-lock.json")), {
    code: "ENOENT",
  });
});

test("the overall verification deadline also bounds an unfinished response body", async (t) => {
  const { release } = await fixture(t);
  const staged = await release("new");
  const baseUrl = await verificationServer(t, (_request, response) => {
    response.writeHead(200);
    response.flushHeaders();
  });
  const started = performance.now();
  await assert.rejects(
    verifyLocal(staged.path, {
      baseUrl,
      timeoutMs: 100,
      requestTimeoutMs: 5000,
      onRetry: () => {},
    }),
    /等待 Docker 文件同步超时.*本机网站内容检查失败/,
  );
  assert.ok(
    performance.now() - started < 1500,
    "Must not wait the 5-second request timeout",
  );
});

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
