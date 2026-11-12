// Synthetic project used by `npm run seed` and the tests.
// IDs mirror docker/mysql/init/01-demo.sql.
const oid = (prefix, n) => `${prefix}${String(n).padStart(18, '0')}`;

const events = [
  [1, 'Helmet violation'], [2, 'Gloves violation'], [3, 'Safety vest violation'], [4, 'Restricted zone intrusion'],
].map(([n, name]) => ({ id: oid('6650a1', n), name }));

const locations = [[1, 'Plant A'], [2, 'Plant B']].map(([n, name]) => ({ id: oid('6650b1', n), name }));

const zones = [
  [1, 'Zone A', 1], [2, 'Zone B', 1], [3, 'Loading bay', 1], [4, 'Gate 2', 2], [5, 'Zone C', 2],
].map(([n, name, location]) => ({ id: oid('6650c1', n), name, location_id: oid('6650b1', location) }));

const cameras = [[1, 1], [2, 1], [3, 2], [4, 2], [5, 3], [6, 4], [7, 5], [8, 5]].map(([n, zone]) => ({
  id: oid('6650d1', n),
  name: `Cam ${String(n).padStart(2, '0')}`,
  zone_id: oid('6650c1', zone),
  location_id: zones[zone - 1].location_id,
}));

const [helmet, gloves, vest] = events.map((e) => e.id);

export const DEMO = {
  project: {
    name: 'Demo Plant',
    db_name: process.env.DEMO_DB_NAME || 'LLM_DEMO_DB',
    timezone: 'Asia/Kolkata',
    description: 'Synthetic alerts for trying Falcon',
  },
  knowledge: {
    entities: { events, locations, zones, cameras },
    glossary: [
      { term: 'PPE violations', meaning: `helmet, gloves and safety vest violations: event_id IN ('${helmet}', '${gloves}', '${vest}')` },
      { term: 'night shift', meaning: "shift C, 22:00 to 06:00: JSON_UNQUOTE(JSON_EXTRACT(alert_details, '$.shift')) = 'C'" },
      { term: 'intrusions', meaning: 'Restricted zone intrusion alerts' },
    ],
    notes: "alert_details keys: confidence (detection confidence from 0 to 1), shift ('A' 06:00-14:00, 'B' 14:00-22:00, 'C' 22:00-06:00), person_count (people in the frame).",
    examples: [
      {
        question: 'Helmet violations by zone last week',
        sql: `SELECT sub_location_id, COUNT(*) AS violations FROM alerts WHERE event_id = '${helmet}' AND created_at >= CURDATE() - INTERVAL (WEEKDAY(CURDATE()) + 7) DAY AND created_at < CURDATE() - INTERVAL WEEKDAY(CURDATE()) DAY GROUP BY sub_location_id ORDER BY violations DESC`,
      },
      {
        question: 'Daily violations over the last 30 days',
        sql: 'SELECT DATE(created_at) AS day, COUNT(*) AS violations FROM alerts WHERE created_at >= CURDATE() - INTERVAL 29 DAY GROUP BY day ORDER BY day',
      },
      {
        question: 'When do violations happen, by weekday and hour, over the last 4 weeks?',
        sql: 'SELECT HOUR(created_at) AS hour, DAYNAME(created_at) AS weekday, COUNT(*) AS violations FROM alerts WHERE created_at >= CURDATE() - INTERVAL 28 DAY GROUP BY hour, weekday, WEEKDAY(created_at) ORDER BY WEEKDAY(created_at), hour',
      },
    ],
    suggestedQuestions: [
      'Which zone had the most helmet violations last week?',
      'Show the daily trend of violations for the last 30 days',
      'At what hours do PPE violations peak?',
      'Compare Plant A and Plant B this month',
      'Show me the latest violation images from Zone B',
    ],
  },
};
