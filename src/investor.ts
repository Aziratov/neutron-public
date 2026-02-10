import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { config } from './config.js';

const PROFILE_PATH = join(config.paths.root, 'data', 'investor-profile.json');

export interface TradeRecord {
  ticker: string;
  action: string;        // BUY, SELL, CALL, PUT, CLOSE, WATCH
  reasoning: string;
  price?: string;
  stop?: string;
  target?: string;
  outcome?: string;       // WIN, LOSS, BREAKEVEN, OPEN
  pnl?: string;
  date: string;
}

export interface InvestorProfile {
  username: string;
  discordId: string;
  /** Sectors bertrand trades most */
  preferredSectors: string[];
  /** Options, swing, day trading, long-term, etc. */
  tradingStyle: string[];
  /** What Neutron has observed about risk behavior */
  riskNotes: string[];
  /** Running trade history (last 50) */
  trades: TradeRecord[];
  /** Key lessons Neutron has learned about this investor */
  insights: string[];
  /** Tickers bertrand watches (personal watchlist) */
  watchlist: string[];
  /** Stats */
  stats: {
    totalTrades: number;
    wins: number;
    losses: number;
    breakeven: number;
    open: number;
  };
  updatedAt: string;
}

function defaultProfile(): InvestorProfile {
  return {
    username: config.primaryInvestor.username,
    discordId: config.primaryInvestor.discordId,
    preferredSectors: [],
    tradingStyle: [],
    riskNotes: [],
    trades: [],
    insights: [],
    watchlist: [],
    stats: { totalTrades: 0, wins: 0, losses: 0, breakeven: 0, open: 0 },
    updatedAt: new Date().toISOString(),
  };
}

function ensureDir(): void {
  const dir = dirname(PROFILE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadProfile(): InvestorProfile {
  try {
    if (!existsSync(PROFILE_PATH)) return defaultProfile();
    return JSON.parse(readFileSync(PROFILE_PATH, 'utf-8'));
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(profile: InvestorProfile): void {
  ensureDir();
  profile.updatedAt = new Date().toISOString();
  writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf-8');
}

/**
 * Check if a Discord username is the primary investor.
 */
export function isPrimaryInvestor(username: string): boolean {
  return username.toLowerCase() === config.primaryInvestor.username.toLowerCase();
}

/**
 * Check by Discord user ID.
 */
export function isPrimaryInvestorId(discordId: string): boolean {
  return discordId === config.primaryInvestor.discordId;
}

/**
 * Record a trade from the primary investor.
 */
export function recordTrade(trade: TradeRecord): void {
  const profile = loadProfile();
  profile.trades.push(trade);
  // Keep last 50 trades
  if (profile.trades.length > 50) {
    profile.trades = profile.trades.slice(-50);
  }
  profile.stats.totalTrades++;
  if (trade.outcome === 'WIN') profile.stats.wins++;
  else if (trade.outcome === 'LOSS') profile.stats.losses++;
  else if (trade.outcome === 'BREAKEVEN') profile.stats.breakeven++;
  else profile.stats.open++;
  saveProfile(profile);
}

/**
 * Add an insight Neutron has learned about the investor.
 */
export function addInsight(insight: string): void {
  const profile = loadProfile();
  profile.insights.push(insight);
  // Keep last 20 insights
  if (profile.insights.length > 20) {
    profile.insights = profile.insights.slice(-20);
  }
  saveProfile(profile);
}

/**
 * Update trading style observations.
 */
export function updateStyle(styles: string[]): void {
  const profile = loadProfile();
  for (const s of styles) {
    if (!profile.tradingStyle.includes(s)) {
      profile.tradingStyle.push(s);
    }
  }
  saveProfile(profile);
}

/**
 * Update sector preferences.
 */
export function updateSectors(sectors: string[]): void {
  const profile = loadProfile();
  for (const s of sectors) {
    if (!profile.preferredSectors.includes(s)) {
      profile.preferredSectors.push(s);
    }
  }
  saveProfile(profile);
}

/**
 * Add/remove from personal watchlist.
 */
export function addToPersonalWatchlist(ticker: string): boolean {
  const profile = loadProfile();
  const t = ticker.toUpperCase();
  if (profile.watchlist.includes(t)) return false;
  profile.watchlist.push(t);
  saveProfile(profile);
  return true;
}

export function removeFromPersonalWatchlist(ticker: string): boolean {
  const profile = loadProfile();
  const t = ticker.toUpperCase();
  const before = profile.watchlist.length;
  profile.watchlist = profile.watchlist.filter(w => w !== t);
  if (profile.watchlist.length === before) return false;
  saveProfile(profile);
  return true;
}

/**
 * Build a context string for the AI prompt that summarizes what Neutron knows
 * about the primary investor.
 */
export function buildInvestorContext(): string {
  const profile = loadProfile();
  const parts: string[] = [];

  parts.push(`## Primary Investor: ${profile.username}`);

  if (profile.tradingStyle.length > 0) {
    parts.push(`**Trading Style:** ${profile.tradingStyle.join(', ')}`);
  }

  if (profile.preferredSectors.length > 0) {
    parts.push(`**Preferred Sectors:** ${profile.preferredSectors.join(', ')}`);
  }

  if (profile.watchlist.length > 0) {
    parts.push(`**Watchlist:** ${profile.watchlist.join(', ')}`);
  }

  if (profile.stats.totalTrades > 0) {
    const wr = profile.stats.wins + profile.stats.losses > 0
      ? ((profile.stats.wins / (profile.stats.wins + profile.stats.losses)) * 100).toFixed(0) + '%'
      : 'N/A';
    parts.push(`**Track Record:** ${profile.stats.totalTrades} trades | ${profile.stats.wins}W / ${profile.stats.losses}L / ${profile.stats.breakeven}BE / ${profile.stats.open} open | Win rate: ${wr}`);
  }

  if (profile.riskNotes.length > 0) {
    parts.push(`**Risk Notes:** ${profile.riskNotes.slice(-3).join('; ')}`);
  }

  if (profile.insights.length > 0) {
    parts.push(`**What you've learned about ${profile.username}:**\n${profile.insights.slice(-5).map(i => `- ${i}`).join('\n')}`);
  }

  // Recent trades (last 5)
  const recent = profile.trades.slice(-5);
  if (recent.length > 0) {
    parts.push(`**Recent Trades:**`);
    for (const t of recent) {
      const outcome = t.outcome ? ` [${t.outcome}]` : '';
      parts.push(`- ${t.date}: ${t.action} ${t.ticker}${t.price ? ' @ $' + t.price : ''}${outcome} — ${t.reasoning.slice(0, 80)}`);
    }
  }

  return parts.join('\n');
}
