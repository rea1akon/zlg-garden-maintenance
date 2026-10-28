// 生成 public/version.json —— 登录页右下角版本号的数据源
// 规则：主版本.次版本.修订号，修订号 = git 提交数，每次发版自动 +1；无 git 时退回时间戳
// 用法：node scripts/gen-version.mjs  （npm run deploy 前会自动执行）
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const sh = (cmd) => {
  try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
};

const MAJOR = 1;
const MINOR = 0;

let rev = sh("git rev-list --count HEAD");
if (!rev) rev = String(Math.floor(Date.now() / 86400000)); // 无 git：用天数兜底，保证单调递增
const sha = sh("git rev-parse --short HEAD") || "dev";
const dirty = sh("git status --porcelain") ? "-dirty" : "";

const now = new Date();
const p = (n) => String(n).padStart(2, "0");
const build = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;

const version = `${MAJOR}.${MINOR}.${rev}`;
const out = { version, build, commit: sha + dirty };
const file = path.resolve("public/version.json");
fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`版本号 v${version}（构建 ${build} / ${sha}${dirty}）→ public/version.json`);
