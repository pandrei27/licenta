PROJECT SPECIFICATION: CAUSAL-FLOW
Subtitle: Autonomous Macroeconomic Reasoning Engine & Market Dynamics Analyzer
1. Executive Summary & Core Objective
The primary goal is to build a "Mental Model as a Service" for long-term capital allocation. The software provides fundamental causal reasoning by tracing the chain of macroeconomic events. This system focuses on a strict, unidirectional outward expansion from a single root node on a single active canvas to ensure architectural stability and rapid development.
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
•	impact_percentage: Float. The estimated real-world percentual impact on the target (e.g., 2.5, 15.0, 200.0). Un-capped.
•	time_horizon: String (Enum: "Short", "Medium", "Long"). Strictly defined as Short = 3 months, Medium = 2 years, Long = 10+ years.
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
    { "id": "edge-uuid-1", "source": "uuid-1", "target": "uuid-2", "data": { "base_direction": "INVERSE", "impact_percentage": 15.5, "time_horizon": "Medium", "reasoning": "..." } }
  ]
}
5. Algorithmic Logic: UI State Calculation (The Core Engine)
The database does not store whether a node is INCREASING or DECREASING. This is a temporary simulation state calculated dynamically by the frontend (or backend before serving) based on the user's initial input.
The Traversal Ruleset (Strict Unidirectional):
1.	The user defines the Root Node and its Initial State (INCREASING or DECREASING).
2.	The engine traverses outward ($N+1$).
3.	Cycle Prevention: To prevent infinite feedback loops during UI traversal, the engine maintains a "visited nodes" registry. If a calculated path encounters an already rendered node, the edge is drawn, but further state calculation for that branch terminates.
4.	If Target Node's Edge is DIRECT: The Target inherits the exact state of the Source. Source INCREASING + DIRECT Edge = Target INCREASING (Green). Source DECREASING + DIRECT Edge = Target DECREASING (Red).
5.	If Target Node's Edge is INVERSE: The Target gets the opposite state of the Source. Source INCREASING + INVERSE Edge = Target DECREASING (Red). Source DECREASING + INVERSE Edge = Target INCREASING (Green).
6.	This logic cascades down the branch recursively.
6. UI/UX Elements & Interaction Flow
Single Canvas Rule: There is only ever one active simulation on the screen. Starting a new simulation clears the current canvas.
•	Simulation Init: A simple input bar where the user types "What happens if [Node] goes [UP/DOWN]?".
•	Visual Rules: * Calculated INCREASING nodes/edges render as GREEN.
o	Calculated DECREASING nodes/edges render as RED.
o	Edge Thickness: Mapped dynamically from edge.data.impact_percentage. Because percentages are un-capped, the frontend must apply a normalization or logarithmic scaling function to convert the percentage into a readable CSS stroke-width (e.g., ensuring a 500% impact doesn't cover the entire screen, while a 0.5% impact remains visible).
•	Node Interaction ("View More"): Clicking a node opens a side panel or modal displaying the stored macroeconomic reasoning, the exact impact_percentage, and the time_horizon data from the edge that connects to it.
•	Expansion (The "Expand" Button): Available on any node. Clicking expand DOES NOT change the current state of the node. It triggers the backend to query Gemini for $n=1$ new neighbors, writes them to Neo4j, and refreshes the React Flow canvas to show the new deeper level.
7. AI Prompting Strategy & LLM Schema
To prevent hallucinations and iteration loops, the AI is used only as a Map Maker, not a State Simulator. The AI defines the universal rules (DIRECT/INVERSE) and estimates the numerical percentage impact, while Python handles the state calculation.
The System Prompt for /api/expand/{node_id}:
When expanding a node, the backend queries Neo4j for existing neighbors to avoid duplicates, then sends this prompt to Gemini:
"You are an expert macroeconomist. Identify the top 3 macroeconomic factors structurally affected by a significant move in [Node Label]. Do not include [List of existing neighbors]. Determine if the causal relationship is DIRECT (they move in the same direction) or INVERSE (they move in opposite directions). Estimate the 'impact_percentage' (a realistic, un-capped numerical percentage estimating how much the target moves if the source makes a standard deviation move). Determine the 'time_horizon' using strictly these definitions: Short = 3 months, Medium = 2 years, Long = 10+ years. Provide a verbose reasoning. You must respond in the following JSON schema."
Required Pydantic / JSON Output Schema for Gemini:
JSON
{
  "new_relationships": [
    {
      "target_node_label": "String",
      "base_direction": "DIRECT or INVERSE",
      "impact_percentage": 5.5,
      "time_horizon": "Short, Medium, or Long",
      "reasoning": "String (Verbose explanation)"
    }
  ]
}
Backend Action: Upon receiving this JSON, FastAPI validates it via Pydantic, executes Cypher MERGE statements to create the new Nodes and Edges in Neo4j, and returns the updated graph to the frontend.
8. Verbose Implementation Phasing (For Agent Prompting)
This section dictates the exact sequential order of development. Do not move to the next phase until the current phase is fully functional.
Phase 1: Project Initialization & Basic UI Shell
•	Scaffold the React (Vite) frontend and FastAPI backend.
•	Install TailwindCSS, React Flow, and Axios on the frontend.
•	Install FastAPI, Uvicorn, and Pydantic on the backend.
•	Create a simple, empty React Flow canvas that occupies 80% of the screen, with a top navigation bar for the simulation input.
Phase 2: The Mocked Data Engine
•	Create a hardcoded Python dictionary in FastAPI matching the JSON structure in Section 4 (ensure impact_percentage is used).
•	Create a GET endpoint to serve this mock data.
•	Have React Flow fetch this data on load and render the basic, unstyled nodes and edges.
Phase 3: The State Calculation & UI Scaling Algorithm
•	Implement the recursive Traversal Ruleset (Section 5) in JavaScript/React.
•	Hardcode the root node's state as INCREASING.
•	Write the logic that parses incoming edges, checks DIRECT or INVERSE, and dynamically assigns a GREEN or RED styling class.
•	Crucial: Write a scaling function in JavaScript that takes the impact_percentage (e.g., 0.5 to 300) and converts it to a reasonable CSS stroke-width (e.g., 1px to 10px max) so the visual edges scale appropriately.
Phase 4: The Interaction Layer
•	Build the "View More" feature. Add an onClick event to the React Flow nodes.
•	When clicked, slide out a side panel or modal. Populate it with the reasoning, explicit impact_percentage, and explicit time_horizon (Short/Medium/Long) data.
•	Add an inactive "Expand" button inside this side panel.
Phase 5: The Graph Database Integration
•	Connect FastAPI to the local Neo4j Desktop instance using the official Python driver.
•	Write a Cypher query that traverses from a root node up to 3 levels deep.
•	Format the Neo4j output to perfectly match the JSON schema from Section 4.
•	Replace the mock data endpoint from Phase 2 with this live Neo4j query. Ensure the frontend still renders correctly.
Phase 6: The Simulation Init
•	Build the UI for the top input bar: a text input for the Node Label (e.g., "Gold") and a dropdown for the Initial State (UP/DOWN).
•	Create a "Start Simulation" button.
•	When clicked, clear the current canvas. Send the root node label to the backend. The backend searches Neo4j for that node and returns its sub-graph. The frontend then applies the initial UP/DOWN state and cascades the colors.
Phase 7: The AI Brain (Expansion Engine)
•	Connect the FastAPI backend to the Gemini API using the google-generativeai package.
•	Create the /api/expand/{node_id} endpoint.
•	Write the backend logic to execute the prompt from Section 7, enforcing the strict JSON output schema using Pydantic. Ensure the prompt includes the strict definitions for the time horizons and the percentage logic.
•	Write the Cypher MERGE query to insert the AI-generated nodes and edges into Neo4j.
•	Wire the "Expand" button on the frontend to hit this endpoint, wait for the response, and then re-fetch the simulation data to update the canvas.

