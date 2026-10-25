-- ============================================================
-- 庄骆贵园林养护成效管理系统 · 数据库结构
-- Cloudflare D1 (SQLite)
-- ============================================================

-- 用户与角色
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,                -- pbkdf2$10000$<salt-b64>$<hash-b64>
  password_plain TEXT,                        -- 明文密码（管理员查看/管理用）
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

-- 养护点（养护区块，隶属养护所，可选）
CREATE TABLE IF NOT EXISTS points (
  id         TEXT PRIMARY KEY,
  office_id  TEXT NOT NULL REFERENCES offices(id),
  name       TEXT NOT NULL,                   -- 养护区块名称
  owner      TEXT,                            -- 产权单位（庄市街道办/行政执法局…）
  status     TEXT,                            -- 区块状态（正常养护/…）
  category   TEXT,                            -- 区块类型（道路绿地/小区绿地/公园绿地/防护绿地…）
  area       REAL,                            -- 面积（平方米）
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
INSERT INTO users (id, username, password_hash, password_plain, display_name, role, scope_type, scope_id, must_change_pwd, enabled, created_at, updated_at)
VALUES ('u-admin', 'admin', 'pbkdf2$10000$Z60ohSn3TrpIJyOc5yGI4A==$2UcJwaNSS2JEQA17AlHSrbwiv6mSLDYOpp8+fAYs7jg=', 'Admin@123', '系统管理员', 'admin', 'all', NULL, 1, 1, datetime('now'), datetime('now'));

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

-- 养护所种子（庄市 7 + 骆驼 8 = 15 个）
INSERT INTO offices (id, region_id, name, code, sort_order, created_at) VALUES
('o-zs-1', 'r-zhuangshi', '庄一小所', 'Z1', 1, datetime("now")),
('o-zs-2', 'r-zhuangshi', '庄二小所', 'Z2', 2, datetime("now")),
('o-zs-3', 'r-zhuangshi', '庄三小所', 'Z3', 3, datetime("now")),
('o-zs-4', 'r-zhuangshi', '庄四小所', 'Z4', 4, datetime("now")),
('o-zs-5', 'r-zhuangshi', '庄五小所', 'Z5', 5, datetime("now")),
('o-zs-6', 'r-zhuangshi', '庄六小所', 'Z6', 6, datetime("now")),
('o-zs-7', 'r-zhuangshi', '庄七小所', 'Z7', 7, datetime("now")),
('o-lt-1', 'r-luotuo', '骆一小所', 'L1', 1, datetime("now")),
('o-lt-2', 'r-luotuo', '骆二小所', 'L2', 2, datetime("now")),
('o-lt-3', 'r-luotuo', '骆三小所', 'L3', 3, datetime("now")),
('o-lt-4', 'r-luotuo', '骆四小所', 'L4', 4, datetime("now")),
('o-lt-5', 'r-luotuo', '骆五小所', 'L5', 5, datetime("now")),
('o-lt-6', 'r-luotuo', '骆六小所', 'L6', 6, datetime("now")),
('o-lt-7', 'r-luotuo', '骆七小所', 'L7', 7, datetime("now")),
('o-lt-8', 'r-luotuo', '骆八小所', 'L8', 8, datetime("now"));

-- 养护点种子（庄市 94 + 骆驼 83 = 177 个）
INSERT INTO points (id, office_id, name, owner, status, category, area, sort_order, created_at) VALUES
('p-zs-001', 'o-zs-4', '兆龙路', '庄市街道办', '正常养护', '道路绿地', 11319.85, 1, datetime("now")),
('p-zs-002', 'o-zs-4', '宁波帮博物馆', '庄市街道办', '正常养护', '道路绿地', 2897.18, 2, datetime("now")),
('p-zs-003', 'o-zs-4', '庄市环卫保洁中心', '庄市街道办', '正常养护', '小区绿地', 111, 3, datetime("now")),
('p-zs-004', 'o-zs-4', '庄市街道办事处', '庄市街道办', '正常养护', '小区绿地', 3589.66, 4, datetime("now")),
('p-zs-005', 'o-zs-5', '东环北路绿地（中官路-宁镇立交）', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 42561.6, 5, datetime("now")),
('p-zs-006', 'o-zs-4', '勤勇清水园', '庄市街道办', '正常养护', '防护绿地', 27156, 6, datetime("now")),
('p-zs-007', 'o-zs-4', '滨湖半岛北围墙外', '庄市街道办', '正常养护', '道路绿地', 2114, 7, datetime("now")),
('p-zs-008', 'o-zs-4', '镇海大道绿地(镇骆东路一贵驷界)', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 85808, 8, datetime("now")),
('p-zs-009', 'o-zs-5', '明海大道环境提升工程-滨河公园', '宁波市镇海区综合行政执法局', '正常养护', '公园绿地', 16208, 9, datetime("now")),
('p-zs-010', 'o-zs-4', '澄衷路', '庄市街道办', '正常养护', '道路绿地', 1733.86, 10, datetime("now")),
('p-zs-011', 'o-zs-4', '菜场路', '庄市街道办', '正常养护', '道路绿地', 415.24, 11, datetime("now")),
('p-zs-012', 'o-zs-6', '蛟川互通绿化（立交桥下绿化）', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 157235.42, 12, datetime("now")),
('p-zs-013', 'o-zs-1', '雄镇路绿地北(钟包立交一镇骆东路)', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 26616.8, 13, datetime("now")),
('p-zs-014', 'o-zs-3', '世纪大道绿化(聚兴路一永平西路)', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 149885, 14, datetime("now")),
('p-zs-015', 'o-zs-1', '钟包立交绿化（雄镇路以北区域）', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 70000, 15, datetime("now")),
('p-zs-016', 'o-zs-5', '中官路绿地(思源路一东昌路)', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 32085.31, 16, datetime("now")),
('p-zs-017', 'o-zs-5', '明海大道（中官路-北环东路）', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 51270.6, 17, datetime("now")),
('p-zs-018', 'o-zs-7', '北外环（易斯戴学院-钟包立交）及北环东路绿地', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 109320, 18, datetime("now")),
('p-zs-019', 'o-zs-6', '北环东路（世纪大道-东外环路）南侧', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 51608, 19, datetime("now")),
('p-zs-020', 'o-zs-4', '北环东路（世纪大道-东外环路）北侧', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 45911.85, 20, datetime("now")),
('p-zs-021', 'o-zs-2', '雄镇路绿地南(钟包立交一	镇骆东路)', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 134675.7, 21, datetime("now")),
('p-zs-022', 'o-zs-4', '中兴小区', '庄市街道办', '正常养护', '小区绿地', 7293, 22, datetime("now")),
('p-zs-023', 'o-zs-4', '庄市公园', '庄市街道办', '正常养护', '公园绿地', 1592.62, 23, datetime("now")),
('p-zs-024', 'o-zs-4', '庄市大道', '庄市街道办', '正常养护', '道路绿地', 40169.78, 24, datetime("now")),
('p-zs-025', 'o-zs-4', '庄荣路', '庄市街道办', '正常养护', '道路绿地', 2123.36, 25, datetime("now")),
('p-zs-026', 'o-zs-4', '钟楼小区', '庄市街道办', '正常养护', '小区绿地', 97.8, 26, datetime("now")),
('p-zs-027', 'o-zs-4', '兆龙路与聚兴路西北侧', '庄市街道办', '正常养护', '道路绿地', 751.66, 27, datetime("now")),
('p-zs-028', 'o-zs-2', '钟包立交绿化（雄镇路以南区域）', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 83629.52, 28, datetime("now")),
('p-zs-029', 'o-zs-4', '钟包路', '庄市街道办', '正常养护', '道路绿地', 2812.55, 29, datetime("now")),
('p-zs-030', 'o-zs-4', '钟包公园', '庄市街道办', '正常养护', '公园绿地', 3301.79, 30, datetime("now")),
('p-zs-031', 'o-zs-4', '毓秀路庄市大道-逸夫路', '庄市街道办', '正常养护', '道路绿地', 2017.33, 31, datetime("now")),
('p-zs-032', 'o-zs-4', '毓秀路', '庄市街道办', '正常养护', '道路绿地', 5416.58, 32, datetime("now")),
('p-zs-033', 'o-zs-4', '永旺路勤勇段绿化', '庄市街道办', '正常养护', '道路绿地', 1756.05, 33, datetime("now")),
('p-zs-034', 'o-zs-4', '永旺工业区', '庄市街道办', '正常养护', '小区绿地', 3421, 34, datetime("now")),
('p-zs-035', 'o-zs-4', '永乐东路', '庄市街道办', '正常养护', '道路绿地', 9009.31, 35, datetime("now")),
('p-zs-036', 'o-zs-4', '小同心路（沿湖北路）', '庄市街道办', '正常养护', '道路绿地', 208, 36, datetime("now")),
('p-zs-037', 'o-zs-4', '阳光花苑', '庄市街道办', '正常养护', '小区绿地', 909.89, 37, datetime("now")),
('p-zs-038', 'o-zs-4', '逸夫路', '庄市街道办', '正常养护', '道路绿地', 48747.03, 38, datetime("now")),
('p-zs-039', 'o-zs-4', '兴庄路', '庄市街道办', '正常养护', '道路绿地', 2445.63, 39, datetime("now")),
('p-zs-040', 'o-zs-4', '祥裕路', '庄市街道办', '正常养护', '道路绿地', 130, 40, datetime("now")),
('p-zs-041', 'o-zs-4', '新胜小区', '庄市街道办', '正常养护', '小区绿地', 553.72, 41, datetime("now")),
('p-zs-042', 'o-zs-4', '西陆小区', '庄市街道办', '正常养护', '小区绿地', 873.71, 42, datetime("now")),
('p-zs-043', 'o-zs-4', '西陆路（兴庄路-菜场路）', '庄市街道办', '正常养护', '道路绿地', 35.69, 43, datetime("now")),
('p-zs-044', 'o-zs-4', '西陆路', '庄市街道办', '正常养护', '道路绿地', 125.36, 44, datetime("now")),
('p-zs-045', 'o-zs-4', '鑫隆2期明海路段绿化', '庄市街道办', '正常养护', '道路绿地', 6517.21, 45, datetime("now")),
('p-zs-046', 'o-zs-4', '兴海路', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 19190.39, 46, datetime("now")),
('p-zs-047', 'o-zs-4', '同源路与清泉路转角', '庄市街道办', '正常养护', '道路绿地', 49.75, 47, datetime("now")),
('p-zs-048', 'o-zs-4', '同源路', '庄市街道办', '正常养护', '道路绿地', 5063.27, 48, datetime("now")),
('p-zs-049', 'o-zs-4', '同益路', '庄市街道办', '正常养护', '道路绿地', 1888.9, 49, datetime("now")),
('p-zs-050', 'o-zs-4', '同心路', '庄市街道办', '正常养护', '道路绿地', 27015.9, 50, datetime("now")),
('p-zs-051', 'o-zs-4', '汤家暂住房道路旁', '庄市街道办', '正常养护', '道路绿地', 63, 51, datetime("now")),
('p-zs-052', 'o-zs-4', '汤家路', '庄市街道办', '正常养护', '道路绿地', 1036.28, 52, datetime("now")),
('p-zs-053', 'o-zs-4', '同德路', '庄市街道办', '正常养护', '道路绿地', 3806, 53, datetime("now")),
('p-zs-054', 'o-zs-4', '思源路', '庄市街道办', '正常养护', '道路绿地', 6700.21, 54, datetime("now")),
('p-zs-055', 'o-zs-4', '书香丽景西侧公园', '庄市街道办', '正常养护', '公园绿地', 17106.43, 55, datetime("now")),
('p-zs-056', 'o-zs-4', '胜隆新村', '庄市街道办', '正常养护', '小区绿地', 1550, 56, datetime("now")),
('p-zs-057', 'o-zs-4', '胜隆路', '庄市街道办', '正常养护', '道路绿地', 249, 57, datetime("now")),
('p-zs-058', 'o-zs-5', '沙河互通绿地', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 73748.18, 58, datetime("now")),
('p-zs-059', 'o-zs-5', '商帮文化公园', '宁波市镇海区综合行政执法局', '正常养护', '公园绿地', 93177.03, 59, datetime("now")),
('p-zs-060', 'o-zs-4', '勤勇新村德馨家园', '庄市街道办', '正常养护', '小区绿地', 8946, 60, datetime("now")),
('p-zs-061', 'o-zs-4', '浅水湾小区', '庄市街道办', '正常养护', '小区绿地', 3266.02, 61, datetime("now")),
('p-zs-062', 'o-zs-4', '清泉路', '庄市街道办', '正常养护', '道路绿地', 3435, 62, datetime("now")),
('p-zs-063', 'o-zs-4', '清河小区', '庄市街道办', '正常养护', '小区绿地', 704, 63, datetime("now")),
('p-zs-064', 'o-zs-4', '前港路', '庄市街道办', '正常养护', '道路绿地', 5294.38, 64, datetime("now")),
('p-zs-065', 'o-zs-5', '宁镇立交绿化', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 118349.15, 65, datetime("now")),
('p-zs-066', 'o-zs-4', '摩士广场前绿地', '庄市街道办', '正常养护', '小区绿地', 14681.14, 66, datetime("now")),
('p-zs-067', 'o-zs-4', '明海路纺织学院宿舍围墙边绿地', '庄市街道办', '正常养护', '道路绿地', 5398.46, 67, datetime("now")),
('p-zs-068', 'o-zs-4', '菱州雅庭公园', '庄市街道办', '正常养护', '公园绿地', 4208.38, 68, datetime("now")),
('p-zs-069', 'o-zs-4', '联兴社区绿化度假村路周边', '庄市街道办', '正常养护', '道路绿地', 1764.03, 69, datetime("now")),
('p-zs-070', 'o-zs-4', '联盟路', '庄市街道办', '正常养护', '道路绿地', 246, 70, datetime("now")),
('p-zs-071', 'o-zs-1', '临江单喇叭立交绿地', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 10102.8, 71, datetime("now")),
('p-zs-072', 'o-zs-1', '临江互通绿地', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 50229.63, 72, datetime("now")),
('p-zs-073', 'o-zs-4', '聚兴路', '庄市街道办', '正常养护', '道路绿地', 11122.78, 73, datetime("now")),
('p-zs-074', 'o-zs-1', '蚊川互通绿化（南段两侧及花箱）', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 45486.67, 74, datetime("now")),
('p-zs-075', 'o-zs-4', '汉塘路', '庄市街道办', '正常养护', '道路绿地', 351, 75, datetime("now")),
('p-zs-076', 'o-zs-4', '汉塘村东环北路辅路西侧绿化', '庄市街道办', '正常养护', '道路绿地', 2430, 76, datetime("now")),
('p-zs-077', 'o-zs-4', '归源路（纺织学院围墙绿化）', '庄市街道办', '正常养护', '道路绿地', 21294.63, 77, datetime("now")),
('p-zs-078', 'o-zs-4', '归源路（行道树）', '庄市街道办', '正常养护', '道路绿地', 191.35, 78, datetime("now")),
('p-zs-079', 'o-zs-4', '工一路', '庄市街道办', '正常养护', '道路绿地', 2629, 79, datetime("now")),
('p-zs-080', 'o-zs-4', '工五路', '庄市街道办', '正常养护', '道路绿地', 633, 80, datetime("now")),
('p-zs-081', 'o-zs-4', '工四路', '庄市街道办', '正常养护', '道路绿地', 1010, 81, datetime("now")),
('p-zs-082', 'o-zs-4', '工三路', '庄市街道办', '正常养护', '道路绿地', 3075, 82, datetime("now")),
('p-zs-083', 'o-zs-4', '光明路南', '庄市街道办', '正常养护', '道路绿地', 4689.7, 83, datetime("now")),
('p-zs-084', 'o-zs-4', '光明路北', '庄市街道办', '正常养护', '道路绿地', 6612.21, 84, datetime("now")),
('p-zs-085', 'o-zs-4', '工二路', '庄市街道办', '正常养护', '道路绿地', 4569, 85, datetime("now")),
('p-zs-086', 'o-zs-4', '官仓路', '庄市街道办', '正常养护', '道路绿地', 762.54, 86, datetime("now")),
('p-zs-087', 'o-zs-4', '贵安南路南', '庄市街道办', '正常养护', '道路绿地', 2725.76, 87, datetime("now")),
('p-zs-088', 'o-zs-4', '贵安南路北', '庄市街道办', '正常养护', '道路绿地', 2650.26, 88, datetime("now")),
('p-zs-089', 'o-zs-4', '冯家河路', '庄市街道办', '正常养护', '道路绿地', 5667, 89, datetime("now")),
('p-zs-090', 'o-zs-4', '芳辰路', '庄市街道办', '正常养护', '道路绿地', 7382.31, 90, datetime("now")),
('p-zs-091', 'o-zs-2', '东环北路绿地(钟包立交一中管路)', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 28374.4, 91, datetime("now")),
('p-zs-092', 'o-zs-1', '东环北路绿地(蛟川互通一钟包立交铁路)', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 97299.52, 92, datetime("now")),
('p-zs-093', 'o-zs-4', '菜市场（庄市大道1101弄）', '庄市街道办', '正常养护', '道路绿地', 163, 93, datetime("now")),
('p-zs-094', 'o-zs-4', '陈倪路', '庄市街道办', '正常养护', '道路绿地', 11437.21, 94, datetime("now")),
('p-lt-001', 'o-lt-4', '九龙大道与镇骆路转角', '骆驼街道办', '正常养护', '道路绿地', 7800, 95, datetime("now")),
('p-lt-002', 'o-lt-5', '荣吉路（通园北路-慈海南路）', '骆驼街道办', '正常养护', '道路绿地', 3175.2, 96, datetime("now")),
('p-lt-003', 'o-lt-1', '福业街', '骆驼街道办', '正常养护', '道路绿地', 1769.04, 97, datetime("now")),
('p-lt-004', 'o-lt-4', '汇湖路', '骆驼街道办', '正常养护', '道路绿地', 1558, 98, datetime("now")),
('p-lt-005', 'o-lt-7', '世纪大道绿化(镇骆西路一阳港路东约120米)', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 9785, 99, datetime("now")),
('p-lt-006', 'o-lt-5', '金华南路（永昌西路-箭港河）', '骆驼街道办', '正常养护', '道路绿地', 36, 100, datetime("now")),
('p-lt-007', 'o-lt-5', '永昌西路（金华南路-世纪大道）', '骆驼街道办', '正常养护', '道路绿地', 738, 101, datetime("now")),
('p-lt-008', 'o-lt-5', '慈海南路（北外环-澥浦界）', '骆驼街道办', '正常养护', '道路绿地', 193942, 102, datetime("now")),
('p-lt-009', 'o-lt-3', '新兴岚湾转角', '骆驼街道办', '正常养护', '道路绿地', 1339, 103, datetime("now")),
('p-lt-010', 'o-lt-5', '上诚印象西侧绿地', '骆驼街道办', '正常养护', '道路绿地', 10770, 104, datetime("now")),
('p-lt-011', 'o-lt-4', '骆兴村文化公园景观绿化工程', '骆驼街道办', '正常养护', '公园绿地', 5747, 105, datetime("now")),
('p-lt-012', 'o-lt-3', '东邑北路（兴骆路-镇骆路）', '骆驼街道办', '正常养护', '道路绿地', 77, 106, datetime("now")),
('p-lt-013', 'o-lt-3', '联勤路（西大河-金华北路）行道树（含南侧绿地）', '骆驼街道办', '正常养护', '道路绿地', 3615, 107, datetime("now")),
('p-lt-014', 'o-lt-5', '浜子巷岸线环境整治工程', '骆驼街道办', '正常养护', '道路绿地', 18162, 108, datetime("now")),
('p-lt-015', 'o-lt-8', '镇海区生活垃圾分类转运站', '镇海环卫保洁中心', '正常养护', '小区绿地', 3912.35, 109, datetime("now")),
('p-lt-016', 'o-lt-3', '金华北路(镇骆西路-骆兴西路）', '骆驼街道办', '正常养护', '道路绿地', 10858.05, 110, datetime("now")),
('p-lt-017', 'o-lt-3', '金邑华庭东侧绿地', '骆驼街道办', '正常养护', '道路绿地', 832.69, 111, datetime("now")),
('p-lt-018', 'o-lt-3', '玫瑰湾围墙边、南二路退红绿化', '骆驼街道办', '正常养护', '道路绿地', 573.13, 112, datetime("now")),
('p-lt-019', 'o-lt-3', '西大河东侧绿地(公园)南二路-镇海大道', '骆驼街道办', '正常养护', '公园绿地', 9805.66, 113, datetime("now")),
('p-lt-020', 'o-lt-3', '东邑北路（骆兴西路-金邑路）', '骆驼街道办', '正常养护', '道路绿地', 7892, 114, datetime("now")),
('p-lt-021', 'o-lt-5', '骆驼街道机电园区方严路改造工程（含行道树）', '骆驼街道办', '正常养护', '道路绿地', 505.96, 115, datetime("now")),
('p-lt-022', 'o-lt-4', '大善寺港(中大河-英雄河)整治提升工程', '骆驼街道办', '正常养护', '道路绿地', 4026, 116, datetime("now")),
('p-lt-023', 'o-lt-4', '朝东弄小区', '骆驼街道办', '正常养护', '道路绿地', 1595, 117, datetime("now")),
('p-lt-024', 'o-lt-4', '汶骆路与国道线交接和盛世华庭东侧绿地', '骆驼街道办', '正常养护', '道路绿地', 3054.44, 118, datetime("now")),
('p-lt-025', 'o-lt-4', '骆驼街道盛家路滨河景观工程（通园北路-桕墅方路）', '骆驼街道办', '正常养护', '道路绿地', 2884, 119, datetime("now")),
('p-lt-026', 'o-lt-5', '镇海大道（慈海南路-九龙大道）', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 13717.84, 120, datetime("now")),
('p-lt-027', 'o-lt-4', '四季永逸北面道路绿化', '骆驼街道办', '正常养护', '道路绿地', 945, 121, datetime("now")),
('p-lt-028', 'o-lt-4', '汇锦路（纬六路）', '骆驼街道办', '正常养护', '道路绿地', 2875.52, 122, datetime("now")),
('p-lt-029', 'o-lt-4', '纬五路（汇水路东段）', '骆驼街道办', '正常养护', '道路绿地', 7231.12, 123, datetime("now")),
('p-lt-030', 'o-lt-4', '南一西路', '骆驼街道办', '正常养护', '道路绿地', 15120.22, 124, datetime("now")),
('p-lt-031', 'o-lt-3', '镇骆路以北，新菜场周边（包含镇骆路以北行道树）', '骆驼街道办', '正常养护', '道路绿地', 4264.67, 125, datetime("now")),
('p-lt-032', 'o-lt-5', '骆霞线(九龙大道一望海南路)隔离带范围绿化', '公路段', '正常养护', '道路绿地', 5841.63, 126, datetime("now")),
('p-lt-033', 'o-lt-5', 'G329(北外环一宁镇路)', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 3007.51, 127, datetime("now")),
('p-lt-034', 'o-lt-6', '镇海新城东邑南路(永乐路永和路段)东侧沿河景观', '骆驼街道办', '正常养护', '公园绿地', 11965.4, 128, datetime("now")),
('p-lt-035', 'o-lt-6', '镇海新城永乐西路(329国道一东邑南路段)北侧沿河景观工程', '骆驼街道办', '正常养护', '公园绿地', 22467.75, 129, datetime("now")),
('p-lt-036', 'o-lt-1', '浜子港(永和路永茂路)东侧临时绿化工程', '骆驼街道办', '正常养护', '道路绿地', 12490.64, 130, datetime("now")),
('p-lt-037', 'o-lt-1', '镇海大道工程（桂花园）', '骆驼街道办', '正常养护', '公园绿地', 8794.2, 131, datetime("now")),
('p-lt-038', 'o-lt-4', '永茂西路（道路绿化及行道树）', '骆驼街道办', '正常养护', '道路绿地', 30299, 132, datetime("now")),
('p-lt-039', 'o-lt-4', '兴骆路及通园路北段', '骆驼街道办', '正常养护', '道路绿地', 4301.57, 133, datetime("now")),
('p-lt-040', 'o-lt-4', '半港路', '骆驼街道办', '正常养护', '道路绿地', 1938, 134, datetime("now")),
('p-lt-041', 'o-lt-4', '田胡路', '骆驼街道办', '正常养护', '道路绿地', 23273, 135, datetime("now")),
('p-lt-042', 'o-lt-4', '长骆路', '骆驼街道办', '正常养护', '道路绿地', 10326, 136, datetime("now")),
('p-lt-043', 'o-lt-4', '汇沁路', '骆驼街道办', '正常养护', '道路绿地', 19608, 137, datetime("now")),
('p-lt-044', 'o-lt-4', '西盛路', '骆驼街道办', '正常养护', '道路绿地', 1990.94, 138, datetime("now")),
('p-lt-045', 'o-lt-4', '昌兴路', '骆驼街道办', '正常养护', '道路绿地', 2149.65, 139, datetime("now")),
('p-lt-046', 'o-lt-4', '东开路', '骆驼街道办', '正常养护', '道路绿地', 3281.46, 140, datetime("now")),
('p-lt-047', 'o-lt-5', '汶骆路隔离带绿化', '公路段', '正常养护', '道路绿地', 4352.99, 141, datetime("now")),
('p-lt-048', 'o-lt-7', '憩园绿地(包含水体)', '宁波市镇海区综合行政执法局', '正常养护', '公园绿地', 118119.5, 142, datetime("now")),
('p-lt-049', 'o-lt-4', '兴业路', '骆驼街道办', '正常养护', '道路绿地', 1728, 143, datetime("now")),
('p-lt-050', 'o-lt-1', '西大河南北路绿地（含风景御园沿河）', '骆驼街道办', '正常养护', '道路绿地', 12994.8, 144, datetime("now")),
('p-lt-051', 'o-lt-4', '通园路', '骆驼街道办', '正常养护', '道路绿地', 80290.78, 145, datetime("now")),
('p-lt-052', 'o-lt-4', '通和路', '骆驼街道办', '正常养护', '道路绿地', 50112.82, 146, datetime("now")),
('p-lt-053', 'o-lt-4', '盛兴路', '骆驼街道办', '正常养护', '道路绿地', 19646.55, 147, datetime("now")),
('p-lt-054', 'o-lt-1', '三五路（骆兴西路-箭港路）含寺后胡巷', '骆驼街道办', '正常养护', '道路绿地', 475.02, 148, datetime("now")),
('p-lt-055', 'o-lt-1', '市民广场', '宁波市镇海区综合行政执法局', '正常养护', '公园绿地', 16478.75, 149, datetime("now")),
('p-lt-056', 'o-lt-3', '世纪大道与镇骆路转角绿地', '骆驼街道办', '正常养护', '道路绿地', 7122.99, 150, datetime("now")),
('p-lt-057', 'o-lt-7', '绕城高速生态林带绿地', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 89158.6, 151, datetime("now")),
('p-lt-058', 'o-lt-3', '趣园', '骆驼街道办', '正常养护', '公园绿地', 4341, 152, datetime("now")),
('p-lt-059', 'o-lt-3', '南二路', '骆驼街道办', '正常养护', '道路绿地', 12872, 153, datetime("now")),
('p-lt-060', 'o-lt-1', '民和路(望海南路一西大河南路)', '骆驼街道办', '正常养护', '道路绿地', 2154.75, 154, datetime("now")),
('p-lt-061', 'o-lt-4', '明斌路行道树', '骆驼街道办', '正常养护', '道路绿地', 150, 155, datetime("now")),
('p-lt-062', 'o-lt-1', '骆兴西路(G329一金华河)含丽景英郡', '骆驼街道办', '正常养护', '道路绿地', 6985.85, 156, datetime("now")),
('p-lt-063', 'o-lt-4', '骆驼街道办事处', '骆驼街道办', '正常养护', '小区绿地', 1165.52, 157, datetime("now")),
('p-lt-064', 'o-lt-3', '骆驼公园', '骆驼街道办', '正常养护', '公园绿地', 23731.4, 158, datetime("now")),
('p-lt-065', 'o-lt-4', '聚源路', '骆驼街道办', '正常养护', '道路绿地', 9078.23, 159, datetime("now")),
('p-lt-066', 'o-lt-4', '桕墅方路', '骆驼街道办', '正常养护', '道路绿地', 31939, 160, datetime("now")),
('p-lt-067', 'o-lt-3', '交警队', '骆驼街道办', '正常养护', '小区绿地', 9135, 161, datetime("now")),
('p-lt-068', 'o-lt-3', '金华南路(永平路一永乐路)望海南路与永茂路西南侧三角地块临时', '骆驼街道办', '正常养护', '道路绿地', 6075.19, 162, datetime("now")),
('p-lt-069', 'o-lt-1', '金华南北路绿地', '骆驼街道办', '正常养护', '道路绿地', 2948.05, 163, datetime("now")),
('p-lt-070', 'o-lt-1', '箭港路及箭港湖沿湖景观(西大河南路-东邑南路)', '骆驼街道办', '正常养护', '公园绿地', 10317.17, 164, datetime("now")),
('p-lt-071', 'o-lt-4', '汇水路', '骆驼街道办', '正常养护', '道路绿地', 13282.9, 165, datetime("now")),
('p-lt-072', 'o-lt-3', '桂花园南侧', '骆驼街道办', '正常养护', '小区绿地', 2457, 166, datetime("now")),
('p-lt-073', 'o-lt-1', '桂花园东、北侧绿地、华晨雅苑东侧沿河绿化', '骆驼街道办', '正常养护', '小区绿地', 10588, 167, datetime("now")),
('p-lt-074', 'o-lt-1', '静远西路', '骆驼街道办', '正常养护', '公园绿地', 6348.97, 168, datetime("now")),
('p-lt-075', 'o-lt-1', '东邑南北路（骆兴西路-永和西路）', '骆驼街道办', '正常养护', '道路绿地', 25811.76, 169, datetime("now")),
('p-lt-076', 'o-lt-4', '汶骆路周边(东盛花园)', '骆驼街道办', '正常养护', '小区绿地', 3773, 170, datetime("now")),
('p-lt-077', 'o-lt-4', '东河港路及大河路', '骆驼街道办', '正常养护', '道路绿地', 181, 171, datetime("now")),
('p-lt-078', 'o-lt-1', '昌业街（含东侧沿河绿地及锦业街）', '骆驼街道办', '正常养护', '公园绿地', 7824, 172, datetime("now")),
('p-lt-079', 'o-lt-1', '永平西路(G329-世纪大道）', '骆驼街道办', '正常养护', '道路绿地', 12472.27, 173, datetime("now")),
('p-lt-080', 'o-lt-1', '镇海新城永乐西路(329 国道一望海南路)工程', '骆驼街道办', '正常养护', '道路绿地', 9312.57, 174, datetime("now")),
('p-lt-081', 'o-lt-1', '镇海新城永和西路(西大河南路-望海南路)（含三门头路）', '骆驼街道办', '正常养护', '道路绿地', 3771.51, 175, datetime("now")),
('p-lt-082', 'o-lt-5', '九龙大道路绿化(镇海大道一江北界)', '宁波市镇海区综合行政执法局', '正常养护', '道路绿地', 24216, 176, datetime("now")),
('p-lt-083', 'o-lt-3', '镇海新城金华南路(永茂路一永和路)工程', '骆驼街道办', '正常养护', '道路绿地', 83.87, 177, datetime("now"));