# Architectural Review & Analysis: FAS-Sudoku-App

This document provides a detailed structural analysis of the **FAS-Sudoku-App** and how it adheres to the **Feature-Agent-Spec (FAS)** architecture.

---

## 1. Feature-Agent-Spec (FAS) Alignment

The architecture of `fas-sudoku-app` is split into two distinct, decoupled boundaries:
1.  **The Core Engine (`core/`)**: Agnostic of specific feature modules. It manages database pooling, hooks router contexts, boots lifecycle manifests, and exposes a decoupled EventBus.
2.  **The Sandboxed Features (`features/`)**: Self-contained directories containing feature-specific database schema migrations, client assets (HTML/CSS/JS), and Express route definitions.

### Build-Time Feature Gating & Tree-Shaking
To enforce the **Zero-Remnant Removability** rule, features are registered dynamically at **build-time** using a generator script:

```mermaid
graph TD
    config["config.json<br>(Toggles Features)"] --> buildPrep["scripts/build_prep.js<br>(Manifest Generator)"]
    buildPrep --> manifest["core/registry_manifest.ts<br>(Dynamic Imports)"]
    
    subgraph Compiled Production Bundle
        manifest -->|Static Import| activeFeatures["Active Features<br>(sudoku, coop, leaderboard)"]
        core["Core Engine<br>(engine.ts)"] -->|Execute Lifecycle Hook| registry["FeatureRegistry<br>(registry.ts)"]
        registry -->|Pass Shared Context| activeFeatures
    end
    
    disabledFeatures["Disabled Features<br>(omitted)"] -.- x["Zero footprints / remnants in compilation graph"]
    
    style config fill:#1e1e38,stroke:#9d4edd,stroke-width:2px,color:#fff
    style buildPrep fill:#121824,stroke:#3a86c8,stroke-width:2px,color:#fff
    style manifest fill:#121824,stroke:#3a86c8,stroke-width:2px,color:#fff
    style activeFeatures fill:#1e293b,stroke:#06b6d4,stroke-width:2px,color:#fff
    style core fill:#1e293b,stroke:#a855f7,stroke-width:2px,color:#fff
    style disabledFeatures fill:#2d1a29,stroke:#ef4444,stroke-width:1px,stroke-dasharray: 5 5,color:#aaa
```

---

## 2. Dynamic Real-Time Sync Topology
The application achieves instant co-op synchronization without persistent socket connections (like WebSockets) by using **Server-Sent Events (SSE)**. 

SSE runs natively on HTTP/1.1 and HTTP/2 (`EventSource` in standard browser API), reducing memory footprint and keeping features decoupled via a global memory `EventBus`.

```mermaid
sequenceDiagram
    autonumber
    actor Player A
    actor Player B
    participant Browser A
    participant Browser B
    participant Express as Core Express Server
    participant EventBus as Core EventBus
    participant DB as PostgreSQL Database
    
    Note over Browser B,Express: EventSource connection open (SSE Stream)
    Express->>Browser B: SSE data: {"type": "presence", "players": [...]} (every 5s)
    
    Player A->>Browser A: Inputs value '4' at Cell 5
    Browser A->>Express: POST /api/sudoku/:id/move {cellIndex: 5, value: 4}
    Express->>DB: UPDATE sudoku_games SET grid = ... WHERE id = :id
    DB-->>Express: Update Success
    Express->>EventBus: Emit 'sudoku:move' {gameId, cellIndex, value, grid, status}
    Express-->>Browser A: POST Response: {success: true, grid, status}
    
    EventBus->>Express: Co-Op module listener catches 'sudoku:move'
    Express->>Browser B: SSE data: {"type": "move", "cellIndex": 5, "value": 4, "grid", "status"}
    Browser B->>Browser B: EventSource receives 'message'
    Browser B->>Browser B: Dispatches custom window event 'sudoku:externalMove'
    Browser B->>Browser B: Updates Cell 5 input value in-place (preserves active focus)
```

---

## 3. Component Diagram

The following diagram illustrates the relationship between components during runtime:

