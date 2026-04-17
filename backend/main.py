# ──────────────────────────────────────────────
# STDLIB & THIRD-PARTY IMPORTS
# ──────────────────────────────────────────────
import json
import logging
import os
import sqlite3
import uuid
import asyncio
from contextlib import asynccontextmanager
from typing import Any, Optional, Tuple, List

import networkx as nx
import google.generativeai as genai
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from tenacity import (
    retry,
    wait_exponential,
    stop_after_attempt,
    retry_if_exception_type,
    before_sleep_log,
)

# ──────────────────────────────────────────────
# LOGGING
# ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  [%(levelname)s]  %(name)s — %(message)s",
)
logger = logging.getLogger("CAUSAL-FLOW")

# ──────────────────────────────────────────────
# ENVIRONMENT CONFIGURATION
# ──────────────────────────────────────────────
GEMINI_API_KEY: str = os.environ.get("GEMINI_API_KEY", "")
DB_PATH = "causal_flow.db"

if not GEMINI_API_KEY:
    logger.warning("⚠️  GEMINI_API_KEY is not set. AI endpoints (/start, /expand) will fail.")

genai.configure(api_key=GEMINI_API_KEY)
gemini_model = genai.GenerativeModel("gemini-2.0-flash")

# ──────────────────────────────────────────────
# IN-MEMORY GRAPH ENGINE (NetworkX)
# ──────────────────────────────────────────────
# Holds the active graph state in RAM for instant BFS traversal.
# Synchronized with SQLite on every write.
GRAPH = nx.DiGraph()


# ──────────────────────────────────────────────────────────────────────────────
# PYDANTIC MODELS
# ──────────────────────────────────────────────────────────────────────────────
class AiRelationship(BaseModel):
    """Represents one causal relationship returned by the Gemini AI."""
    label: str = Field(..., description="Target macroeconomic node label")
    base_direction: str = Field(..., description="DIRECT or INVERSE")
    impact_percentage: float = Field(..., description="Estimated real-world percentual impact")
    time_horizon: str = Field(..., description="Short | Medium | Long")
    reasoning: str = Field(..., description="Verbose economic theory explanation")

    @field_validator("base_direction")
    @classmethod
    def validate_direction(cls, v: str) -> str:
        if v not in ("DIRECT", "INVERSE"):
            raise ValueError("base_direction must be 'DIRECT' or 'INVERSE'")
        return v

    @field_validator("time_horizon")
    @classmethod
    def validate_horizon(cls, v: str) -> str:
        if v not in ("Short", "Medium", "Long"):
            raise ValueError("time_horizon must be 'Short', 'Medium', or 'Long'")
        return v

class StartSimulationRequest(BaseModel):
    node_label: str = Field(..., min_length=1)
    initial_state: str = Field(default="INCREASING")

class ExpandNodeRequest(BaseModel):
    label: str = Field(..., min_length=1)
    existing_labels: list[str] = Field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────────
# SQLITE & NETWORKX CORE FUNCTIONS
# ──────────────────────────────────────────────────────────────────────────────

def get_db_connection() -> sqlite3.Connection:
    """Returns a configured SQLite connection."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initializes the SQLite database schema if it doesn't exist."""
    with get_db_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                label TEXT UNIQUE
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS edges (
                id TEXT PRIMARY KEY,
                source_id TEXT,
                target_id TEXT,
                base_direction TEXT,
                impact_percentage REAL,
                time_horizon TEXT,
                reasoning TEXT,
                FOREIGN KEY(source_id) REFERENCES nodes(id),
                FOREIGN KEY(target_id) REFERENCES nodes(id)
            )
        """)
        conn.commit()

def load_graph_to_memory():
    """Loads the entire SQLite database into the NetworkX DiGraph."""
    GRAPH.clear()
    with get_db_connection() as conn:
        for row in conn.execute("SELECT * FROM nodes"):
            GRAPH.add_node(row["id"], label=row["label"])
        for row in conn.execute("SELECT * FROM edges"):
            GRAPH.add_edge(row["source_id"], row["target_id"], **dict(row))
    logger.info(f"Loaded graph into RAM: {GRAPH.number_of_nodes()} nodes, {GRAPH.number_of_edges()} edges.")

def get_or_create_node(conn: sqlite3.Connection, label: str) -> str:
    """Gets a node ID by label, or creates it if it doesn't exist."""
    cur = conn.execute("SELECT id FROM nodes WHERE label = ?", (label,))
    row = cur.fetchone()
    if row:
        return row["id"]
    
    new_id = str(uuid.uuid4())
    conn.execute("INSERT INTO nodes (id, label) VALUES (?, ?)", (new_id, label))
    GRAPH.add_node(new_id, label=label)
    return new_id

