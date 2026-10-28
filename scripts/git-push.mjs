// GitHub 推送助手
// 背景：本机 C:\Windows\System32\drivers\etc\hosts 里 github.com 被写成 127.0.0.1，
//       导致 git/curl 连不上（TLS 握手直接失败）。此脚本在本机起一个临时 CONNECT 代理，
//       把 443 转发到 github.com 的真实 IP，让 git 走代理完成推送，不改系统文件。
// 用法：npm run push            推 main
//       npm run push -- <branch> 推指定分支
import net from "node:net";
import { spawn, execSync } from "node:child_process";

const branch = process.argv[2] || "main";

function resolveIp() {
  const tries = [
    () => execSync("nslookup github.com 192.168.110.1", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
    () => execSync("nslookup github.com 223.5.5.5", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
    () => execSync("nslookup github.com 8.8.8.8", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
  ];
  for (const t of tries) {
    try {
      const out = t();
      const ips = [...out.matchAll(/Address:\s+(\d+\.\d+\.\d+\.\d+)/g)]
        .map(m => m[1])
        .filter(x => !/^192\.168\.110\.1$|^127\.|^223\.5\.5\.5$|^8\.8\.8\.8$|^0\.0\.0\.0$/.test(x));
      if (ips.length) return ips[ips.length - 1];
    } catch { /* 换下一个 DNS */ }
  }
  return "20.205.243.166"; // 兜底：GitHub 常用地址，失效时换 DNS 重新解析
}

const ip = resolveIp();
const server = net.createServer((sock) => {
  sock.once("data", (buf) => {
    const m = buf.toString().match(/CONNECT\s+([^:]+):(\d+)/);
    if (!m) { sock.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
    const up = net.connect(Number(m[2]), ip, () => {
      sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      up.pipe(sock); sock.pipe(up);
    });
    up.on("error", () => sock.destroy());
  });
  sock.on("error", () => {});
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  console.log(`[push] github.com → ${ip}（本地代理 127.0.0.1:${port}）`);
  const child = spawn("git", ["-c", `http.proxy=http://127.0.0.1:${port}`, "push", "origin", branch], {
    stdio: "inherit",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  child.on("exit", (code) => {
    server.close();
    process.exit(code ?? 0);
  });
});
