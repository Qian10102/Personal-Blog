import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = join(projectRoot, "deploy/mac-mini/compose.yaml");
const defaultSiteRoot = join(projectRoot, "deploy/mac-mini/site");

async function linkTarget(path) {
  try {
    return await readlink(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function replaceLink(siteRoot, name, target) {
  const temporary = join(siteRoot, `.${name}-${randomUUID()}`);
  try {
    await symlink(target, temporary);
    await rename(temporary, join(siteRoot, name));
  } finally {
    await rm(temporary, { force: true });
  }
}

async function filesIn(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = join(prefix, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`构建成品不能包含符号链接：${name}`);
    if (entry.isDirectory()) files.push(...(await filesIn(path, name)));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`构建成品包含不支持的文件：${name}`);
  }
  return files;
}

export async function withPublishLock(siteRoot, operation) {
  await mkdir(siteRoot, { recursive: true });
  const path = join(siteRoot, ".publish-lock.json");
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(
      "已有另一个本地发布任务，或上次任务异常退出；恢复方法见部署说明。",
    );
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid }));
    return await operation();
  } finally {
    await handle.close();
    await rm(path, { force: true });
  }
}

export async function stageRelease({
  sourceDir,
  siteRoot,
  name = new Date().toISOString().replace(/[:.]/g, "-") +
    "-" +
    randomUUID().slice(0, 8),
}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))
    throw new Error("发布版本名称无效。");
  if (
    resolve(siteRoot).startsWith(resolve(sourceDir) + sep) ||
    resolve(siteRoot) === resolve(sourceDir)
  ) {
    throw new Error("成品目录不能包含发布存储目录。");
  }
  const files = await filesIn(sourceDir);
  if (!(await readFile(join(sourceDir, "index.html"))).length)
    throw new Error("构建成品缺少有效首页。");
  const releasePath = join(siteRoot, "releases", name);
  await mkdir(dirname(releasePath), { recursive: true });
  await mkdir(releasePath); // Never overwrite an existing release.
  try {
    await cp(sourceDir, releasePath, { recursive: true });
    async function makePublic(directory) {
      await chmod(directory, 0o755);
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await makePublic(path);
        else await chmod(path, 0o644);
      }
    }
    await makePublic(releasePath);
    // Astro asset names contain content hashes. Keep prior assets for open tabs.
    for (const name of files.filter((name) =>
      name.startsWith("_astro" + sep),
    )) {
      const source = join(releasePath, name);
      const target = join(siteRoot, name);
      await mkdir(dirname(target), { recursive: true, mode: 0o755 });
      try {
        const existing = await readFile(target);
        if (!existing.equals(await readFile(source)))
          throw new Error(`同名静态资源内容冲突：${name}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const temporary = target + ".staging-" + randomUUID();
        try {
          await copyFile(source, temporary, constants.COPYFILE_EXCL);
          await rename(temporary, target);
        } finally {
          await rm(temporary, { force: true });
        }
      }
    }
    return { name, path: releasePath, files: files.length };
  } catch (error) {
    await rm(releasePath, { recursive: true, force: true });
    throw error;
  }
}

export async function activateRelease({
  siteRoot,
  name,
  verify = async () => {},
}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))
    throw new Error("发布版本名称无效。");
  const target = join("releases", name);
  const releasePath = join(siteRoot, target);
  await access(join(releasePath, "index.html"));
  const old = await linkTarget(join(siteRoot, "current"));
  const previous = await linkTarget(join(siteRoot, "previous"));
  try {
    if (old && old !== target) await replaceLink(siteRoot, "previous", old);
    await replaceLink(siteRoot, "current", target);
    await verify(releasePath);
  } catch (error) {
    if (old) await replaceLink(siteRoot, "current", old);
    else await rm(join(siteRoot, "current"), { force: true });
    if (previous) await replaceLink(siteRoot, "previous", previous);
    else await rm(join(siteRoot, "previous"), { force: true });
    throw error;
  }
}

export async function rollbackRelease({ siteRoot, verify }) {
  const previous = await linkTarget(join(siteRoot, "previous"));
  if (!previous || dirname(previous) !== "releases")
    throw new Error("没有可回退的上一版本。");
  await activateRelease({
    siteRoot,
    name: relative("releases", previous),
    verify,
  });
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} 未通过，正式内容没有发布。`);
}

async function verifyLocal(releasePath) {
  const files = await filesIn(releasePath);
  const checks = [
    "index.html",
    "vocabulary/index.html",
    "review-planner/index.html",
    files.find((name) => name.startsWith("_astro" + sep)),
  ].filter((name) => name && files.includes(name));
  for (const name of checks) {
    const path =
      "/" +
      name
        .split(sep)
        .map(encodeURIComponent)
        .join("/")
        .replace(/index\.html$/, "");
    const response = await fetch("http://127.0.0.1:8081" + path, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const expected = createHash("sha256")
      .update(await readFile(join(releasePath, name)))
      .digest("hex");
    const actual = createHash("sha256")
      .update(Buffer.from(await response.arrayBuffer()))
      .digest("hex");
    if (!response.ok || actual !== expected)
      throw new Error(`本机网站内容检查失败：${path}`);
  }
}

async function main() {
  const rollback = process.argv.includes("--rollback");
  const checkOnly = process.argv.includes("--check");
  if (
    (rollback && checkOnly) ||
    process.argv
      .slice(2)
      .some((arg) => !["--rollback", "--check"].includes(arg))
  ) {
    throw new Error("只支持单独使用 --rollback 或 --check 参数。");
  }
  await access(
    join(defaultSiteRoot, rollback ? "previous" : "current", "index.html"),
  );
  await withPublishLock(defaultSiteRoot, async () => {
    run("docker", ["info", "--format", "{{.ServerVersion}}"]);
    let release;
    if (!rollback) {
      try {
        process.loadEnvFile(join(projectRoot, ".env"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (
        !process.env.PUBLIC_SUPABASE_URL ||
        !process.env.PUBLIC_SUPABASE_ANON_KEY
      ) {
        throw new Error(
          "请先在项目 .env 中配置已有的公开 Supabase 地址和公开 key。",
        );
      }
      const env = {
        ...process.env,
        SITE_URL: process.env.SITE_URL || "https://zihan-server.com",
      };
      const scratchRoot = join(projectRoot, "work/local-publish");
      await mkdir(scratchRoot, { recursive: true });
      const buildDir = await mkdtemp(join(scratchRoot, "build-"));
      try {
        run("npm", ["test"], env);
        run("npm", ["run", "build", "--", "--outDir", buildDir], env);
        if (!(await readFile(join(buildDir, "index.html"))).length)
          throw new Error("构建成品缺少有效首页。");
        if (checkOnly) {
          console.log(
            `本地检查通过（${(await filesIn(buildDir)).length} 个文件），正式网站未切换。`,
          );
          return;
        }
        release = await stageRelease({
          sourceDir: buildDir,
          siteRoot: defaultSiteRoot,
        });
      } finally {
        await rm(buildDir, { recursive: true, force: true });
      }
    }
    run("docker", ["compose", "-f", composeFile, "up", "-d", "web"]);
    run("docker", [
      "compose",
      "-f",
      composeFile,
      "exec",
      "-T",
      "web",
      "nginx",
      "-t",
    ]);
    run("docker", [
      "compose",
      "-f",
      composeFile,
      "exec",
      "-T",
      "web",
      "nginx",
      "-s",
      "reload",
    ]);
    const verify = async (path) => {
      await verifyLocal(path);
      run("docker", [
        "compose",
        "-f",
        composeFile,
        "up",
        "-d",
        "--wait",
        "--wait-timeout",
        "45",
      ]);
    };
    if (rollback) await rollbackRelease({ siteRoot: defaultSiteRoot, verify });
    else
      await activateRelease({
        siteRoot: defaultSiteRoot,
        name: release.name,
        verify,
      });
    console.log(
      rollback
        ? "已恢复上一版本：https://zihan-server.com"
        : `本机发布成功（${release.files} 个文件）：https://zihan-server.com`,
    );
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
