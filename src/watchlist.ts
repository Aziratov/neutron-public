import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { config } from './config.js';

export interface WatchlistEntry {
  ticker: string;
  addedAt: string;
  addedBy: string;
  notes?: string;
}

const WATCHLIST_PATH = join(config.paths.root, 'data', 'watchlist.json');

function ensureDataDir(): void {
  const dir = dirname(WATCHLIST_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadWatchlist(): WatchlistEntry[] {
  try {
    if (!existsSync(WATCHLIST_PATH)) return [];
    return JSON.parse(readFileSync(WATCHLIST_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveWatchlist(list: WatchlistEntry[]): void {
  ensureDataDir();
  writeFileSync(WATCHLIST_PATH, JSON.stringify(list, null, 2), 'utf-8');
}

export function addToWatchlist(ticker: string, addedBy: string, notes?: string): { success: boolean; message: string } {
  const list = loadWatchlist();
  const normalized = ticker.toUpperCase().trim();

  if (list.some(e => e.ticker === normalized)) {
    return { success: false, message: `${normalized} is already on the watchlist.` };
  }

  list.push({
    ticker: normalized,
    addedAt: new Date().toISOString(),
    addedBy,
    notes,
  });
  saveWatchlist(list);
  return { success: true, message: `Added ${normalized} to the watchlist.` };
}

export function removeFromWatchlist(ticker: string): { success: boolean; message: string } {
  const list = loadWatchlist();
  const normalized = ticker.toUpperCase().trim();
  const filtered = list.filter(e => e.ticker !== normalized);

  if (filtered.length === list.length) {
    return { success: false, message: `${normalized} is not on the watchlist.` };
  }

  saveWatchlist(filtered);
  return { success: true, message: `Removed ${normalized} from the watchlist.` };
}

export function getWatchlist(): WatchlistEntry[] {
  return loadWatchlist();
}

export function isOnWatchlist(ticker: string): boolean {
  return loadWatchlist().some(e => e.ticker === ticker.toUpperCase().trim());
}

export function getWatchlistTickers(): string[] {
  return loadWatchlist().map(e => e.ticker);
}
