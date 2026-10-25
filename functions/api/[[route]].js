// ============================================================
// 庄骆贵园林养护成效管理系统 · 后端 API
// Cloudflare Pages Functions (catch-all)
// ============================================================

const THUMB_SUFFIX = ".t.jpg";
const TOKEN_TTL = 7 * 24 * 60 * 60; // 7 天

// ---------- 工具 ----------

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function fail(message, status = 400, code) {
  const body = { ok: false, error: String(message) };
  if (code) body.code = code;
  return json(body, status);
}

function now() {
  return new Date().toISOString();
}

// 东八区本地日期 YYYY-MM-DD（禁止 toISOString，避免凌晨 0-8 点早一天）
function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// base64url 编解码
function b64url(buf) {
  let s = "";
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// HMAC 签名（Web Crypto）
async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(sig);
}

// 标准 base64 编码（与 Node crypto 输出一致，用于 PBKDF2 哈希）
function stdB64(buf) {
  let s = "";
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

// PBKDF2 密码哈希（Web Crypto，输出标准 base64，与 Node crypto.pbkdf2Sync 一致）
async function hashPassword(password, saltB64, iterations = 10000) {
  const salt = unb64url(saltB64);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256
  );
  return stdB64(new Uint8Array(bits));
}

async function verifyPassword(password, stored) {
  // stored 格式: pbkdf2$10000$<salt-b64>$<hash-b64>（salt/hash 为标准 base64）
  const parts = String(stored).split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  const salt = parts[2];
  const expected = parts[3];
  const got = await hashPassword(password, salt, iterations);
  // 常量时间比较（标准 base64 可直接比）
  let diff = got.length ^ expected.length;
  for (let i = 0; i < got.length && i < expected.length; i++) {
    diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

async function makePassword(password, iterations = 10000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = stdB64(salt);
  const hash = await hashPassword(password, saltB64, iterations);
  return `pbkdf2$${iterations}$${saltB64}$${hash}`;
}

// ---------- 鉴权 ----------

async function makeToken(env, uid) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ uid, exp })));
  const sig = await hmacSign(env.AUTH_SECRET, payload);
  return `${payload}.${sig}`;
}

async function verifyToken(env, token) {
  try {
    const [payload, sig] = String(token).split(".");
    if (!payload || !sig) return null;
    const expected = await hmacSign(env.AUTH_SECRET, payload);
    if (expected !== sig) return null;
    const data = JSON.parse(new TextDecoder().decode(unb64url(payload)));
    if (!data.uid || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data.uid;
  } catch (e) {
    return null;
  }
}

// 每次请求回查用户表，取最新角色/范围
async function getUser(env, request) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const uid = await verifyToken(env, token);
  if (!uid) return null;
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?1 AND enabled = 1")
    .bind(uid).first();
  return user || null;
}

function isAdmin(user) { return user && user.role === "admin"; }
function isReviewer(user) { return user && user.role === "reviewer"; }

// 范围隔离：生成 WHERE 片段，强制过滤 office_id
// admin(all)：不过滤；普通角色(office)：只允许自己 scope_id
// prefix：表别名前缀（如 "r."），用于 JOIN 查询时消除歧义
function scopeOfficeFilter(user, prefix = "") {
  const col = prefix + "office_id";
  if (isAdmin(user)) return { where: "1=1", params: [] };
  if (user.scope_type === "office" && user.scope_id) {
    return { where: col + " = ?", params: [user.scope_id] };
  }
  // 默认收紧到自己范围
  return { where: col + " = ?", params: [user.scope_id || ""] };
}

function scopeOfficeId(user) {
  if (isAdmin(user)) return null;
  return user.scope_id || null;
}

// 判断某 office 是否在用户范围内
async function officeInScope(env, user, officeId) {
  if (isAdmin(user)) return true;
  return officeId === user.scope_id;
}

// ---------- 照片存储抽象（走 R2） ----------

const photoStore = (env) => (String(env.PHOTO_STORE || "r2").toLowerCase() === "r2" && env.BUCKET ? "r2" : "r2");

