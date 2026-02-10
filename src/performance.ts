import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { config } from './config.js';
import { log } from './index.js';

const PERF_PATH = join(config.paths.root, 'data', 'performance.json');

export interface Recommendation {
  id: string;
  date: string;
  ticker: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;      // 0-100
  type: string;            // analysis, options, signal, morning-brief
  summary: string;         // 1-2 sentence summary of the call
  outcome?: 'correct' | 'wrong' | 'partial' | 'pending';
  reviewedAt?: string;
  reviewNotes?: string;
}

export interface PerformanceData {
  recommendations: Recommendation[];
  weeklyScores: WeeklyScore[];
  strategyNotes: string[];   // Lessons Neutron has learned about himself
  lastNightlyReview: string;
  lastWeeklyReview: string;
}

export interface WeeklyScore {
  weekOf: string;          // Monday date
  totalCalls: number;
  correct: number;
  wrong: number;
  partial: number;
  accuracy: number;        // percentage
  bestCall: string;        // description
  worstCall: string;       // description
  lesson: string;          // key takeaway
}

function defaultPerformance(): PerformanceData {
  return {
    recommendations: [],
    weeklyScores: [],
    strategyNotes: [],
    lastNightlyReview: '',
    lastWeeklyReview: '',
  };
}

function ensureDir(): void {
  const dir = dirname(PERF_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadPerformance(): PerformanceData {
  try {
    if (!existsSync(PERF_PATH)) return defaultPerformance();
    return JSON.parse(readFileSync(PERF_PATH, 'utf-8'));
  } catch {
    return defaultPerformance();
  }
}

export function savePerformance(data: PerformanceData): void {
  ensureDir();
  writeFileSync(PERF_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Record a recommendation Neutron made.
 * Called after analyses, signals, morning briefs, etc.
 */
export function recordRecommendation(rec: Omit<Recommendation, 'id'>): void {
  const data = loadPerformance();
  const id = `${rec.date}-${rec.ticker}-${Date.now().toString(36)}`;
  data.recommendations.push({ ...rec, id });

  // Keep last 200 recommendations
  if (data.recommendations.length > 200) {
    data.recommendations = data.recommendations.slice(-200);
  }
  savePerformance(data);
  log(`[performance] Recorded: ${rec.direction} on ${rec.ticker} (${rec.confidence}% confidence)`);
}

/**
 * Get pending recommendations that need review (older than 1 day).
 */
export function getPendingReviews(): Recommendation[] {
  const data = loadPerformance();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  return data.recommendations.filter(r =>
    r.outcome === undefined || r.outcome === 'pending'
  ).filter(r => r.date <= oneDayAgo);
}

/**
 * Update the outcome of a recommendation after review.
 */
export function updateOutcome(id: string, outcome: 'correct' | 'wrong' | 'partial', notes: string): void {
  const data = loadPerformance();
  const rec = data.recommendations.find(r => r.id === id);
  if (rec) {
    rec.outcome = outcome;
    rec.reviewedAt = new Date().toISOString();
    rec.reviewNotes = notes;
    savePerformance(data);
  }
}

/**
 * Batch update outcomes from AI review.
 */
export function batchUpdateOutcomes(updates: { id: string; outcome: 'correct' | 'wrong' | 'partial'; notes: string }[]): void {
  const data = loadPerformance();
  for (const update of updates) {
    const rec = data.recommendations.find(r => r.id === update.id);
    if (rec) {
      rec.outcome = update.outcome;
      rec.reviewedAt = new Date().toISOString();
      rec.reviewNotes = update.notes;
    }
  }
  savePerformance(data);
}

/**
 * Record a weekly score.
 */
export function recordWeeklyScore(score: WeeklyScore): void {
  const data = loadPerformance();
  data.weeklyScores.push(score);
  // Keep last 52 weeks
  if (data.weeklyScores.length > 52) {
    data.weeklyScores = data.weeklyScores.slice(-52);
  }
  savePerformance(data);
}

/**
 * Add a strategy note — a lesson Neutron learned about his own performance.
 */
export function addStrategyNote(note: string): void {
  const data = loadPerformance();
  data.strategyNotes.push(`[${new Date().toISOString().split('T')[0]}] ${note}`);
  // Keep last 30 notes
  if (data.strategyNotes.length > 30) {
    data.strategyNotes = data.strategyNotes.slice(-30);
  }
  savePerformance(data);
}

/**
 * Get overall stats for the AI prompt context.
 */
export function getPerformanceContext(): string {
  const data = loadPerformance();
  const parts: string[] = [];

  // Recent accuracy
  const reviewed = data.recommendations.filter(r => r.outcome && r.outcome !== 'pending');
  if (reviewed.length >= 5) {
    const correct = reviewed.filter(r => r.outcome === 'correct').length;
    const partial = reviewed.filter(r => r.outcome === 'partial').length;
    const accuracy = ((correct + partial * 0.5) / reviewed.length * 100).toFixed(0);
    parts.push(`**Your Track Record:** ${reviewed.length} reviewed calls | ${accuracy}% accuracy | ${correct} correct, ${reviewed.filter(r => r.outcome === 'wrong').length} wrong, ${partial} partial`);
  }

  // Recent weekly scores
  const recentWeeks = data.weeklyScores.slice(-4);
  if (recentWeeks.length > 0) {
    parts.push(`**Recent Weekly Scores:** ${recentWeeks.map(w => `${w.weekOf}: ${w.accuracy}%`).join(' | ')}`);
  }

  // Strategy notes (what you've learned about yourself)
  if (data.strategyNotes.length > 0) {
    parts.push(`**Self-Improvement Notes:**\n${data.strategyNotes.slice(-5).map(n => `- ${n}`).join('\n')}`);
  }

  return parts.length > 0 ? parts.join('\n') : '';
}

/**
 * Mark the nightly review as done for today.
 */
export function markNightlyReview(): void {
  const data = loadPerformance();
  data.lastNightlyReview = new Date().toISOString().split('T')[0];
  savePerformance(data);
}

/**
 * Mark the weekly review as done.
 */
export function markWeeklyReview(): void {
  const data = loadPerformance();
  data.lastWeeklyReview = new Date().toISOString().split('T')[0];
  savePerformance(data);
}

export function getLastNightlyReview(): string {
  return loadPerformance().lastNightlyReview;
}

export function getLastWeeklyReview(): string {
  return loadPerformance().lastWeeklyReview;
}