```mermaid
classDiagram
    class DatabaseManager {
        -Pool pgPool
        -Array migrations
        +registerMigration(feature, sql)
        +executeMigrations()
        +query(text, params)
    }

    class FeatureRegistry {
        -Array features
        -EventEmitter eventBus
        -Object sharedState
        +register(feature)
        +executeBoot(router, db)
        +executeStart(router, db)
        +executeShutdown(router, db)
    }

    class FeatureModule {
        <<interface>>
        +String name
        +onBoot(context)
        +onStart(context)
        +onShutdown(context)
    }

    class FeatureContext {
        <<interface>>
        +Router router
        +EventEmitter eventBus
        +DatabaseBridge db
        +Object state
    }

    FeatureRegistry --> FeatureModule : Manages
    FeatureRegistry --> FeatureContext : Instantiates
    DatabaseManager ..|> DatabaseBridge : Exposes
    FeatureContext --> DatabaseBridge : Database Query Link
```

---

## 4. Key Architectural Patterns in Play

### In-Place DOM Reconciliation (Client-Side)
To support a high-frequency real-time update flow without using a heavy Virtual DOM library (like React), the front-end `app.js` performs target-specific reconciliation:
1.  On receiving an external move: It queries all cell DOM nodes.
2.  If the input element is the active document focus (`document.activeElement === input`), the modification is skipped locally to prevent cursor jumping/interruptions.
3.  Otherwise, the cell's `input.value` and `conflict` classes are modified directly in-place.
4.  This prevents the deletion of peer focus border overlays, keeping animations smooth.

### Presence and Idle Detection
The presence panel computes player active states statically on the backend:
-   **SSE Stream registration**: Connecting tab appends `playerId` and `nickname` to the stream URL.
-   **Polling cycle**: Every 5 seconds, the server runs a loop over active game connections, calculating `idleSeconds = (Date.now() - lastSeen) / 1000`.
-   **Heartbeats**: The client dispatches a focus-less heartbeat `POST` to `/focus` containing `cellIndex: -2` every 10 seconds. The backend consumes the heartbeat to update `lastSeen` but does not broadcast it to peers.

---

## 5. 3-Player Co-Op Interaction Scenario

This sequence diagram illustrates a case where 3 concurrent browser sessions (Player A, Player B, Player C) are active on the same board:

```mermaid
sequenceDiagram
    autonumber
    actor A as Player A
    actor B as Player B
    actor C as Player C
    participant Express as Core Express Server
    participant EventBus as Core EventBus
    participant DB as PostgreSQL Database
    
    Note over A,C: All 3 players are connected to game stream f34a2a98
    Express->>A: SSE: {"type":"presence", "players":[{"id":"A","idle":0},{"id":"B","idle":0},{"id":"C","idle":0}]}
    Express->>B: SSE: {"type":"presence", ...}
    Express->>C: SSE: {"type":"presence", ...}
    Note over A,C: Presence panels in all 3 browsers display "👥 3 players online"
    
    %% Player A plays a move
    Note over A: Player A edits Cell 5
    A->>Express: POST /api/sudoku/:id/move {cellIndex: 5, value: 4}
    Express->>DB: UPDATE sudoku_games SET grid = ... WHERE id = :id
    Express->>EventBus: Emit 'sudoku:move'
    Express-->>A: POST Response OK
    EventBus->>Express: Co-Op feature event hook triggered
    Express->>B: SSE: {"type":"move", "cellIndex": 5, "value": 4, "grid"}
    Express->>C: SSE: {"type":"move", "cellIndex": 5, "value": 4, "grid"}
    Note over B,C: Cell 5 displays '4' instantly in both browser grids in-place
    
    %% Player B focuses a cell
    Note over B: Player B selects Cell 10
    B->>Express: POST /api/sudoku/:id/focus {cellIndex: 10, playerId: "B"}
    Express->>A: SSE: {"type":"focus", "cellIndex": 10, "playerId": "B"}
    Express->>C: SSE: {"type":"focus", "cellIndex": 10, "playerId": "B"}
    Note over A,C: Outline on Cell 10 glows with Player B's color and tag
    
    %% Player C types in the focused cell
    Note over C: Player C edits Cell 10
    C->>Express: POST /api/sudoku/:id/move {cellIndex: 10, value: 9}
    Express->>DB: UPDATE sudoku_games SET grid = ... WHERE id = :id
    Express->>EventBus: Emit 'sudoku:move'
    Express-->>C: POST Response OK
    EventBus->>Express: Co-Op feature event hook triggered
    Express->>A: SSE: {"type":"move", "cellIndex": 10, "value": 9, "grid"}
    Express->>B: SSE: {"type":"move", "cellIndex": 10, "value": 9, "grid"}
    Note over A,B: Cell 10 displays '9' in-place. Player B's cursor overlay is removed.
```