async function photoPut(env, key, buf, mime, meta = {}) {
  await env.BUCKET.put(key, buf, { httpMetadata: { contentType: mime }, customMetadata: meta });
}
async function photoGet(env, key) {
  const obj = await env.BUCKET.get(key);
  if (!obj) return null;
  return { body: await obj.arrayBuffer(), mime: obj.httpMetadata?.contentType || "application/octet-stream" };
}
async function photoRemove(env, key) {
  try { await env.BUCKET.delete(key); } catch (e) {}
}
async function photoUsage(env) {
  let total = 0, count = 0, cursor;
  do {
    const list = await env.BUCKET.list({ cursor });
    for (const o of list.objects) { total += o.size || 0; count++; }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return { bytes: total, count };
}

// 生成照片 key
function photoKey(prefix, ext = "jpg") {
  return `photos/${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
}

// ---------- 主路由 ----------

export async function onRequest(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
    const method = request.method.toUpperCase();

    // 未绑定 D1
    if (!env.DB) return fail("服务端未绑定 D1", 500);

    // 游客公开端点（无需登录）
    if (path === "visitor-verify" && method === "POST") return await visitorVerify(request, env);
    if (path.startsWith("public/")) return await publicRoute(path, request, env);

    // 登录
    if (path === "login" && method === "POST") return await login(request, env);

    // 其余需要鉴权
    const user = await getUser(env, request);
    if (!user) return fail("未登录或登录已过期", 401, "UNAUTHORIZED");

    // 通用
    if (path === "me") return json({ ok: true, user: sanitizeUser(user) });
    if (path === "change-password" && method === "POST") return await changePassword(request, env, user);
    if (path === "ping") return json({ ok: true, photoStore: photoStore(env), bound: { db: true, bucket: !!env.BUCKET, secret: !!env.AUTH_SECRET } });

    // 照片读取（登录用户，双向授权）
    if (path.startsWith("photos/")) return await servePhoto(path, env, user);

    // 管理员
    if (path.startsWith("admin/")) {
      if (!isAdmin(user)) return fail("无权限", 403);
      return await adminRoute(path, method, request, env, user);
    }

    // 考核员审核
    if (path.startsWith("review/")) {
      if (!isReviewer(user) && !isAdmin(user)) return fail("无权限", 403);
      return await reviewRoute(path, method, request, env, user);
    }

    // 养护单位 + 通用读写
    return await unitRoute(path, method, request, env, user);
  } catch (e) {
    return fail("服务器错误: " + e.message, 500);
  }
}

function sanitizeUser(u) {
  return {
    id: u.id, username: u.username, display_name: u.display_name,
    role: u.role, scope_type: u.scope_type, scope_id: u.scope_id,
    must_change_pwd: !!u.must_change_pwd,
  };
}

// ---------- 登录 ----------

async function login(request, env) {
  const { username, password } = await request.json().catch(() => ({}));
  if (!username || !password) return fail("请输入用户名和密码", 400);
  const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?1").bind(String(username)).first();
  if (!user || !user.enabled) return fail("用户名或密码错误", 401, "BAD_CREDENTIALS");
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return fail("用户名或密码错误", 401, "BAD_CREDENTIALS");
  const token = await makeToken(env, user.id);
  await env.DB.prepare("UPDATE users SET last_login_at = ?1 WHERE id = ?2").bind(now(), user.id).run();
  return json({ ok: true, token, user: sanitizeUser(user) });
}

async function changePassword(request, env, user) {
  const { old_password, new_password } = await request.json().catch(() => ({}));
  if (!old_password || !new_password) return fail("参数缺失", 400);
  const cur = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?1").bind(user.id).first();
  if (!(await verifyPassword(old_password, cur.password_hash))) return fail("旧密码错误", 400);
  if (String(new_password).length < 6) return fail("新密码至少 6 位", 400);
  const hash = await makePassword(new_password);
  await env.DB.prepare("UPDATE users SET password_hash = ?1, must_change_pwd = 0, updated_at = ?2 WHERE id = ?3")
    .bind(hash, now(), user.id).run();
  return json({ ok: true });
}

// ---------- 游客 ----------

async function visitorVerify(request, env) {
  const { password } = await request.json().catch(() => ({}));
  if (!password) return fail("请输入访问密码", 400);
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'visitor_password'").first();
  if (!row) return fail("系统未配置访问密码", 500);
  const ok = await verifyPassword(String(password), row.value);
  if (!ok) return fail("访问密码错误", 401, "BAD_CREDENTIALS");
  const token = await makeToken(env, "visitor");
  return json({ ok: true, token, role: "visitor" });
}

// ---------- 公开端点 ----------

async function publicRoute(path, request, env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  // 公开照片：仅允许 approved 记录的照片
  if (path.startsWith("public/photo/")) {
    const key = decodeURIComponent(path.replace("public/photo/", ""));
    return await servePublicPhoto(key, env);
  }
  if (path === "public/config" && method === "GET") {
    const regions = await env.DB.prepare("SELECT * FROM regions ORDER BY sort_order, name").all();
    const offices = await env.DB.prepare("SELECT * FROM offices ORDER BY sort_order, name").all();
    return json({ ok: true, regions: regions.results, offices: offices.results });
  }
  if (path === "public/dashboard" && method === "GET") {
    const offices = await env.DB.prepare("SELECT * FROM offices ORDER BY sort_order, name").all();
    const stats = await env.DB.prepare(
      "SELECT office_id, status, COUNT(*) c FROM daily_records WHERE work_date = ?1 GROUP BY office_id, status"
    ).bind(localDate()).all();
    const latest = await env.DB.prepare(
      "SELECT office_id, photos_after, created_at FROM daily_records WHERE status='approved' ORDER BY work_date DESC, created_at DESC"
    ).all();

    const statMap = {};
    for (const s of stats.results) {
      if (!statMap[s.office_id]) statMap[s.office_id] = { approved: 0, pending: 0, rejected: 0 };
      if (s.status === "approved") statMap[s.office_id].approved = s.c;
      else if (s.status === "pending") statMap[s.office_id].pending = s.c;
      else if (s.status === "rejected") statMap[s.office_id].rejected = s.c;
    }
    const latestMap = {};
    for (const l of latest.results) {
      if (!latestMap[l.office_id]) {
        try {
          const arr = JSON.parse(l.photos_after || "[]");
          if (arr.length) latestMap[l.office_id] = { key: arr[0].key, created_at: l.created_at };
        } catch (e) {}
      }
    }
    const list = offices.results.map(o => ({
      ...o,
      stats: statMap[o.id] || { approved: 0, pending: 0, rejected: 0 },
      latest: latestMap[o.id] || null,
    }));
    return json({ ok: true, offices: list });
  }
  if (path === "public/records" && method === "GET") {
    const officeId = url.searchParams.get("office");
    const date = url.searchParams.get("date") || localDate();
    let sql = "SELECT * FROM daily_records WHERE status='approved'";
    const params = [];
    if (officeId) { sql += " AND office_id = ?" + (params.length + 1); params.push(officeId); }
    if (date) { sql += " AND work_date = ?" + (params.length + 1); params.push(date); }
    sql += " ORDER BY created_at DESC LIMIT 200";
    const rows = await env.DB.prepare(sql).bind(...params).all();
    return json({ ok: true, records: rows.results });
  }
  return fail("Not found", 404);
}

async function servePublicPhoto(key, env) {
  // 校验该 key 是否属于某条 approved 记录（等值比对，不用 LIKE）
  const row = await env.DB.prepare(
    `SELECT 1 AS x FROM daily_records
      WHERE status='approved'
        AND (EXISTS (SELECT 1 FROM json_each(daily_records.photos_before) AS a WHERE json_extract(a.value,'$.key') = ?1)
          OR EXISTS (SELECT 1 FROM json_each(daily_records.photos_after)  AS b WHERE json_extract(b.value,'$.key') = ?1))
      LIMIT 1`
  ).bind(key).first();
  if (!row) return fail("照片不存在或无权访问", 404);

  // 缩略图：剥后缀比对的 key 也算
  let actualKey = key;
  if (key.endsWith(THUMB_SUFFIX)) actualKey = key.slice(0, -THUMB_SUFFIX.length);
  const obj = await photoGet(env, actualKey);
  if (!obj) return fail("照片不存在", 404);
  return new Response(obj.body, {
    headers: { "Content-Type": obj.mime, "Cache-Control": "public, max-age=3600" },
  });
}

// ---------- 照片读取（登录用户） ----------

async function servePhoto(path, env, user) {
  const key = decodeURIComponent(path.replace("photos/", ""));
  // 剥缩略图后缀
  let actualKey = key;
  if (key.endsWith(THUMB_SUFFIX)) actualKey = key.slice(0, -THUMB_SUFFIX.length);

  // 双向授权：本人上传 或 本范围记录引用
  const allowed = await photoAllowed(env, user, actualKey);
  if (!allowed) return fail("照片不存在或无权访问", 404);

  const obj = await photoGet(env, actualKey);
  if (!obj) return fail("照片不存在", 404);
  return new Response(obj.body, {
    headers: { "Content-Type": obj.mime, "Cache-Control": "private, max-age=3600" },
  });
}

async function photoAllowed(env, user, key) {
  // 管理员：全放行
  if (isAdmin(user)) return true;

  // 本人上传（R2 customMetadata.by）
  try {
    const head = await env.BUCKET.head(key);
    if (head && head.customMetadata && head.customMetadata.by === user.username) return true;
  } catch (e) {}

  // 本范围记录引用（等值比对）
  const filter = scopeOfficeFilter(user);
  const row = await env.DB.prepare(
    `SELECT 1 AS x FROM daily_records
      WHERE ${filter.where}
        AND (EXISTS (SELECT 1 FROM json_each(daily_records.photos_before) AS a WHERE json_extract(a.value,'$.key') = ?1)
          OR EXISTS (SELECT 1 FROM json_each(daily_records.photos_after)  AS b WHERE json_extract(b.value,'$.key') = ?1))
      LIMIT 1`
  ).bind(...filter.params, key).first();
  return !!row;
}

// ---------- 养护单位 + 通用读写 ----------

async function unitRoute(path, method, request, env, user) {
  const url = new URL(request.url);

  // 养护内容字典（读）
  if (path === "care-types" && method === "GET") {
    // 返回本所预设的内容（unit/reviewer）；admin 看全部
    let rows;
    if (isAdmin(user)) {
      rows = await env.DB.prepare("SELECT * FROM care_types WHERE enabled=1 ORDER BY sort_order, name").all();
    } else if (user.scope_id) {
      rows = await env.DB.prepare(
        `SELECT ct.* FROM care_types ct
         JOIN office_care_types oct ON oct.care_type_id = ct.id
         WHERE oct.office_id = ?1 AND ct.enabled = 1
         ORDER BY ct.sort_order, ct.name`
      ).bind(user.scope_id).all();
    } else {
      rows = await env.DB.prepare("SELECT * FROM care_types WHERE enabled=1 ORDER BY sort_order, name").all();
    }
    return json({ ok: true, careTypes: rows.results });
  }

  // 养护点（读，本范围）
  if (path === "points" && method === "GET") {
    const scopeId = scopeOfficeId(user);
    let rows;
    if (scopeId) {
      rows = await env.DB.prepare("SELECT * FROM points WHERE office_id = ?1 AND enabled=1 ORDER BY sort_order, name").bind(scopeId).all();
    } else {
      rows = await env.DB.prepare("SELECT * FROM points WHERE enabled=1 ORDER BY sort_order, name").all();
    }
    return json({ ok: true, points: rows.results });
  }

  // 养护所列表（读）
  if (path === "offices" && method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM offices ORDER BY sort_order, name").all();
    return json({ ok: true, offices: rows.results });
  }

  // 记录列表
  if (path === "records" && method === "GET") {
    const date = url.searchParams.get("date");
    const pointId = url.searchParams.get("point_id");
    const filter = scopeOfficeFilter(user, "r.");
    let sql = `SELECT r.*, o.name AS office_name, p.name AS point_name
               FROM daily_records r
               LEFT JOIN offices o ON o.id = r.office_id
               LEFT JOIN points p ON p.id = r.point_id
               WHERE ${filter.where}`;
    const params = [...filter.params];
    if (date) { sql += " AND r.work_date = ?" + (params.length + 1); params.push(date); }
    if (pointId) { sql += " AND r.point_id = ?" + (params.length + 1); params.push(pointId); }
    sql += " ORDER BY r.created_at DESC LIMIT 500";
    const rows = await env.DB.prepare(sql).bind(...params).all();
    return json({ ok: true, records: rows.results });
  }

  // 新建/更新记录（upsert 由前端决定；这里统一 insert）
  if (path === "records" && method === "POST") {
    return await saveRecord(request, env, user, null);
  }
  // 更新记录（驳回后重传）
  if (path.startsWith("records/") && method === "PUT") {
    const id = path.replace("records/", "");
    return await saveRecord(request, env, user, id);
  }
  // 删除记录
  if (path.startsWith("records/") && method === "DELETE") {
    const id = path.replace("records/", "");
    return await deleteRecord(env, user, id);
  }

  // 照片上传
  if (path === "photos/upload" && method === "POST") {
    return await uploadPhoto(request, env, user);
  }

  return fail("Not found", 404);
}

async function saveRecord(request, env, user, recordId) {
  const body = await request.json().catch(() => ({}));
  const {
    office_id, point_id, work_date, care_type_id, care_name, quantity, unit,
    description, photos_before, photos_after,
  } = body;

  // 养护单位只能报自己范围
  if (!isAdmin(user) && !(await officeInScope(env, user, office_id))) {
    return fail("无权向该养护所上报", 403);
  }
  if (!office_id) return fail("缺少养护所", 400);
  if (!work_date) return fail("缺少作业日期", 400);
  if (!care_type_id && !care_name) return fail("请选择或填写养护内容", 400);

  const pb = JSON.stringify(photos_before || []);
  const pa = JSON.stringify(photos_after || []);

  if (recordId) {
    // 更新：仅 pending/rejected 可改，重置为 pending
    const existing = await env.DB.prepare("SELECT * FROM daily_records WHERE id = ?1").bind(recordId).first();
    if (!existing) return fail("记录不存在", 404);
    if (!(await officeInScope(env, user, existing.office_id))) return fail("无权限", 403);
    if (existing.status === "approved") return fail("已审核通过的记录不可修改", 400);
    await env.DB.prepare(
      `UPDATE daily_records SET office_id=?1, point_id=?2, care_type_id=?3, care_name=?4, quantity=?5,
        unit=?6, description=?7, photos_before=?8, photos_after=?9, status='pending', reject_reason=NULL,
        updated_at=?10 WHERE id=?11`
    ).bind(office_id, point_id || null, care_type_id || null, care_name || null, quantity || null,
      unit || null, description || null, pb, pa, now(), recordId).run();
    return json({ ok: true, id: recordId });
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO daily_records (id, office_id, point_id, work_date, care_type_id, care_name, quantity,
      unit, description, photos_before, photos_after, status, created_by, created_at, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'pending',?12,?13,?13)`
  ).bind(id, office_id, point_id || null, work_date, care_type_id || null, care_name || null,
    quantity || null, unit || null, description || null, pb, pa, user.id, now()).run();
  return json({ ok: true, id });
}

