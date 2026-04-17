# PROJECT SPECIFICATION: CAUSAL-FLOW 
**Subtitle:** Autonomous Macroeconomic Reasoning Engine & Market Dynamics Analyzer

**[GLOBAL AGENT DIRECTIVE]** You are an autonomous coding agent executing a strict, phased development plan. Your primary constraint is **API Rate Limit Preservation** and **Deterministic UI Stability**. 
1. DO NOT hallucinate external libraries outside the approved stack.
2. DO NOT implement database persistence (Neo4j) or live AI API calls (Gemini) until explicitly instructed in Phase 5 and Phase 7. 
3. DO NOT skip phases. You must verify the functional completion of the current phase before moving to the next.

---

## 1. System Architecture & Tech Stack
* **Frontend:** React 18, Vite (`react-ts` template), React Flow (for DAG visualization), TailwindCSS (for styling), Dagre (for mathematical directed graph layout).
* **Backend:** Python 3.11+, FastAPI, Uvicorn.
* **Prototyping Data Layer:** In-memory SQLite + Python `NetworkX` library (for rapid graph math and caching).
* **Production Data Layer:** Neo4j Desktop (Local graph database, `bolt://localhost:7687`).
* **AI Integration:** Google Gemini API (`google-generativeai`), utilizing strict `response_mime_type="application/json"`.

---

## 2. Database Schema & Data Models
Logic is stored exclusively on the Edges. Traversal is strictly unidirectional (Source $\rightarrow$ Target).

**Nodes (Entity Model):**
* `id`: UUID4 (String)
* `label`: String (e.g., "10-Year Treasury Yield")

**Edges (Relationship Model):**
* `source_id`: UUID4
* `target_id`: UUID4
* `base_direction`: String (STRICT Enum: `"DIRECT"` or `"INVERSE"`).
* `impact_percentage`: Float. The estimated real-world percentual impact on the target (e.g., 2.5, 15.0). Un-capped.
* `time_horizon`: String (Enum: `"Short"`, `"Medium"`, `"Long"`). Defined as Short = 3 months, Medium = 2 years, Long = 10+ years.
* `reasoning`: String (Verbose fundamental economic theory).

---

## 3. API Data Contracts & Caching Logic (FastAPI $\leftrightarrow$ React)
**Separation of Concerns:** The backend API serves only semantic graph data. It does NOT calculate or serve UI X/Y coordinates. 

**[AGENT DIRECTIVE - BATCH CACHING]:** To circumvent AI API rate limits, the backend `/api/expand` endpoint will request $N=5$ relationships from the LLM at once. However, it will only return $N=1$ new node to the frontend per click. The remaining 4 nodes MUST be cached in SQLite/NetworkX. On subsequent requests, the backend MUST check the local cache before calling the Gemini API.

**GET /api/simulation/{node_id}**
Returns the sub-graph needed for visualization.
```json
{
  "nodes": [
    { "id": "uuid-1", "data": { "label": "Gold" } }
  ],
  "edges": [
    { 
      "id": "edge-uuid-1", 
      "source": "uuid-1", 
      "target": "uuid-2", 
      "data": { 
        "base_direction": "INVERSE", 
        "impact_percentage": 15.5, 
        "time_horizon": "Medium", 
        "reasoning": "Higher yields increase opportunity cost of holding non-yielding gold." 
      } 
    }
  ]
}
```

---

## 4. Algorithmic Logic: UI State Calculation & Layout
**Auto-Layout (Dagre):** When the frontend receives data, it maps the JSON into React Flow format, injecting a dummy `{ position: { x: 0, y: 0 } }` into every node. It then passes the array through a `getLayoutedElements(nodes, edges, direction = 'TB')` function utilizing `dagre` to automatically assign hierarchical X/Y coordinates.

**The Traversal Ruleset (Calculated dynamically on the Frontend):**
1. User defines the Root Node and its Initial State (Enum: `INCREASING` or `DECREASING`).
2. The engine traverses outward ($N+1$) using a Breadth-First Search (BFS) approach.
3. **Cycle Prevention:** Maintain a `Set` of visited node IDs. If a path encounters an already rendered node, draw the edge, but strictly terminate state calculation for that downstream branch to prevent infinite loops.
4. **DIRECT Edge:** Target inherits the exact state of the Source. (e.g., Source `INCREASING` + `DIRECT` = Target `INCREASING` -> Render Green).
5. **INVERSE Edge:** Target inherits the opposite state of the Source. (e.g., Source `INCREASING` + `INVERSE` = Target `DECREASING` -> Render Red).

---

## 5. UI/UX Elements & Interaction Flow
**Single Canvas Rule:** Only one active simulation on the screen at a time. Starting a new simulation clears the React Flow state.

**Visual Rules:**
* Calculated `INCREASING` nodes/edges must have a distinct GREEN CSS class applied.
* Calculated `DECREASING` nodes/edges must have a distinct RED CSS class applied.
* **Edge Thickness:** Write a JS utility function `calculateEdgeWidth(impact_percentage)` that applies a logarithmic scale. Input is uncapped (e.g., 0.1 to 500.0). Output must be constrained between `1px` and `8px` for CSS `stroke-width`.

