import { DatabaseBridge } from './registry';

interface SudokuGame {
  id: string;
  grid: string;
  initial_grid: string;
  solution: string;
  status: string;
  created_at: Date;
}

interface LeaderboardEntry {
  game_id: string;
  nickname: string;
  time_taken: number;
  difficulty: string;
  created_at: Date;
}

export class DatabaseManager implements DatabaseBridge {
  private migrations: Map<string, string> = new Map();
  
  // In-memory storage structures
  private sudokuGames: Map<string, SudokuGame> = new Map();
  private leaderboard: LeaderboardEntry[] = [];

  constructor() {
    console.log('[Core] Operating in DATABASE-LESS (In-Memory Mock) Mode.');
  }

  // Execute parsed mock queries
  public async query(text: string, params: any[] = []): Promise<any> {
    const queryNormalized = text.trim().replace(/\s+/g, ' ').toLowerCase();

    // SELECT from sudoku_games WHERE id = $1 (Supports any field configuration by returning all fields)
    if (queryNormalized.includes('from sudoku_games where id =')) {
      const id = params[0];
      const game = this.sudokuGames.get(id);
      if (!game) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [{
          id: game.id,
          grid: game.grid,
          initial_grid: game.initial_grid,
          solution: game.solution,
          status: game.status
        }],
        rowCount: 1
      };
    }

    // 4. INSERT INTO sudoku_games
    if (queryNormalized.includes('insert into sudoku_games')) {
      const [id, grid, initial_grid, solution, status] = params;
      const game: SudokuGame = {
        id,
        grid,
        initial_grid,
        solution,
        status,
        created_at: new Date()
      };
      this.sudokuGames.set(id, game);
      return { rows: [], rowCount: 1 };
    }

    // 5. UPDATE sudoku_games
    if (queryNormalized.includes('update sudoku_games set grid =')) {
      const [grid, status, id] = params;
      const game = this.sudokuGames.get(id);
      if (game) {
        game.grid = grid;
        game.status = status;
        this.sudokuGames.set(id, game);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 6. INSERT INTO sudoku_leaderboard
    if (queryNormalized.includes('insert into sudoku_leaderboard')) {
      const [game_id, nickname, time_taken, difficulty] = params;
      const entry: LeaderboardEntry = {
        game_id,
        nickname,
        time_taken,
        difficulty,
        created_at: new Date()
      };
      this.leaderboard.push(entry);
      return { rows: [], rowCount: 1 };
    }

    // 7. SELECT leaderboard scores
    if (queryNormalized.includes('select nickname, time_taken, difficulty, created_at from sudoku_leaderboard')) {
      const sorted = [...this.leaderboard]
        .sort((a, b) => a.time_taken - b.time_taken)
        .slice(0, 10);
      return {
        rows: sorted.map(e => ({
          nickname: e.nickname,
          time_taken: e.time_taken,
          difficulty: e.difficulty,
          created_at: e.created_at
        })),
        rowCount: sorted.length
      };
    }

    console.warn(`[Core DB Mock] Unrecognized query signature: "${text}" with params:`, params);
    return { rows: [], rowCount: 0 };
  }

  // Register migration (no-op)
  public registerMigration(featureName: string, sql: string) {
    this.migrations.set(featureName, sql);
    console.log(`[Core DB Mock] Feature "${featureName}" registered a schema migration.`);
  }

  // Execute migrations (no-op)
  public async executeMigrations() {
    console.log(`[Core DB Mock] Verified and executed ${this.migrations.size} registered migrations in memory.`);
  }

  // Close connection (no-op)
  public async close() {
    console.log('[Core DB Mock] Closed active db handle.');
  }
}