async function deleteRecord(env, user, id) {
  const existing = await env.DB.prepare("SELECT * FROM daily_records WHERE id = ?1").bind(id).first();
  if (!existing) return fail("记录不存在", 404);
  if (!(await officeInScope(env, user, existing.office_id))) return fail("无权限", 403);
  if (existing.status === "approved") return fail("已审核通过的记录不可删除", 400);
  // 连带回收照片 + 缩略图
  const keys = collectPhotoKeys(existing);
  for (const k of keys) await photoRemove(env, k);
  await env.DB.prepare("DELETE FROM daily_records WHERE id = ?1").bind(id).run();
  return json({ ok: true });
}

function collectPhotoKeys(record) {
  const keys = [];
  for (const field of ["photos_before", "photos_after"]) {
    try {
      const arr = JSON.parse(record[field] || "[]");
      for (const p of arr) { if (p && p.key) { keys.push(p.key); keys.push(p.key + THUMB_SUFFIX); } }
    } catch (e) {}
  }
  return keys;
}

// 照片上传（multipart）
async function uploadPhoto(request, env, user) {
  const form = await request.formData().catch(() => null);
  if (!form) return fail("无效的上传", 400);
  const file = form.get("file");
  if (!file || typeof file === "string") return fail("缺少文件", 400);
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf.length === 0) return fail("空文件", 400);
  if (buf.length > 20 * 1024 * 1024) return fail("文件过大（超过 20MB）", 413, "PHOTO_TOO_LARGE");

  const cat = String(form.get("cat") || "after"); // before / after
  const mime = file.type || "image/jpeg";
  const ext = (mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg");
  const prefix = cat === "before" ? "before" : "after";
  const key = photoKey(prefix, ext);

  await photoPut(env, key, buf, mime, { by: user.username, cat });
  return json({ ok: true, key, size: buf.length, cat });
}