**Interactions:**
* **Node Interaction ("View More"):** `onNodeClick` event opens a Tailwind styled Side Panel. Display the `reasoning`, `impact_percentage`, and `time_horizon` of the edge leading *into* that node.
* **Expansion (The "Expand" Button):** Inside the Side Panel. Triggers `POST /api/expand/{node_id}`. Awaits JSON response, appends new nodes/edges to current state, and completely re-runs the `dagre` layout function to re-sort the tree.

---

## 6. AI Prompting Strategy (Batch Optimized)
**[AGENT DIRECTIVE - PROMPT RULE]:** Use this exact prompt string in the backend.

```text
You are an expert macroeconomist. Identify 5 macroeconomic factors structurally affected by a significant move in [Node Label]. 
Do not include [List of existing neighbor labels]. 
Determine if the causal relationship is DIRECT or INVERSE. 
Estimate the 'impact_percentage' (realistic, un-capped numerical percentage). 
Determine the 'time_horizon' (Short = 3 months, Medium = 2 years, Long = 10+ years). 
Provide verbose reasoning. 
Respond in strict JSON matching the required schema.
```

---

## 7. Verbose Implementation Phasing (STRICT EXECUTION ORDER)
**[AGENT DIRECTIVE]**: Execute these phases linearly. Provide the complete code for each phase and await user confirmation before starting the next.

### Phase 1: Zero-API Scaffolding
* Initialize Vite React TypeScript project. Install `reactflow`, `dagre`, `axios`, `tailwindcss`.
* Initialize Python FastAPI project. Install `fastapi`, `uvicorn`, `pydantic`.
* Create a basic layout: A top fixed nav-bar (for simulation input), and a main `div` occupying `100vw` and `calc(100vh - 64px)` housing the `<ReactFlow />` component.

### Phase 2: The "v0" Static Mock Engine
* **CRITICAL:** DO NOT hit external APIs.
* In FastAPI, create a hardcoded Python dictionary representing a 15-node, 14-edge economic cascade matching the exact schema in Section 3.
* Create a `GET /api/mock-simulation` endpoint. 
* Have the React app fetch this on mount and render the basic nodes/edges. They will stack at x:0, y:0.

### Phase 3: State Calculation & Auto-Layout
* Create `layoutUtils.ts`. Write the `getLayoutedElements` function using `dagre`. Pass the fetched mock data through this before passing it to `setNodes` and `setEdges`.
* Implement the BFS Traversal Ruleset in a `useEffect` hook. Hardcode the root node state as `INCREASING`.
* Dynamically map the calculated Green/Red states and the logarithmic `stroke-width` to the React Flow node/edge styles.

### Phase 4: Interaction Layer
* Build the Slide-over Side Panel component.
* Wire the `onNodeClick` event in React Flow to capture the node data and the incoming edge data.
* Populate the Side Panel with the reasoning, time horizon, and impact metrics. Add a disabled "Expand" button.

### Phase 5: Local Database Integration (NetworkX/SQLite)
* **CRITICAL:** Do NOT set up Neo4j yet. Keep dependencies light.
* Set up a basic SQLite database using Python's `sqlite3`. 
* Use Python's `NetworkX` library to construct the graph logic in memory when the server boots.
* Refactor the `GET` endpoint to traverse the SQLite/NetworkX graph instead of the static mock dictionary.

### Phase 6: Simulation Initialization UI & Generative Start
* Build the Top Nav Bar inputs: A text input for Node Label (e.g., "S&P 500", "High Inflation") and a Select dropdown for UP/DOWN.
* Create a `POST /api/start` endpoint on the FastAPI backend. 
* **The Logic:** When the user clicks "Start Simulation", the frontend clears the canvas and posts the input string to this endpoint. For Phase 6, have this endpoint temporarily return the static mock dictionary from Phase 2, but dynamically change the Root Node's label to match whatever text the user typed in. Trigger the `dagre` layout.

### Phase 7: The Resilient AI Brain (Gemini + Tenacity)
* Install `google-generativeai` and `tenacity` in Python.
* **CRITICAL:** Wrap the Gemini API call in a `@retry(wait=wait_exponential(multiplier=1, min=4, max=10), stop=stop_after_attempt(5))` decorator to gracefully handle `429 Too Many Requests`.
* Create `POST /api/expand/{node_id}`.
* **Integrate AI into Start & Expand:** * Update `POST /api/start`: Take the user's raw text input, send it to Gemini using the prompt in Section 6, parse the 5 generated relationships, cache them in SQLite, and return 1 to the frontend as the starting cascade.
  * Update `POST /api/expand`: Do the exact same thing, but use the clicked node's label as the prompt input. 
* Wire the active "Expand" button on the frontend Side Panel to hit the expand endpoint, append the result to `nodes`/`edges` state, and re-run the `dagre` layout.