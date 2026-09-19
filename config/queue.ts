export const QUEUE_CONFIG = {
  dailyCount: 4,
  hardCount: 2,
  mediumCount: 2,
  easyCount: 0,
  topicWeightExponent: 2,
  difficultyMultiplier: {
    HARD:   1.5,
    MEDIUM: 1.0,
    EASY:   0.5,
  },
} as const;
