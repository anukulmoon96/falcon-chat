import { config } from '../config.js';

const GREETING = /^(hi+|hello+|hey+|hai|hii+|namaste|salaam|salam|marhaba|good\s+(morning|afternoon|evening)|thanks?|thank\s+you|ok(ay)?)[\s!.]*$/i;
const SWITCH = /^\/?(projects?|switch(\s+project)?|change\s+project|select\s+project)[\s!.?]*$/i;
const HELP = /^\/?(help|menu|commands|what can you do\??)[\s!.]*$/i;
const CURRENT = /^\/?(current(\s+project)?|which project(\s+am i on)?\??)[\s!.?]*$/i;

export function parseCommand(text) {
  const t = String(text || '').trim();
  if (GREETING.test(t)) return 'greeting';
  if (SWITCH.test(t)) return 'switch';
  if (HELP.test(t)) return 'help';
  if (CURRENT.test(t)) return 'current';
  return null;
}

const firstName = (account) => account?.firstName || account?.username || 'there';

export function greetingText(account, project) {
  return `Hi ${firstName(account)}! I'm ${config.assistantName}, your AI assistant from Company A.${project ? ` You're on ${project.name}.` : ''} Ask me about violations, zones, cameras or trends, for example "Which zone had the most helmet violations this week?"`;
}

export function helpText(platform, project) {
  const switching = platform === 'Web Portal'
    ? 'Use the project menu at the top of the chat to switch projects.'
    : 'Send "projects" to switch projects, or "current" to see which one you\'re on.';
  return [
    `I answer questions about ${project ? `${project.name}'s` : 'your'} CCTV alerts with numbers, charts, tables and the camera frames behind them.`,
    'Try: "Helmet violations by zone last week", "Daily trend for the last 30 days", "Show me recent violation images from Gate 2" or "At what hours do violations peak?"',
    switching,
  ].join('\n\n');
}
