# 庄骆贵园林养护成效管理系统

基于 Cloudflare Pages + D1 + R2 的云端园林养护成效管理平台。支持养护单位手机端/网页端上报、考核员远程审核、游客密码访问公示大屏、管理员后台全量配置。

## 功能一览

| 角色 | 权限 |
| --- | --- |
| 管理员 admin | 账号配置、区域/养护所/养护点管理、养护内容字典维护、每所预设内容、游客密码、导出归档、数据清理、存储统计 |
| 考核员 reviewer | 所级范围，审核养护单位上报（整条通过/驳回） |
| 养护单位 unit | 所级范围，每日填报养护内容+数量+作业前后照片 |
| 游客 visitor | 密码访问（默认 666666），看养护成效公示大屏 |

## 目录结构

```
├── public/index.html          # 前端单文件（输出目录）
├── functions/api/[[route]].js # 后端 API（Pages Functions）
├── schema.sql                 # 建表 + 种子数据
├── wrangler.toml              # Cloudflare 配置
├── .dev.vars                  # 本地密钥（已 gitignore）
└── .gitignore
```

## 本地开发

```bash
npm install
# 本地建库（首次）
npm run db:local
# 启动本地服务
npm run dev
```

浏览器打开 http://127.0.0.1:8788 ，默认管理员 `admin` / `Admin@123`（首次登录强制改密）。

## 部署上线（GitHub + Cloudflare）

### 第 1 步：准备 GitHub 仓库

1. 在 GitHub 新建一个私有仓库（如 `zlg-garden-maintenance`）
2. 本地执行：
   ```bash
   git init
   git add .
   git commit -m "init: 园林养护成效管理系统"
   git branch -M main
   git remote add origin https://github.com/你的用户名/zlg-garden-maintenance.git
   git push -u origin main
   ```

### 第 2 步：创建 Cloudflare API Token（替代 wrangler login）

打开 https://dash.cloudflare.com/profile/api-tokens → **Create Token** → **Create Custom Token**，配置以下权限：

| 类别 (Category) | 资源 (Resource) | 级别 (Level) |
| --- | --- | --- |
| Account | Cloudflare Pages | Edit |
| Account | D1 | Edit |
| Account | Workers R2 Storage | Edit |
| Account | Workers Scripts | Edit |
| Account | Account Settings | Read |
| User | User Details | Read |
| User | Memberships | Read |

创建后复制 Token，终端执行：

```bash
export CLOUDFLARE_API_TOKEN="粘贴你的Token"
npx wrangler whoami   # 验证 Token，会显示 Account ID 和邮箱
```

### 第 3 步：创建 D1 数据库和 R2 桶

```bash
# 创建 D1 数据库（记下返回的 database_id）
npx wrangler d1 create zlg-garden-db

# 创建 R2 存储桶
npx wrangler r2 bucket create zlg-garden-photos
```

> ⚠️ R2 首次启用会要求绑定付款方式（不会扣费，仅验证）。如已绑卡则可跳过。

把上一步返回的 `database_id` 填进 `wrangler.toml` 的 `[[d1_databases]]` 段，替换占位 UUID。

### 第 4 步：远程建表 + 部署

```bash
# 远程建表 + 写入种子数据
npx wrangler d1 execute zlg-garden-db --remote --file=./schema.sql

# 创建 Pages 项目
npx wrangler pages project create zlg-garden-maintenance --production-branch main

# 设置密钥
npx wrangler pages secret put AUTH_SECRET --project-name zlg-garden-maintenance

# 部署
npx wrangler pages deploy
```

### 第 5 步：控制台绑定 + 重新部署

> ⚠️ Git 集成时，`wrangler.toml` 里的 D1/R2 绑定**不会自动生效**，必须在控制台手动配置。

1. 打开 Cloudflare 控制台 → Workers & Pages → 你的项目 → **Settings → Functions → D1 database bindings**
2. 绑定名称填 `DB`，选择 `zlg-garden-db`
3. 同样在 **R2 bucket bindings** 里，绑定名称填 `BUCKET`，选择 `zlg-garden-photos`
4. 配置完后，回到项目 → **Deployments** → 重新部署一次（或直接 push 代码触发）

### 第 6 步：验证部署

浏览器打开部署域名，访问 `/api/ping`，应返回：

```json
{"ok":true,"photoStore":"r2","bound":{"db":true,"bucket":true,"secret":true}}
```

`db`、`bucket`、`secret` 必须全为 `true`。若 `bucket:false`，说明 R2 未绑定成功。

## 免费额度参考（Cloudflare Free）

| 资源 | 免费额度 |
| --- | --- |
| D1 数据库 | 500 MB / 5GB 总量 |
| R2 存储 | 10 GB / 月 |
| R2 出口流量 | 免费（无限） |
| Pages 请求 | 10 万次 / 天 |

> R2 免费 10GB/月，照片量大时建议定期使用「导出归档 + 数据清理」功能，把历史数据归档到本地后清理，腾出额度。

## 使用说明

1. **首次登录**：`admin` / `Admin@123`，登录后会强制改密
2. **配置基础数据**：管理员后台 → 区域/养护所 → 添加区域（庄市/骆驼/贵驷）和养护所
3. **配置养护内容**：养护内容字典已内置 36 项，可在后台增删改
4. **每所预设内容**：给每个养护所勾选它负责的养护内容
5. **创建账号**：为养护单位和考核员创建账号，绑定对应养护所
6. **游客访问**：登录页点「游客访问」，输入密码（默认 666666）进入公示大屏

## 关键技术说明

- **图片压缩在客户端**：上传前自动压缩到长边 1600px（标准档），节省 R2 存储和手机流量
- **照片权限**：照片通过带 token 的 Blob 请求加载，不做公开桶，防止考勤照片泄露
- **D1 LIKE 限制**：照片授权比对全部用等值比较（json_each），避免 D1 的 LIKE 长度限制
- **密码哈希**：PBKDF2-SHA256 10000 次迭代，适配免费版 10ms CPU 限额
