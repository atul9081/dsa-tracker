export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type Status = 'TO_DO' | 'ATTEMPTING' | 'SOLVED';

export interface Problem {
  id: number;
  title: string;
  title_slug: string;
  difficulty: Difficulty;
  topic_tags: string[];
  description: string | null;
  ac_rate: number | null;
  paid_only: boolean;
  olt_score: number;
}

export interface ProblemWithStatus extends Problem {
  status: Status;
  status_updated_at: string | null;
  // Timing fields — populated once Phase 2 DB migration runs (null until then)
  attempt_started_at: string | null;
  solve_duration_secs: number | null;
  first_attempted_at: string | null;
}

export interface DailyQueue {
  date: string;
  problem_ids: number[];
}

export interface UserProgress {
  problem_id: number;
  status: Status;
  updated_at: string;
}

export interface UserSettings {
  daily_count: number;
  hard_count: number;
  medium_count: number;
  easy_count: number;
  difficulty_mode: 'chill' | 'standard' | 'grind' | 'custom';
  enabled_topic_slugs: string[] | null;  // null = all topics
  topic_weight_overrides: Record<string, number>;
}

