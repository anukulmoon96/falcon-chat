import { config } from '../config.js';
import { deliverWhatsApp } from './whatsapp.js';
import { deliverTeams } from './teams.js';

// The Web Portal needs no push: the browser is listening on the task's event stream.
export async function deliver(task, conversation) {
  const { platform } = task.payload;
  if (platform === 'WhatsApp' && config.whatsapp.enabled) return deliverWhatsApp(task, conversation);
  if (platform === 'Teams' && config.teams.enabled) return deliverTeams(task, conversation);
  return null;
}
