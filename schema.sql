-- ============================================================
-- 庄骆贵园林养护成效管理系统 · 数据库结构
-- Cloudflare D1 (SQLite)
-- ============================================================

-- 用户与角色
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,                -- pbkdf2$10000$<salt-b64>$<hash-b64>
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'unit', -- 'admin' | 'reviewer' | 'unit'
  scope_type    TEXT NOT NULL DEFAULT 'all',  -- 'all' | 'office'
  scope_id      TEXT,                         -- office_id；'all' 时为 NULL
  must_change_pwd INTEGER NOT NULL DEFAULT 0, -- 首次登录强制改密
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_scope ON users(scope_type, scope_id);

-- 区域（庄市 / 骆驼 / 贵驷）
CREATE TABLE IF NOT EXISTS regions (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  code       TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 养护所（庄一小所 / 庄二小所…，隶属区域）
CREATE TABLE IF NOT EXISTS offices (
  id         TEXT PRIMARY KEY,
  region_id  TEXT NOT NULL REFERENCES regions(id),
  name       TEXT NOT NULL,
  code       TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offices_region ON offices(region_id);

-- 养护点（绿地点位，隶属养护所，可选）
CREATE TABLE IF NOT EXISTS points (
  id         TEXT PRIMARY KEY,
  office_id  TEXT NOT NULL REFERENCES offices(id),
  name       TEXT NOT NULL,
  category   TEXT,                            -- 绿化带/行道树/草坪/花坛/水体/设施…
  location   TEXT,
  lat REAL, lng REAL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_points_office ON points(office_id);

-- 养护内容字典（仅管理员可增删改）
CREATE TABLE IF NOT EXISTS care_types (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,                   -- 乔木修剪 / 草坪修剪…
  unit       TEXT NOT NULL DEFAULT '',        -- 株 / m² / 吨 / 点位 / 盆 / 个
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- 每所预设的养护内容（多对多）
CREATE TABLE IF NOT EXISTS office_care_types (
  office_id    TEXT NOT NULL REFERENCES offices(id),
  care_type_id TEXT NOT NULL REFERENCES care_types(id),
  PRIMARY KEY (office_id, care_type_id)
);

-- 每日养护记录（核心闭环表）
CREATE TABLE IF NOT EXISTS daily_records (
  id            TEXT PRIMARY KEY,
  office_id     TEXT NOT NULL REFERENCES offices(id),
  point_id      TEXT REFERENCES points(id),   -- 可选
  work_date     TEXT NOT NULL,                -- 'YYYY-MM-DD' 东八区本地日期
  care_type_id  TEXT REFERENCES care_types(id),
  care_name     TEXT,                         -- 快照：养护内容名（其他内容时存自定义文字）
  quantity      REAL,                         -- 数量
  unit          TEXT,                         -- 单位快照
  description   TEXT,                         -- 备注 / 其他内容
  photos_before TEXT NOT NULL DEFAULT '[]',   -- JSON [{key,size,width,height,origSize}]
  photos_after  TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'approved'|'rejected'
  reject_reason TEXT,
  created_by    TEXT NOT NULL REFERENCES users(id),
  reviewed_by   TEXT REFERENCES users(id),
  reviewed_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_status ON daily_records(status);
CREATE INDEX IF NOT EXISTS idx_records_date   ON daily_records(work_date);
CREATE INDEX IF NOT EXISTS idx_records_office ON daily_records(office_id);

-- 系统设置（游客密码等键值）
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 养护计划（可选，暂未启用前端，保留表结构）
CREATE TABLE IF NOT EXISTS plans (
  id         TEXT PRIMARY KEY,
  office_id  TEXT NOT NULL REFERENCES offices(id),
  plan_month TEXT NOT NULL,
  title      TEXT,
  content    TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_office ON plans(office_id);

-- ============================================================
-- 种子数据
-- ============================================================

-- 默认管理员：admin / Admin@123（首次登录强制改密）
INSERT INTO users (id, username, password_hash, display_name, role, scope_type, scope_id, must_change_pwd, enabled, created_at, updated_at)
VALUES ('u-admin', 'admin', 'pbkdf2$10000$Z60ohSn3TrpIJyOc5yGI4A==$2UcJwaNSS2JEQA17AlHSrbwiv6mSLDYOpp8+fAYs7jg=', '系统管理员', 'admin', 'all', NULL, 1, 1, datetime('now'), datetime('now'));

-- 游客访问密码：默认 666666
INSERT INTO settings (key, value) VALUES ('visitor_password', 'pbkdf2$10000$v4giJf3Ibq2refEOGAulsA==$Hd5XD2u8W/CVgvlQPc16RIYnNV45BwnAVXw+TmX2oOk=');

-- 区域种子
INSERT INTO regions (id, name, code, sort_order, created_at) VALUES
('r-zhuangshi', '庄市', 'ZS', 1, datetime('now')),
('r-luotuo',    '骆驼', 'LT', 2, datetime('now')),
('r-guisi',     '贵驷', 'GS', 3, datetime('now'));

-- 养护内容字典（36 项，含单位）
INSERT INTO care_types (id, name, unit, sort_order, enabled, created_at) VALUES
('ct-01','乔木修剪','株',1,1,datetime('now')),
('ct-02','藤本修剪','株',2,1,datetime('now')),
('ct-03','树桩修剪','株',3,1,datetime('now')),
('ct-04','水生修剪','m²',4,1,datetime('now')),
('ct-05','乔木补种','株',5,1,datetime('now')),
('ct-06','地被草花补种','m²',6,1,datetime('now')),
('ct-07','灌木补种','株',7,1,datetime('now')),
('ct-08','花籽播种','m²',8,1,datetime('now')),
('ct-09','苗木更换','株',9,1,datetime('now')),
('ct-10','绿化追肥','吨',10,1,datetime('now')),
('ct-11','绿化打药','吨',11,1,datetime('now')),
('ct-12','支撑加固','株',12,1,datetime('now')),
('ct-13','苗木抹芽','株',13,1,datetime('now')),
('ct-14','绿地翻耕','m²',14,1,datetime('now')),
('ct-15','园林固废','吨',15,1,datetime('now')),
('ct-16','漏水抢修','点位',16,1,datetime('now')),
('ct-17','防冻排水','点位',17,1,datetime('now')),
('ct-18','空调换盆','盆',18,1,datetime('now')),
('ct-19','草坪修剪','m²',19,1,datetime('now')),
('ct-20','球类修剪','株',20,1,datetime('now')),
('ct-21','花境修剪','m²',21,1,datetime('now')),
('ct-22','绿篱修剪','m²',22,1,datetime('now')),
('ct-23','绿篱补种','m²',23,1,datetime('now')),
('ct-24','草坪补种','m²',24,1,datetime('now')),
('ct-25','草坪套播','m²',25,1,datetime('now')),
('ct-26','草花更换','m²',26,1,datetime('now')),
('ct-27','绿化施肥','吨',27,1,datetime('now')),
('ct-28','冬季基肥','吨',28,1,datetime('now')),
('ct-29','乔木涂白','株',29,1,datetime('now')),
('ct-30','除草清枯','m²',30,1,datetime('now')),
('ct-31','绿化浇水','吨',31,1,datetime('now')),
('ct-32','落叶清扫','m²',32,1,datetime('now')),
('ct-33','设备维修','点位',33,1,datetime('now')),
('ct-34','滴箭更换','个',34,1,datetime('now')),
('ct-35','花箱更换','个',35,1,datetime('now')),
('ct-36','绿地保洁','m²',36,1,datetime('now'));