// ---------- 考核员审核 ----------

async function reviewRoute(path, method, request, env, user) {
  const url = new URL(request.url);

  // 待审核列表
  if (path === "review/records" && method === "GET") {
    const status = url.searchParams.get("status") || "pending";
    const date = url.searchParams.get("date");
    const filter = scopeOfficeFilter(user, "r.");
    let sql = `SELECT r.*, o.name AS office_name, p.name AS point_name, u.display_name AS creator_name
               FROM daily_records r
               LEFT JOIN offices o ON o.id = r.office_id
               LEFT JOIN points p ON p.id = r.point_id
               LEFT JOIN users u ON u.id = r.created_by
               WHERE ${filter.where} AND r.status = ?${filter.params.length + 1}`;
    const params = [...filter.params, status];
    if (date) { sql += " AND r.work_date = ?" + (params.length + 1); params.push(date); }
    sql += " ORDER BY r.created_at DESC LIMIT 500";
    const rows = await env.DB.prepare(sql).bind(...params).all();
    return json({ ok: true, records: rows.results });
  }

  // 通过
  if (path.startsWith("review/records/") && path.endsWith("/approve") && method === "POST") {
    const id = path.replace("review/records/", "").replace("/approve", "");
    return await review(env, user, id, "approved", null);
  }
  // 驳回
  if (path.startsWith("review/records/") && path.endsWith("/reject") && method === "POST") {
    const id = path.replace("review/records/", "").replace("/reject", "");
    const { reason } = await request.json().catch(() => ({}));
    if (!reason) return fail("请填写驳回原因", 400);
    return await review(env, user, id, "rejected", reason);
  }

  // 统计
  if (path === "review/stats" && method === "GET") {
    const filter = scopeOfficeFilter(user);
    const rows = await env.DB.prepare(
      `SELECT status, COUNT(*) c FROM daily_records WHERE ${filter.where} GROUP BY status`
    ).bind(...filter.params).all();
    const stat = { approved: 0, pending: 0, rejected: 0 };
    for (const r of rows.results) stat[r.status] = r.c;
    return json({ ok: true, stats: stat });
  }

  return fail("Not found", 404);
}

