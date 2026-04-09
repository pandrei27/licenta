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
•	impact_magnitude: Integer (1-10). Determines visual edge thickness.
•	time_horizon: String (Enum: "Short", "Medium", "Long").
•	reasoning: String (Verbose fundamental economic theory).
4. API Data Contracts (FastAPI $\leftrightarrow$ React)
The backend must serve data in a format natively digestible by React Flow.
GET /api/simulation/{node_id} Returns the sub-graph needed for visualization.
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
4.	If Target Node's Edge is DIRECT: The Target inherits the exact state of the Source. Source INCREASING + DIRECT Edge = Target INCREASING (Green). Source DECREASING + DIRECT Edge = Target DECREASING (Red).
5.	If Target Node's Edge is INVERSE: The Target gets the opposite state of the Source. Source INCREASING + INVERSE Edge = Target DECREASING (Red). Source DECREASING + INVERSE Edge = Target INCREASING (Green).
6.	This logic cascades down the branch recursively.
6. UI/UX Elements & Interaction Flow
Single Canvas Rule: There is only ever one active simulation on the screen. Starting a new simulation clears the current canvas.
•	Simulation Init: A simple input bar where the user types "What happens if [Node] goes [UP/DOWN]?".
•	Visual Rules: Calculated INCREASING nodes/edges render as GREEN. Calculated DECREASING nodes/edges render as RED. Edge thickness = edge.data.impact_magnitude (mapped to CSS stroke-width).
•	Node Interaction ("View More"): Clicking a node opens a side panel or modal displaying the stored macroeconomic reasoning and expected percentual impact for the relationship that led to it.
•	Expansion (The "Expand" Button): Available on any node. Clicking expand DOES NOT change the current state of the node. It triggers the backend to query Gemini for $n=1$ new neighbors, writes them to Neo4j, and refreshes the React Flow canvas to show the new deeper level.
7. AI Prompting Strategy & LLM Schema
To prevent hallucinations and iteration loops, the AI is used only as a Map Maker, not a State Simulator. The AI defines the universal rules (DIRECT/INVERSE), while Python handles the state calculation.
The System Prompt for /api/expand/{node_id}: When expanding a node, the backend queries Neo4j for existing neighbors to avoid duplicates, then sends this prompt to Gemini:
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
8. Verbose Implementation Phasing (For Agent Prompting)
This section dictates the exact sequential order of development. Do not move to the next phase until the current phase is fully functional.
Phase 1: Project Initialization & Basic UI Shell
•	Scaffold the React (Vite) frontend and FastAPI backend.
•	Install TailwindCSS, React Flow, and Axios on the frontend.
•	Install FastAPI, Uvicorn, and Pydantic on the backend.
•	Create a simple, empty React Flow canvas that occupies 80% of the screen, with a top navigation bar for the simulation input.
Phase 2: The Mocked Data Engine
•	Create a hardcoded Python dictionary in FastAPI matching the JSON structure in Section 4. Include 3 nodes and 2 edges.
•	Create a GET endpoint to serve this mock data.
•	Have React Flow fetch this data on load and render the basic, unstyled nodes and edges.
Phase 3: The State Calculation Algorithm
•	Implement the recursive Traversal Ruleset (Section 5) in JavaScript/React.
•	Hardcode the root node's state as INCREASING.
•	Write the logic that parses the incoming edges, checks if they are DIRECT or INVERSE, and dynamically assigns a GREEN or RED styling class to the connected nodes and edges. Ensure the visual rules from Section 6 are functional.
Phase 4: The Interaction Layer
•	Build the "View More" feature. Add an onClick event to the React Flow nodes.
•	When clicked, slide out a side panel or modal. Populate it with the reasoning, impact_magnitude, and time_horizon data from the edge that connects to it.
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
•	Write the backend logic to execute the prompt from Section 7, enforcing the strict JSON output schema using Pydantic.
•	Write the Cypher MERGE query to insert the AI-generated nodes and edges into Neo4j.
•	Wire the "Expand" button on the frontend to hit this endpoint, wait for the response, and then re-fetch the simulation data to update the canvas.

