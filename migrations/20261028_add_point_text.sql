-- 2026-10-28 养护点支持"其他"手填名称
-- 存量库（本地已有 .wrangler 数据 / 线上 D1）需要执行本文件补列；
-- 全新库直接跑 schema.sql 即可，本列已内置。
--
-- 本地：  npx wrangler d1 execute zlg-garden-db --local  --file=./migrations/20261028_add_point_text.sql
-- 线上：  npx wrangler d1 execute zlg-garden-db --remote --file=./migrations/20261028_add_point_text.sql

ALTER TABLE daily_records ADD COLUMN point_text TEXT;
