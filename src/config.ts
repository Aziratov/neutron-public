import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN!,
    clientId: process.env.CLIENT_ID!,
  },
  claude: {
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
    timeout: 300_000,
    maxTokens: 4096,
  },
  paths: {
    root: join(__dirname, '..'),
    claudeMd: join(__dirname, '..', 'CLAUDE.md'),
    brain: join(__dirname, '..', 'data', 'brain'),
    log: join(__dirname, '..', 'data', 'trading-bot.log'),
  },
  // The primary investor — Neutron adapts to this user's trading style
  primaryInvestor: {
    username: 'bertrand09580',
    discordId: process.env.PRIMARY_INVESTOR_ID || '',
  },
  // Server owner — full access everywhere, no restrictions
  owner: {
    username: 'moharagon',
  },
  // Channel names the bot auto-creates and listens to without mentions
  watchedChannels: ['ask-neutron', 'trade-signals', 'neutron-kokou-chat'],
  // Bertrand's private channel — only he + Mo can type, everyone else spectates
  privateChannel: {
    name: 'neutron-kokou-chat',
    topic: 'Kokou\'s private trading channel with Neutron — read-only for guests',
  },
  // All channels to auto-create under the "Trading" category
  autoChannels: [
    { name: 'trade-signals', topic: 'Live trade signals and alerts from Neutron' },
    { name: 'market-analysis', topic: 'Daily market research and technical analysis' },
    { name: 'portfolio', topic: 'Portfolio positions, P&L, and risk tracking' },
    { name: 'journal', topic: 'Trade journal — every trade logged with reasoning and outcome' },
    { name: 'strategy', topic: 'Evolving trading strategy and backtesting results' },
    { name: 'ask-neutron', topic: 'Ask Neutron anything about trading — no need to @ mention here' },
    { name: 'neutron-kokou-chat', topic: 'Kokou\'s private trading channel with Neutron — read-only for guests' },
  ],
} as const;
