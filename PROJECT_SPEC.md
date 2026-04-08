PROJECT SPECIFICATION: CAUSAL-FLOW
Subtitle: Autonomous Macroeconomic Reasoning Engine & Market Dynamics Analyzer
1. Executive Summary & Core Objective
The primary goal is to build a "Mental Model as a Service" for long-term capital allocation. The software provides fundamental causal reasoning by tracing the chain of macroeconomic events. The system focuses on a strict, unidirectional outward expansion from a single root node to ensure architectural stability.
2. System Architecture & Tech Stack
•	Frontend: React, Vite, React Flow (for interactive DAG visualization), TailwindCSS.
•	Backend: Python (FastAPI).
•	Database: Neo4j Desktop (Local graph database, bolt://localhost:7687).
•	AI Integration: Google Gemini API (via google-generativeai), utilizing strict response_mime_type="application/json".
3. Database Schema (Neo4j)
Logic is stored exclusively on the Edges. Traversal is strictly unidirectional (Source $\rightarrow$ Target).
Nodes (Entity):
•	id: UUID (String)
•	label: String (e.g., "10-Year Treasury Yield")
Edges (Relationship):
•	source_id: UUID
•	target_id: UUID
•	base_direction: String (STRICT Enum: "DIRECT" or "INVERSE").
•	impact_magnitude: Integer (1-10). Determines visual edge thickness.
•	time_horizon: String (Enum: "Short", "Medium", "Long").
•	reasoning: String (Verbose fundamental economic theory).
4. API Data Contracts (FastAPI $\leftrightarrow$ React)
The backend must serve data in a format natively digestible by React Flow.
GET /api/simulation/{node_id}
Returns the sub-graph needed for visualization.
JSON
{
  "nodes": [
    { "id": "uuid-1", "data": { "label": "Gold" }, "position": { "x": 0, "y": 0 } }
  ],
  "edges": [
    { "id": "edge-uuid-1", "source": "uuid-1", "target": "uuid-2", "data": { "base_direction": "INVERSE", "impact_magnitude": 8, "reasoning": "..." } }
  ]
}
5. Algorithmic Logic: UI State Calculation (The Core Engine)
The database does not store whether a node is INCREASING or DECREASING. This is a temporary simulation state calculated dynamically by the frontend (or backend before serving) based on the user's initial input.
The Traversal Ruleset (Strict Unidirectional):
1.	The user defines the Root Node and its Initial State (INCREASING or DECREASING).
2.	The engine traverses outward ($N+1$).
3.	Cycle Prevention: To prevent infinite feedback loops during UI traversal, the engine maintains a "visited nodes" registry. If a calculated path encounters an already rendered node, the edge is drawn, but further state calculation for that branch terminates.
4.	If Target Node's Edge is DIRECT: The Target inherits the exact state of the Source.
o	Source INCREASING + DIRECT Edge = Target INCREASING (Green)
o	Source DECREASING + DIRECT Edge = Target DECREASING (Red)
5.	If Target Node's Edge is INVERSE: The Target gets the opposite state of the Source.
o	Source INCREASING + INVERSE Edge = Target DECREASING (Red)
o	Source DECREASING + INVERSE Edge = Target INCREASING (Green)
6.	This logic cascades down the branch recursively.
6. UI/UX Elements & Interaction Flow
•	Simulation Init: User types "What happens if [Node] goes [UP/DOWN]?"
•	Visual Rules:
o	Calculated INCREASING nodes/edges render as GREEN.
o	Calculated DECREASING nodes/edges render as RED.
o	Edge thickness = edge.data.impact_magnitude (mapped to CSS stroke-width).
•	Expansion (The "Expand" Button):
o	Available on any node.
o	Constraint: Clicking expand DOES NOT change the current state of the node. It simply triggers the backend to query Gemini for $n=1$ new neighbors, writes them to Neo4j, and refreshes the React Flow canvas to show the new deeper level.
7. AI Prompting Strategy & LLM Schema
To prevent hallucinations and iteration loops, the AI is used only as a Map Maker, not a State Simulator. The AI defines the universal rules (DIRECT/INVERSE), while Python handles the state calculation.
The System Prompt for /api/expand/{node_id}:
When expanding a node (e.g., "Inflation"), the backend queries Neo4j for its existing neighbors to avoid duplicates, then sends this prompt to Gemini:
"You are an expert macroeconomist. Identify the top 3 macroeconomic factors structurally affected by [Node Label]. Do not include [List of existing neighbors]. Determine if the causal relationship is DIRECT (they move in the same direction) or INVERSE (they move in opposite directions). Provide a verbose reasoning. You must respond in the following JSON schema."
Required Pydantic / JSON Output Schema for Gemini:
JSON
{
  "new_relationships": [
    {
      "target_node_label": "String",
      "base_direction": "DIRECT or INVERSE",
      "impact_magnitude": 1, 
      "time_horizon": "Short, Medium, or Long",
      "reasoning": "String (Verbose explanation)"
    }
  ]
}
Backend Action: Upon receiving this JSON, FastAPI validates it via Pydantic, executes Cypher MERGE statements to create the new Nodes and Edges in Neo4j, and returns the updated graph to the frontend.
8. Implementation Phasing
•	Phase 1 (Visual Skeleton): Build FastAPI and React Flow. Hardcode the JSON response (from Section 4) in Python to perfect the recursive Green/Red state calculation algorithm on the frontend.
•	Phase 2 (Graph Memory): Connect Neo4j. Write Cypher queries to replace the hardcoded JSON. Ensure path traversal queries (MATCH p=(n)-[*1..3]->(m)) successfully map to the React Flow data structure.
•	Phase 3 (AI Brain): Implement the Gemini API endpoint using the strict JSON schema in Section 7. Wire the frontend "Expand" button to this endpoint to dynamically grow the graph.

