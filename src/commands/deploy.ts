/**
 * Deploy slash commands to Discord.
 * Run: pnpm build && node dist/commands/deploy.js
 */
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './index.js';

const token = process.env.DISCORD_TOKEN!;
const clientId = process.env.CLIENT_ID!;

const rest = new REST({ version: '10' }).setToken(token);

async function deploy() {
  try {
    const commandData = commands.map(c => c.toJSON());
    console.log(`Deploying ${commandData.length} slash command(s)...`);

    // Register globally (takes up to an hour to propagate, but works everywhere)
    const data = await rest.put(
      Routes.applicationCommands(clientId),
      { body: commandData },
    ) as any[];

    console.log(`Successfully deployed ${data.length} command(s) globally.`);
  } catch (error) {
    console.error('Failed to deploy commands:', error);
    process.exit(1);
  }
}

deploy();
