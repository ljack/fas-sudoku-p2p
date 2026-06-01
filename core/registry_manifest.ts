// AUTO-GENERATED - DO NOT EDIT DIRECTLY
import { FeatureRegistry } from './registry';

import { sudokuFeature } from '../features/sudoku/feature';
import { leaderboardFeature } from '../features/leaderboard/feature';
import { coopFeature } from '../features/coop/feature';

export function registerActiveFeatures(registry: FeatureRegistry) {
  registry.register(sudokuFeature);
  registry.register(leaderboardFeature);
  registry.register(coopFeature);
}
