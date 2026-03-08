export interface VisualMatchDisplay {
  normalizedScore: number;
  percentage: number;
  label: string;
}

export const normalizeVisualMatchScore = (score?: number | null): number | null => {
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return null;
  }

  if (score < 0) {
    return 0;
  }

  if (score <= 1) {
    return score;
  }

  if (score <= 100) {
    return score / 100;
  }

  return 1;
};

export const getVisualMatchDisplay = (score?: number | null): VisualMatchDisplay | null => {
  const normalizedScore = normalizeVisualMatchScore(score);

  if (normalizedScore === null) {
    return null;
  }

  const percentage = Math.round(normalizedScore * 100);

  return {
    normalizedScore,
    percentage,
    label: `${percentage}% visual match`,
  };
};
