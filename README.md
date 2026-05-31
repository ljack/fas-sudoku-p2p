# FAS-Sudoku-App: Cosmic Web Sudoku Game

FAS-Sudoku-App is a premium, web-based **Sudoku application** built on top of the build-time configured [FAS-Framework](https://github.com/ljack/fas-framework) and complying with the [Feature-Agent-Spec (FAS)](https://github.com/ljack/feature-agent-spec) architectural standard.

This application is completely stateless, containerized, and uses a PostgreSQL database to manage active boards.

### Key Features
- **Stateless Cyber UI**: Glassmorphic, modern dark-mode responsive board with client-side conflicts checking.
- **Backtracking Auto-Solver**: An automated solver running on the server that completes any puzzle dynamically.
- **Live Co-Op Multiplayer**: Multiple players can access the same RESTful URL (no login required) to collaborate in real-time.
- **Instant Play Syncing**: Peer moves propagate instantly over Server-Sent Events (SSE) and update cell inputs in-place, preserving focused elements and cursor highlights.
- **Multiplayer Presence Panel**: A live overlay showing active players count, peer cursor highlights, and computed idle timeouts updated every 5 seconds.

---

## 1. FAS Compliance Analysis

This application demonstrates the clean pluggability of the FAS pattern:

*   **Isolated Directory Sandboxing:** All Sudoku gameplay logic, database schema migrations, and frontend UI templates are kept inside [features/sudoku/](features/sudoku).
*   **Compile-Time Integration:** When the application is compiled, the build prep script (`scripts/build_prep.js`) reads `config.json` and dynamically registers the `sudoku` feature in `core/registry_manifest.ts`. The TypeScript compiler tree-shakes and compiles only the active files, ensuring zero compile-time remnants from other features.
*   **Stateless Containerization:** The application container writes no state to its local disk. Database queries and migrations are executed against a decoupled PostgreSQL database, enabling high scalability.

---

## 2. The FAS Architectural Ecosystem

The following public repositories form the complete FAS-compliant stack:
1.  **Specification Repository:** [ljack/feature-agent-spec](https://github.com/ljack/feature-agent-spec) (Architectural standards and rules).
2.  **Core Framework Engine:** [ljack/fas-framework](https://github.com/ljack/fas-framework) (Unopinionated Node/Express engine implementing the FAS build-time lifecycle).
3.  **Sudoku Application (This Repo):** [ljack/fas-sudoku-app](https://github.com/ljack/fas-sudoku-app) (An instance of the framework running the Sudoku feature).

---

## 3. How to Run Locally

### Option A: Using Docker Compose (Recommended)
This spins up the stateless application container and a PostgreSQL database container together, automatically running migrations:

```bash
docker compose up --build
```
Open your browser to `http://localhost:3000/sudoku` to start a new game.

### Option B: Local Node.js execution
If you have an external PostgreSQL database running, configure it and run:

```bash
# 1. Install dependencies
npm install

# 2. Configure connection
export DATABASE_URL="postgresql://username:password@localhost:5432/database"

# 3. Start local development hot-reloads
npm run dev
```