def insert_edge(conn: sqlite3.Connection, source_id: str, target_id: str, rel: AiRelationship) -> str:
    """Inserts a new edge into SQLite and synchronizes NetworkX."""
    edge_id = str(uuid.uuid4())
    conn.execute("""
        INSERT INTO edges (id, source_id, target_id, base_direction, impact_percentage, time_horizon, reasoning)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (edge_id, source_id, target_id, rel.base_direction, rel.impact_percentage, rel.time_horizon, rel.reasoning))
    
    GRAPH.add_edge(
        source_id, target_id, id=edge_id, source_id=source_id, target_id=target_id,
        base_direction=rel.base_direction, impact_percentage=rel.impact_percentage,
        time_horizon=rel.time_horizon, reasoning=rel.reasoning
    )
    return edge_id

def get_cached_outgoing_edges(source_id: str) -> Tuple[List[dict], List[dict]]:
    """Checks if a node already has outgoing edges to prevent duplicate API calls."""
    if source_id not in GRAPH:
        return [], []
    
    out_edges = list(GRAPH.out_edges(source_id, data=True))
    if not out_edges:
        return [], []

    nodes = []
    edges = []
    for u, v, data in out_edges:
        nodes.append({"id": v, "data": {"label": GRAPH.nodes[v]["label"]}})
        edges.append({
            "id": data["id"],
            "source": u,
            "target": v,
            "data": {
                "base_direction": data["base_direction"],
                "impact_percentage": data["impact_percentage"],
                "time_horizon": data["time_horizon"],
                "reasoning": data["reasoning"]
            }
        })
    return nodes, edges

# ──────────────────────────────────────────────────────────────────────────────
# SEED DATA (Phase 2 Mock)
# ──────────────────────────────────────────────────────────────────────────────
def seed_db_if_empty():
    """Injects 1 Root, 3 Children, and 2 Deeper Children if DB is empty."""
    with get_db_connection() as conn:
        count = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
        if count > 0:
            return

        logger.info("Database is empty. Seeding Phase 2 Mock Data...")
        
        # 1 Root Node
        r_id = get_or_create_node(conn, "Federal Funds Rate")
        
        # 3 Child Nodes
        c1_id = get_or_create_node(conn, "Mortgage Rates")
        c2_id = get_or_create_node(conn, "Treasury Yields")
        c3_id = get_or_create_node(conn, "Consumer Spending")
        
        # 2 Deeper Children (attached to Mortgage Rates)
        d1_id = get_or_create_node(conn, "Housing Demand")
        d2_id = get_or_create_node(conn, "Construction Activity")

        # Create Edges
        seed_edges = [
            (r_id, c1_id, AiRelationship(label="Mortgage Rates", base_direction="DIRECT", impact_percentage=10.0, time_horizon="Short", reasoning="Directly tied to federal rates.")),
            (r_id, c2_id, AiRelationship(label="Treasury Yields", base_direction="DIRECT", impact_percentage=15.0, time_horizon="Short", reasoning="Yields track benchmark rates closely.")),
            (r_id, c3_id, AiRelationship(label="Consumer Spending", base_direction="INVERSE", impact_percentage=5.0, time_horizon="Medium", reasoning="Higher rates make borrowing expensive, reducing spend.")),
            (c1_id, d1_id, AiRelationship(label="Housing Demand", base_direction="INVERSE", impact_percentage=20.0, time_horizon="Medium", reasoning="High mortgage rates crush housing affordability.")),
            (c1_id, d2_id, AiRelationship(label="Construction Activity", base_direction="INVERSE", impact_percentage=12.0, time_horizon="Long", reasoning="Lower demand halts new developments."))
        ]

        for src, tgt, rel in seed_edges:
            insert_edge(conn, src, tgt, rel)
        
        conn.commit()


# ──────────────────────────────────────────────────────────────────────────────
# GEMINI AI BRAIN
# ──────────────────────────────────────────────────────────────────────────────
@retry(
    wait=wait_exponential(multiplier=1, min=4, max=10),
    stop=stop_after_attempt(5),
    retry=retry_if_exception_type((Exception,)),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True,
)
def _call_gemini_sync(node_label: str, existing_labels: list[str], n_count: int) -> list[AiRelationship]:
    """Requests exactly {n_count} relationships from Gemini."""
    existing_str = ", ".join(existing_labels) if existing_labels else "none"
    
    prompt = f"""
You are an expert macroeconomist. Identify exactly {n_count} macroeconomic factors structurally affected by a significant move in {node_label}. 
Do not include {existing_str}. 
Determine if the causal relationship is DIRECT or INVERSE. 
Estimate the 'impact_percentage' (realistic, un-capped numerical percentage). 
Determine the 'time_horizon' (Short = 3 months, Medium = 2 years, Long = 10+ years). 
Provide verbose reasoning. 
Respond in strict JSON matching the required schema: a JSON array of exactly {n_count} objects.
[
  {{
    "label": "string",
    "base_direction": "DIRECT" | "INVERSE",
    "impact_percentage": float,
    "time_horizon": "Short" | "Medium" | "Long",
    "reasoning": "string"
  }}
]
Output ONLY the JSON array.
""".strip()

    logger.info(f"🤖 Gemini query → '{node_label}' (Requesting {n_count} nodes)")
    response = gemini_model.generate_content(
        prompt,
        generation_config={"response_mime_type": "application/json"},
    )
    
    raw = response.text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    parsed = json.loads(raw)
    return [AiRelationship(**item) for item in parsed]

async def get_ai_relationships(node_label: str, existing_labels: list[str], n_count: int) -> list[AiRelationship]:
    """Runs the blocking Gemini call in a threadpool."""
    return await asyncio.to_thread(_call_gemini_sync, node_label, existing_labels, n_count)


# ──────────────────────────────────────────────────────────────────────────────
# APPLICATION LIFECYCLE
# ──────────────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Starting CAUSAL-FLOW Engine (SQLite + NetworkX)...")
    init_db()
    seed_db_if_empty()
    load_graph_to_memory()
    yield
    logger.info("🛑 Shutting down.")

app = FastAPI(title="CAUSAL-FLOW API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ──────────────────────────────────────────────────────────────────────────────
# ROUTES
# ──────────────────────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health_check():
    return {"status": "ok", "graph_nodes": GRAPH.number_of_nodes()}


@app.get("/api/mock-simulation")
async def get_mock_simulation():
    """Returns the full graph currently stored in memory."""
    nodes = [{"id": n, "data": {"label": d["label"]}} for n, d in GRAPH.nodes(data=True)]
    edges = [{
        "id": d["id"], "source": u, "target": v, 
        "data": {k:v for k,v in d.items() if k not in ["id", "source_id", "target_id"]}
    } for u, v, d in GRAPH.edges(data=True)]
    return {"nodes": nodes, "edges": edges}


@app.get("/api/simulation/{node_id}")
async def get_simulation(node_id: str):
    """NetworkX BFS to extract a subgraph up to 3 hops."""
    if node_id not in GRAPH:
        raise HTTPException(status_code=404, detail="Node not found.")
    
    bfs_edges = list(nx.bfs_edges(GRAPH, source=node_id, depth_limit=3))
    
    # Collect unique nodes from edges, plus the root
    sub_nodes = {node_id}
    for u, v in bfs_edges:
        sub_nodes.add(u)
        sub_nodes.add(v)

    nodes = [{"id": n, "data": {"label": GRAPH.nodes[n]["label"]}} for n in sub_nodes]
    edges = []
    for u, v in bfs_edges:
        data = GRAPH.edges[u, v]
        edges.append({
            "id": data["id"], "source": u, "target": v,
            "data": {k:v for k,v in data.items() if k not in ["id", "source_id", "target_id"]}
        })

    return {"nodes": nodes, "edges": edges}


@app.post("/api/start")
async def start_simulation(request: StartSimulationRequest):
    """
    Starts simulation. Resolves root. If cache exists, return cached outgoing edges.
    Else, asks Gemini for EXACTLY 3 relationships.
    """
    node_label = request.node_label.strip()

    with get_db_connection() as conn:
        root_id = get_or_create_node(conn, node_label)
        
        # Check Cache
        cached_nodes, cached_edges = get_cached_outgoing_edges(root_id)
        if cached_edges:
            logger.info(f"✅ Cache HIT for Start: '{node_label}'. Returning cached relationships.")
            conn.commit()
            return {
                "nodes": [{"id": root_id, "data": {"label": node_label}}] + cached_nodes,
                "edges": cached_edges,
                "initial_state": request.initial_state,
                "root_id": root_id
            }

        # Cache Miss -> Call AI for 3 relationships
        logger.info(f"🔍 Cache MISS for Start: '{node_label}'. Calling AI...")
        try:
            ai_rels = await get_ai_relationships(node_label, [node_label], n_count=3)
        except Exception as e:
            raise HTTPException(status_code=502, detail=str(e))

        new_nodes = []
        new_edges = []
        
        for rel in ai_rels:
            tgt_id = get_or_create_node(conn, rel.label)
            edge_id = insert_edge(conn, root_id, tgt_id, rel)
            
            new_nodes.append({"id": tgt_id, "data": {"label": rel.label}})
            new_edges.append({
                "id": edge_id, "source": root_id, "target": tgt_id,
                "data": {"base_direction": rel.base_direction, "impact_percentage": rel.impact_percentage,
                         "time_horizon": rel.time_horizon, "reasoning": rel.reasoning}
            })
        
        conn.commit()

    return {
        "nodes": [{"id": root_id, "data": {"label": node_label}}] + new_nodes,
        "edges": new_edges,
        "initial_state": request.initial_state,
        "root_id": root_id
    }


@app.post("/api/expand/{node_id}")
async def expand_node(node_id: str, request: ExpandNodeRequest):
    """
    Expands a node. If cache exists, returns cached outgoing edges.
    Else, asks Gemini for EXACTLY 2 relationships.
    """
    if node_id not in GRAPH:
        raise HTTPException(status_code=404, detail="Node ID not found in RAM graph.")

    # Check Cache
    cached_nodes, cached_edges = get_cached_outgoing_edges(node_id)
    if cached_edges:
        logger.info(f"✅ Cache HIT for Expand: '{request.label}'. Returning cached relationships.")
        return {"nodes": cached_nodes, "edges": cached_edges}

    # Cache Miss -> Call AI for 2 relationships
    logger.info(f"🔍 Cache MISS for Expand: '{request.label}'. Calling AI...")
    try:
        ai_rels = await get_ai_relationships(request.label, request.existing_labels, n_count=2)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    new_nodes = []
    new_edges = []

    with get_db_connection() as conn:
        for rel in ai_rels:
            tgt_id = get_or_create_node(conn, rel.label)
            edge_id = insert_edge(conn, node_id, tgt_id, rel)
            
            new_nodes.append({"id": tgt_id, "data": {"label": rel.label}})
            new_edges.append({
                "id": edge_id, "source": node_id, "target": tgt_id,
                "data": {"base_direction": rel.base_direction, "impact_percentage": rel.impact_percentage,
                         "time_horizon": rel.time_horizon, "reasoning": rel.reasoning}
            })
        conn.commit()

    return {"nodes": new_nodes, "edges": new_edges}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, log_level="info")