async function review(env, user, id, status, reason) {
  const record = await env.DB.prepare("SELECT * FROM daily_records WHERE id = ?1").bind(id).first();
  if (!record) return fail("记录不存在", 404);
  if (!(await officeInScope(env, user, record.office_id))) return fail("无权限", 403);
  if (record.status === "approved" && status === "approved") return fail("已审核通过", 400);
  await env.DB.prepare(
    `UPDATE daily_records SET status=?1, reject_reason=?2, reviewed_by=?3, reviewed_at=?4, updated_at=?4 WHERE id=?5`
  ).bind(status, reason, user.id, now(), id).run();
  return json({ ok: true });
}

// ---------- 管理员 ----------

async function adminRoute(path, method, request, env, user) {
  const url = new URL(request.url);

  // 用户管理
  if (path === "admin/users" && method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT u.*, o.name AS office_name FROM users u LEFT JOIN offices o ON o.id = u.scope_id ORDER BY u.created_at`
    ).all();
    return json({ ok: true, users: rows.results.map(sanitizeUser) });
  }
  if (path === "admin/users" && method === "POST") return await createUser(request, env);
  if (path.startsWith("admin/users/") && method === "PUT") return await updateUser(path, request, env);
  if (path.startsWith("admin/users/") && method === "DELETE") return await deleteUser(path, env);
  if (path.startsWith("admin/users/") && path.endsWith("/reset-password") && method === "POST") return await resetPassword(path, request, env);

  // 区域管理
  if (path === "admin/regions") {
    if (method === "GET") { const r = await env.DB.prepare("SELECT * FROM regions ORDER BY sort_order, name").all(); return json({ ok: true, regions: r.results }); }
    if (method === "POST") return await upsertRegion(request, env, null);
  }
  if (path.startsWith("admin/regions/") && method === "PUT") return await upsertRegion(request, env, path.replace("admin/regions/", ""));
  if (path.startsWith("admin/regions/") && method === "DELETE") { await env.DB.prepare("DELETE FROM regions WHERE id=?1").bind(path.replace("admin/regions/", "")).run(); return json({ ok: true }); }

  // 养护所管理
  if (path === "admin/offices") {
    if (method === "GET") { const r = await env.DB.prepare("SELECT * FROM offices ORDER BY sort_order, name").all(); return json({ ok: true, offices: r.results }); }
    if (method === "POST") return await upsertOffice(request, env, null);
  }
  if (path.startsWith("admin/offices/") && method === "PUT") return await upsertOffice(request, env, path.replace("admin/offices/", ""));
  if (path.startsWith("admin/offices/") && method === "DELETE") { await env.DB.prepare("DELETE FROM offices WHERE id=?1").bind(path.replace("admin/offices/", "")).run(); return json({ ok: true }); }

  // 养护点管理
  if (path === "admin/points") {
    if (method === "GET") { const r = await env.DB.prepare("SELECT * FROM points ORDER BY sort_order, name").all(); return json({ ok: true, points: r.results }); }
    if (method === "POST") return await upsertPoint(request, env, null);
  }
  if (path.startsWith("admin/points/") && method === "PUT") return await upsertPoint(request, env, path.replace("admin/points/", ""));
  if (path.startsWith("admin/points/") && method === "DELETE") { await env.DB.prepare("DELETE FROM points WHERE id=?1").bind(path.replace("admin/points/", "")).run(); return json({ ok: true }); }

  // 养护内容字典管理（唯一管理员）
  if (path === "admin/care-types") {
    if (method === "GET") { const r = await env.DB.prepare("SELECT * FROM care_types ORDER BY sort_order, name").all(); return json({ ok: true, careTypes: r.results }); }
    if (method === "POST") return await upsertCareType(request, env, null);
  }
  if (path.startsWith("admin/care-types/") && method === "PUT") return await upsertCareType(request, env, path.replace("admin/care-types/", ""));
  if (path.startsWith("admin/care-types/") && method === "DELETE") { await env.DB.prepare("DELETE FROM care_types WHERE id=?1").bind(path.replace("admin/care-types/", "")).run(); return json({ ok: true }); }

  // 每所预设内容
  if (path === "admin/office-care-types" && method === "GET") {
    const officeId = url.searchParams.get("office_id");
    if (officeId) {
      const r = await env.DB.prepare("SELECT care_type_id FROM office_care_types WHERE office_id=?1").bind(officeId).all();
      return json({ ok: true, careTypeIds: r.results.map(x => x.care_type_id) });
    }
    const r = await env.DB.prepare("SELECT * FROM office_care_types").all();
    return json({ ok: true, mapping: r.results });
  }
  if (path === "admin/office-care-types" && method === "PUT") {
    const { office_id, care_type_ids } = await request.json().catch(() => ({}));
    if (!office_id) return fail("缺少养护所", 400);
    await env.DB.prepare("DELETE FROM office_care_types WHERE office_id=?1").bind(office_id).run();
    for (const ctid of (care_type_ids || [])) {
      await env.DB.prepare("INSERT OR IGNORE INTO office_care_types (office_id, care_type_id) VALUES (?1,?2)").bind(office_id, ctid).run();
    }
    return json({ ok: true });
  }

  // 游客密码
  if (path === "admin/settings/visitor-password" && method === "POST") {
    const { password } = await request.json().catch(() => ({}));
    if (!password || String(password).length < 4) return fail("密码至少 4 位", 400);
    const hash = await makePassword(String(password));
    await env.DB.prepare("INSERT INTO settings (key,value) VALUES ('visitor_password',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(hash).run();
    return json({ ok: true });
  }

  // 统计 + 存储用量
  if (path === "admin/stats" && method === "GET") {
    const usage = await photoUsage(env);
    const total = await env.DB.prepare("SELECT COUNT(*) c FROM daily_records").first();
    const users = await env.DB.prepare("SELECT COUNT(*) c FROM users").first();
    return json({ ok: true, storage: usage, records: total.c, users: users.c });
  }

  // 导出 CSV
  if (path === "admin/export-csv" && method === "GET") {
    return await exportCsv(env, url);
  }
  // 导出照片 ZIP
  if (path === "admin/export-photos" && method === "GET") {
    return await exportPhotosZip(env, url);
  }

  // 清理
  if (path === "admin/cleanup-preview" && method === "GET") {
    return await cleanupPreview(env, url);
  }
  if (path === "admin/cleanup" && method === "POST") {
    return await cleanup(env, request);
  }

  // 孤儿清理
  if (path === "admin/purge-orphans" && method === "POST") {
    return await purgeOrphans(env);
  }

  return fail("Not found", 404);
}

async function createUser(request, env) {
  const { username, password, display_name, role, scope_type, scope_id } = await request.json().catch(() => ({}));
  if (!username || !password || !display_name || !role) return fail("参数缺失", 400);
  if (String(password).length < 6) return fail("密码至少 6 位", 400);
  if (!["admin", "reviewer", "unit"].includes(role)) return fail("角色非法", 400);
  const hash = await makePassword(String(password));
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, username, password_hash, display_name, role, scope_type, scope_id, must_change_pwd, enabled, created_at, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,1,1,?8,?8)`
  ).bind(id, username, hash, display_name, role, scope_type || "all", scope_id || null, now()).run();
  return json({ ok: true, id });
}

