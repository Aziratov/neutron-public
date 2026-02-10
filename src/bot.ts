import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.js';
import { registerReadyEvent } from './events/ready.js';
import { registerMessageCreate } from './events/messageCreate.js';
import { registerInteractionCreate } from './events/interactionCreate.js';
import { startScheduler } from './scheduler.js';

export function createBot(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
    allowedMentions: {
      parse: ['users', 'roles'],
      repliedUser: false,
    },
  });

  // Register all event handlers
  registerReadyEvent(client);
  registerMessageCreate(client);
  registerInteractionCreate(client);

  // Start scheduled market scans once the client is ready
  client.once('ready', () => {
    startScheduler(client);
  });

  return client;
}

export async function startBot(client: Client): Promise<void> {
  await client.login(config.discord.token);
}
