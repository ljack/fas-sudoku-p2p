// AUTO-GENERATED - DO NOT EDIT DIRECTLY
import { FeatureRegistry } from './registry';

import { sudokuFeature } from '../features/sudoku/feature';

export function registerActiveFeatures(registry: FeatureRegistry) {
  registry.register(sudokuFeature);
}