async function updateUser(path, request, env) {
  const id = path.replace("admin/users/", "");
  const body = await request.json().catch(() => ({}));
  const existing = await env.DB.prepare("SELECT * FROM users WHERE id=?1").bind(id).first();
  if (!existing) return fail("用户不存在", 404);

  const display_name = body.display_name ?? existing.display_name;
  const role = body.role ?? existing.role;
  const scope_type = body.scope_type ?? existing.scope_type;
  const scope_id = body.scope_id !== undefined ? body.scope_id : existing.scope_id;
  const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled;

  // 不能把唯一启用管理员改成非管理员或禁用
  if (existing.role === "admin" && (role !== "admin" || enabled === 0)) {
    const adminCount = await env.DB.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND enabled=1").first();
    if (adminCount.c <= 1) return fail("不能禁用或降级唯一的管理员", 400);
  }

  await env.DB.prepare(
    "UPDATE users SET display_name=?1, role=?2, scope_type=?3, scope_id=?4, enabled=?5, updated_at=?6 WHERE id=?7"
  ).bind(display_name, role, scope_type, scope_id || null, enabled, now(), id).run();
  return json({ ok: true });
}

async function deleteUser(path, env) {
  const id = path.replace("admin/users/", "");
  const existing = await env.DB.prepare("SELECT * FROM users WHERE id=?1").bind(id).first();
  if (!existing) return fail("用户不存在", 404);
  if (existing.role === "admin") {
    const adminCount = await env.DB.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND enabled=1").first();
    if (adminCount.c <= 1) return fail("不能删除唯一的管理员", 400);
  }
  await env.DB.prepare("DELETE FROM users WHERE id=?1").bind(id).run();
  return json({ ok: true });
}

async function resetPassword(path, request, env) {
  const id = path.replace("admin/users/", "").replace("/reset-password", "");
  const { password } = await request.json().catch(() => ({}));
  if (!password || String(password).length < 6) return fail("密码至少 6 位", 400);
  const hash = await makePassword(String(password));
  await env.DB.prepare("UPDATE users SET password_hash=?1, must_change_pwd=1, updated_at=?2 WHERE id=?3")
    .bind(hash, now(), id).run();
  return json({ ok: true });
}

