-- Demo project database for trying Falcon locally: about 24,000 synthetic alerts
-- over the last 120 days, using the same alerts schema as the real projects.
CREATE DATABASE IF NOT EXISTS `LLM_DEMO_DB` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `LLM_DEMO_DB`;

CREATE TABLE IF NOT EXISTS `alerts` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `mongo_record_id` text,
  `event_id` text,
  `camera_id` text,
  `image_url` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `location_id` text,
  `sub_location_id` text,
  `alert_details` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  -- Falcon's questions are almost always "use case / place within a time range".
  -- The ID columns are TEXT, so they need prefix lengths (ObjectIds are 24 characters).
  KEY `idx_created` (`created_at`),
  KEY `idx_event_created` (`event_id`(24), `created_at`),
  KEY `idx_location_created` (`location_id`(24), `created_at`),
  KEY `idx_zone_created` (`sub_location_id`(24), `created_at`),
  KEY `idx_camera_created` (`camera_id`(24), `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET SESSION cte_max_recursion_depth = 30000;
SET SESSION time_zone = '+00:00';

INSERT INTO alerts (mongo_record_id, event_id, camera_id, image_url, created_at, location_id, sub_location_id, alert_details)
WITH RECURSIVE seq (n) AS (
  SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 24000
),
picks AS (
  SELECT n,
    ELT(1 + MOD(n * 7919, 13), 1, 1, 2, 3, 3, 3, 3, 4, 4, 5, 6, 7, 8) AS cam,
    ELT(1 + MOD(n * 104729, 10), 1, 1, 1, 1, 2, 2, 2, 3, 3, 4) AS evt,
    FLOOR(POW(MOD(n * 7907, 1000) / 1000, 1.6) * 120) AS day_back,
    ELT(1 + MOD(n * 31, 24), 6, 7, 8, 9, 9, 10, 10, 10, 11, 11, 11, 12, 13, 14, 15, 15, 16, 16, 17, 18, 19, 21, 23, 2) AS hr,
    MOD(n * 13, 60) AS mi,
    MOD(n * 7, 60) AS se
  FROM seq
),
stamped AS (
  -- Hours above are local (IST); stored values are UTC.
  SELECT *, TIMESTAMP(CURDATE() - INTERVAL day_back DAY) + INTERVAL hr HOUR + INTERVAL mi MINUTE + INTERVAL se SECOND - INTERVAL 330 MINUTE AS ts
  FROM picks
)
SELECT
  LPAD(HEX(n), 24, '0'),
  CONCAT('6650a1', LPAD(evt, 18, '0')),
  CONCAT('6650d1', LPAD(cam, 18, '0')),
  CONCAT('demo://frame/', MOD(n, 50)),
  ts,
  CONCAT('6650b1', LPAD(IF(cam <= 5, 1, 2), 18, '0')),
  CONCAT('6650c1', LPAD(CASE WHEN cam <= 2 THEN 1 WHEN cam <= 4 THEN 2 WHEN cam = 5 THEN 3 WHEN cam = 6 THEN 4 ELSE 5 END, 18, '0')),
  JSON_OBJECT(
    'confidence', ROUND(0.62 + MOD(n, 37) / 100, 2),
    'shift', CASE WHEN hr BETWEEN 6 AND 13 THEN 'A' WHEN hr BETWEEN 14 AND 21 THEN 'B' ELSE 'C' END,
    'person_count', 1 + MOD(n, 3)
  )
FROM stamped
WHERE ts <= UTC_TIMESTAMP();

-- Read-only user for the demo database: Falcon's "one user per project" pattern.
CREATE USER IF NOT EXISTS 'falcon_ro'@'%' IDENTIFIED BY 'falcon_ro_dev';
GRANT SELECT ON `LLM_DEMO_DB`.`alerts` TO 'falcon_ro'@'%';