async function upsertRegion(request, env, id) {
  const { name, code, sort_order } = await request.json().catch(() => ({}));
  if (!name) return fail("缺少名称", 400);
  if (id) {
    await env.DB.prepare("UPDATE regions SET name=?1, code=?2, sort_order=?3 WHERE id=?4")
      .bind(name, code || null, sort_order || 0, id).run();
    return json({ ok: true, id });
  }
  const nid = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO regions (id, name, code, sort_order, created_at) VALUES (?1,?2,?3,?4,?5)")
    .bind(nid, name, code || null, sort_order || 0, now()).run();
  return json({ ok: true, id: nid });
}

async function upsertOffice(request, env, id) {
  const { region_id, name, code, sort_order } = await request.json().catch(() => ({}));
  if (!region_id || !name) return fail("缺少区域或名称", 400);
  if (id) {
    await env.DB.prepare("UPDATE offices SET region_id=?1, name=?2, code=?3, sort_order=?4 WHERE id=?5")
      .bind(region_id, name, code || null, sort_order || 0, id).run();
    return json({ ok: true, id });
  }
  const nid = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO offices (id, region_id, name, code, sort_order, created_at) VALUES (?1,?2,?3,?4,?5,?6)")
    .bind(nid, region_id, name, code || null, sort_order || 0, now()).run();
  return json({ ok: true, id: nid });
}

async function upsertPoint(request, env, id) {
  const { office_id, name, category, location, sort_order } = await request.json().catch(() => ({}));
  if (!office_id || !name) return fail("缺少养护所或名称", 400);
  if (id) {
    await env.DB.prepare("UPDATE points SET office_id=?1, name=?2, category=?3, location=?4, sort_order=?5 WHERE id=?6")
      .bind(office_id, name, category || null, location || null, sort_order || 0, id).run();
    return json({ ok: true, id });
  }
  const nid = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO points (id, office_id, name, category, location, sort_order, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)")
    .bind(nid, office_id, name, category || null, location || null, sort_order || 0, now()).run();
  return json({ ok: true, id: nid });
}

async function upsertCareType(request, env, id) {
  const { name, unit, sort_order } = await request.json().catch(() => ({}));
  if (!name) return fail("缺少名称", 400);
  if (id) {
    await env.DB.prepare("UPDATE care_types SET name=?1, unit=?2, sort_order=?3 WHERE id=?4")
      .bind(name, unit || "", sort_order || 0, id).run();
    return json({ ok: true, id });
  }
  const nid = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO care_types (id, name, unit, sort_order, created_at) VALUES (?1,?2,?3,?4,?5)")
    .bind(nid, name, unit || "", sort_order || 0, now()).run();
  return json({ ok: true, id: nid });
}

// ---------- 导出 CSV ----------

async function exportCsv(env, url) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const officeId = url.searchParams.get("office");

  let sql = `SELECT r.work_date, reg.name AS region_name, o.name AS office_name, p.name AS point_name,
             r.care_name, r.quantity, r.unit, r.description, r.status, r.reject_reason,
             u.display_name AS creator, r.created_at, rv.display_name AS reviewer, r.reviewed_at
             FROM daily_records r
             LEFT JOIN offices o ON o.id = r.office_id
             LEFT JOIN regions reg ON reg.id = o.region_id
             LEFT JOIN points p ON p.id = r.point_id
             LEFT JOIN users u ON u.id = r.created_by
             LEFT JOIN users rv ON rv.id = r.reviewed_by
             WHERE 1=1`;
  const params = [];
  if (from) { sql += " AND r.work_date >= ?" + (params.length + 1); params.push(from); }
  if (to) { sql += " AND r.work_date <= ?" + (params.length + 1); params.push(to); }
  if (officeId) { sql += " AND r.office_id = ?" + (params.length + 1); params.push(officeId); }
  sql += " ORDER BY r.work_date, o.name, r.created_at";

  const rows = await env.DB.prepare(sql).bind(...params).all();
  const header = ["作业日期", "区域", "养护所", "养护点", "养护内容", "数量", "单位", "备注", "状态", "驳回原因", "上报人", "上传时间", "审核人", "审核时间"];
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [header.map(esc).join(",")];
  for (const r of rows.results) {
    lines.push([
      r.work_date, r.region_name, r.office_name, r.point_name, r.care_name,
      r.quantity, r.unit, r.description, r.status, r.reject_reason,
      r.creator, r.created_at, r.reviewer, r.reviewed_at,
    ].map(esc).join(","));
  }
  const csv = "\uFEFF" + lines.join("\r\n"); // BOM 让 Excel 正确识别 UTF-8
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="养护日志_${from || "all"}_${to || "all"}.csv"`,
    },
  });
}

// ---------- 导出照片 ZIP ----------

async function exportPhotosZip(env, url) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const officeId = url.searchParams.get("office");

  let sql = `SELECT r.*, o.name AS office_name, reg.name AS region_name
             FROM daily_records r
             LEFT JOIN offices o ON o.id = r.office_id
             LEFT JOIN regions reg ON reg.id = o.region_id
             WHERE 1=1`;
  const params = [];
  if (from) { sql += " AND r.work_date >= ?" + (params.length + 1); params.push(from); }
  if (to) { sql += " AND r.work_date <= ?" + (params.length + 1); params.push(to); }
  if (officeId) { sql += " AND r.office_id = ?" + (params.length + 1); params.push(officeId); }
  sql += " ORDER BY r.work_date, o.name, r.created_at";

  const rows = await env.DB.prepare(sql).bind(...params).all();

  // 用简单 zip 格式（store，无压缩，避免 CPU 超限）
  const files = []; // {name, data: Uint8Array}
  let seen = new Set();
  for (const r of rows.results) {
    const region = (r.region_name || "未分区").replace(/[\\/:*?"<>|]/g, "_");
    const office = (r.office_name || "未分所").replace(/[\\/:*?"<>|]/g, "_");
    const date = r.work_date;
    const folder = `${region}/${office}/${date}`;
    for (const field of ["photos_before", "photos_after"]) {
      let arr = [];
      try { arr = JSON.parse(r[field] || "[]"); } catch (e) {}
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        if (!p || !p.key || seen.has(p.key)) continue;
        seen.add(p.key);
        const obj = await photoGet(env, p.key);
        if (!obj) continue;
        const careName = (r.care_name || "未命名").replace(/[\\/:*?"<>|]/g, "_");
        const tag = field === "photos_before" ? "前" : "后";
        const name = `${folder}/${careName}_${tag}_${i + 1}.jpg`;
        files.push({ name, data: new Uint8Array(obj.body) });
      }
    }
  }

  const zip = buildZip(files);
  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="养护照片_${from || "all"}_${to || "all"}.zip"`,
    },
  });
}

// 极简 ZIP 打包（store 模式）
function buildZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const crc = crc32(f.data);
    const localHeader = new Uint8Array(30);
    const dv = new DataView(localHeader.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x0800, true); // UTF-8 flag
    dv.setUint16(8, 0, true);      // store
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, f.data.length, true);
    dv.setUint32(22, f.data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    localParts.push(localHeader, nameBytes, f.data);

    const central = new Uint8Array(46);
    const cdv = new DataView(central.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0x0800, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, f.data.length, true);
    cdv.setUint32(24, f.data.length, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint32(42, offset, true);
    centralParts.push(central, nameBytes);

    offset += 30 + nameBytes.length + f.data.length;
  }

  const centralDir = new Uint8Array(concatBytes(centralParts));
  const end = new Uint8Array(22);
  const edv = new DataView(end.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, files.length, true);
  edv.setUint16(10, files.length, true);
  edv.setUint32(12, centralDir.length, true);
  edv.setUint32(16, offset, true);

  chunks.push(...localParts, centralDir, end);
  return new Uint8Array(concatBytes(chunks));
}

function concatBytes(arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const a of arrays) { out.set(a, p); p += a.length; }
  return out;
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ---------- 清理 ----------

async function cleanupPreview(env, url) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const officeId = url.searchParams.get("office");
  const { sql, params } = buildCleanupQuery(from, to, officeId);
  const rows = await env.DB.prepare(sql).bind(...params).all();
  let photoCount = 0;
  for (const r of rows.results) photoCount += collectPhotoKeys(r).length;
  return json({ ok: true, recordCount: rows.results.length, photoCount });
}

async function cleanup(env, request) {
  const { from, to, office_id } = await request.json().catch(() => ({}));
  const { sql, params } = buildCleanupQuery(from, to, office_id);
  const rows = await env.DB.prepare(sql).bind(...params).all();
  let bytes = 0;
  const keys = new Set();
  for (const r of rows.results) {
    for (const k of collectPhotoKeys(r)) {
      keys.add(k);
      try { const head = await env.BUCKET.head(k); if (head) bytes += head.size || 0; } catch (e) {}
    }
  }
  for (const k of keys) await photoRemove(env, k);
  // 删除记录（不碰 approved 未归档？这里按选定范围全删，管理员已确认）
  const { sql: delSql, params: delParams } = buildCleanupDeleteQuery(from, to, office_id);
  const delRes = await env.DB.prepare(delSql).bind(...delParams).run();
  return json({ ok: true, deleted: rows.results.length, releasedBytes: bytes });
}

function buildCleanupQuery(from, to, officeId) {
  let sql = "SELECT * FROM daily_records WHERE 1=1";
  const params = [];
  if (from) { sql += " AND work_date >= ?" + (params.length + 1); params.push(from); }
  if (to) { sql += " AND work_date <= ?" + (params.length + 1); params.push(to); }
  if (officeId) { sql += " AND office_id = ?" + (params.length + 1); params.push(officeId); }
  return { sql, params };
}
function buildCleanupDeleteQuery(from, to, officeId) {
  let sql = "DELETE FROM daily_records WHERE 1=1";
  const params = [];
  if (from) { sql += " AND work_date >= ?" + (params.length + 1); params.push(from); }
  if (to) { sql += " AND work_date <= ?" + (params.length + 1); params.push(to); }
  if (officeId) { sql += " AND office_id = ?" + (params.length + 1); params.push(officeId); }
  return { sql, params };
}

// ---------- 孤儿照片清理 ----------

async function purgeOrphans(env) {
  // 收集所有被引用 key（含缩略图）
  const used = new Set();
  const rows = await env.DB.prepare("SELECT photos_before, photos_after FROM daily_records").all();
  for (const r of rows.results) {
    for (const k of collectPhotoKeys(r)) { used.add(k); used.add(k + THUMB_SUFFIX); }
  }
  let removed = 0, failed = 0;
  let cursor;
  do {
    const list = await env.BUCKET.list({ cursor });
    for (const o of list.objects) {
      if (!used.has(o.key)) {
        try { await env.BUCKET.delete(o.key); removed++; } catch (e) { failed++; }
      }
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return json({ ok: true, removed, failed });
}
