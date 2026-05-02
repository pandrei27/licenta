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
gemini_model = genai.GenerativeModel("gemini-3.1-flash-lite-preview")

# ──────────────────────────────────────────────
# IN-MEMORY GRAPH ENGINE (NetworkX)
# ──────────────────────────────────────────────
GRAPH = nx.DiGraph()


# ──────────────────────────────────────────────────────────────────────────────
# PYDANTIC MODELS
# ──────────────────────────────────────────────────────────────────────────────
class AiRelationship(BaseModel):
    label: str = Field(..., description="Target macroeconomic node label")
    base_direction: str = Field(..., description="DIRECT or INVERSE")
    impact_percentage: float = Field(..., description="Estimated real-world percentual impact")
    time_horizon: str = Field(..., description="Short | Medium | Long")
    reasoning: list[str] = Field(..., description="Verbose economic theory explanation as an array of strings")

    @field_validator("label")
    @classmethod
    def normalize_label(cls, v: str) -> str:
        return " ".join(v.strip().split()).upper()

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
    # NEW: Handle comma-separated targeted assets
    target_labels: Optional[str] = Field(default=None) 
    # NEW: Forward compatibility for custom node counts
    n_count: int = Field(default=3)

    @field_validator("node_label")
    @classmethod
    def normalize_label(cls, v: str) -> str:
        return " ".join(v.strip().split()).upper()

class ExpandNodeRequest(BaseModel):
    label: str = Field(..., min_length=1)
    existing_labels: list[str] = Field(default_factory=list)
    # NEW: Forward compatibility
    n_count: int = Field(default=2)

    @field_validator("label")
    @classmethod
    def normalize_label(cls, v: str) -> str:
        return " ".join(v.strip().split()).upper()

    @field_validator("existing_labels")
    @classmethod
    def normalize_existing(cls, v: list[str]) -> list[str]:
        return [" ".join(l.strip().split()).upper() for l in v]


# ──────────────────────────────────────────────────────────────────────────────
# SQLITE & NETWORKX CORE FUNCTIONS
# ──────────────────────────────────────────────────────────────────────────────
def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
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
    GRAPH.clear()
    with get_db_connection() as conn:
        for row in conn.execute("SELECT * FROM nodes"):
            GRAPH.add_node(row["id"], label=row["label"])
        for row in conn.execute("SELECT * FROM edges"):
            GRAPH.add_edge(row["source_id"], row["target_id"], **dict(row))
    logger.info(f"Loaded graph into RAM: {GRAPH.number_of_nodes()} nodes, {GRAPH.number_of_edges()} edges.")

def get_or_create_node(conn: sqlite3.Connection, label: str) -> str:
    norm_label = " ".join(label.strip().split()).upper()
    cur = conn.execute("SELECT id FROM nodes WHERE UPPER(label) = ?", (norm_label,))
    row = cur.fetchone()
    if row:
        return row["id"]
    new_id = str(uuid.uuid4())
    conn.execute("INSERT INTO nodes (id, label) VALUES (?, ?)", (new_id, norm_label))
    GRAPH.add_node(new_id, label=norm_label)
    return new_id

def parse_reasoning(raw_reasoning: str) -> Any:
    try:
        parsed = json.loads(raw_reasoning)
        return parsed if isinstance(parsed, list) else raw_reasoning
    except (json.JSONDecodeError, TypeError):
        return raw_reasoning

def insert_edge(conn: sqlite3.Connection, source_id: str, target_id: str, rel: AiRelationship) -> str:
    edge_id = str(uuid.uuid4())
    reasoning_str = json.dumps(rel.reasoning)
    conn.execute("""
        INSERT INTO edges (id, source_id, target_id, base_direction, impact_percentage, time_horizon, reasoning)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (edge_id, source_id, target_id, rel.base_direction, rel.impact_percentage, rel.time_horizon, reasoning_str))
    
    GRAPH.add_edge(
        source_id, target_id, id=edge_id, source_id=source_id, target_id=target_id,
        base_direction=rel.base_direction, impact_percentage=rel.impact_percentage,
        time_horizon=rel.time_horizon, reasoning=reasoning_str
    )
    return edge_id

def get_cached_subgraph(source_id: str, depth_limit: int = 4) -> Tuple[List[dict], List[dict]]:
    if source_id not in GRAPH:
        return [], []
    bfs_edges = list(nx.bfs_edges(GRAPH, source=source_id, depth_limit=depth_limit))
    if not bfs_edges:
        return [], []

    nodes_set = set()
    edges_list = []
    
    for u, v in bfs_edges:
        nodes_set.add(v) 
        data = GRAPH.edges[u, v]
        edges_list.append({
            "id": data["id"],
            "source": u,
            "target": v,
            "data": {
                "base_direction": data["base_direction"],
                "impact_percentage": data["impact_percentage"],
                "time_horizon": data["time_horizon"],
                "reasoning": parse_reasoning(data["reasoning"])
            }
        })

    nodes_list = [{"id": n, "data": {"label": GRAPH.nodes[n]["label"]}} for n in nodes_set]
    return nodes_list, edges_list


# ──────────────────────────────────────────────────────────────────────────────
# GEMINI AI BRAIN
# ──────────────────────────────────────────────────────────────────────────────

# 1. Existing Generative AI Call
@retry(wait=wait_exponential(multiplier=1, min=4, max=10), stop=stop_after_attempt(5), reraise=True)
def _call_gemini_sync(node_label: str, existing_labels: list[str], n_count: int) -> list[AiRelationship]:
    existing_str = ", ".join(existing_labels) if existing_labels else "none"
    prompt = f"""
You are an expert financial educator explaining market correlations in plain, everyday English.
Identify exactly {n_count} specific financial assets, sectors, or equities that have the HIGHEST sensitivity and most direct exposure to {node_label}. 

CRITICAL DEDUPLICATION RULE: Do not include any of these already existing factors: {existing_str}. 

For each identified asset:
1. Determine if the relationship is DIRECT or INVERSE. 
2. Estimate the 'impact_percentage' (realistic structural numbers).
3. Determine the 'time_horizon': Short (3 months), Medium (2 years), or Long (10+ years). 
4. Provide the reasoning as a simple, easy-to-understand 3-step story. 

Format the reasoning exactly like this:
- Trigger: [What happens first]
- Flow: [The real-world story]
- Effect: [The final result]

Respond in strict JSON matching the required schema: a JSON array of exactly {n_count} objects.
[
  {{ "label": "string", "base_direction": "DIRECT" | "INVERSE", "impact_percentage": float, "time_horizon": "Short" | "Medium" | "Long", "reasoning": ["Trigger:...", "Flow:...", "Effect:..."] }}
]
Output ONLY the JSON array.
""".strip()
    response = gemini_model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
    parsed = json.loads(response.text.strip().removeprefix("```json").removesuffix("```").strip())
    return [AiRelationship(**item) for item in parsed]

# 2. NEW: Targeted AI Call
@retry(wait=wait_exponential(multiplier=1, min=4, max=10), stop=stop_after_attempt(5), reraise=True)
def _call_gemini_targeted_sync(node_label: str, target_labels: list[str]) -> list[AiRelationship]:
    targets_str = ", ".join(target_labels)
    n_count = len(target_labels)
    prompt = f"""
You are an expert financial educator. 
Analyze the direct macroeconomic impact of a significant cyclical move in {node_label} on EACH of the following specific assets: {targets_str}.

You MUST return an analysis for ALL {n_count} requested target assets. Do not add any others.

For each target asset:
1. Determine if the relationship is DIRECT or INVERSE.
2. Estimate the 'impact_percentage' (realistic structural numbers).
3. Determine the 'time_horizon': Short (3 months), Medium (2 years), or Long (10+ years).
4. Provide the reasoning as a 3-step story.

Format the reasoning exactly like this:
- Trigger: [What happens first]
- Flow: [The real-world story]
- Effect: [The final result]

Respond in strict JSON matching the required schema: a JSON array of exactly {n_count} objects.
[
  {{ "label": "MUST EXACTLY MATCH THE TARGET ASSET NAME", "base_direction": "DIRECT" | "INVERSE", "impact_percentage": float, "time_horizon": "Short" | "Medium" | "Long", "reasoning": ["Trigger:...", "Flow:...", "Effect:..."] }}
]
Output ONLY the JSON array.
""".strip()
    response = gemini_model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
    parsed = json.loads(response.text.strip().removeprefix("```json").removesuffix("```").strip())
    return [AiRelationship(**item) for item in parsed]


async def get_ai_relationships(node_label: str, existing_labels: list[str], n_count: int) -> list[AiRelationship]:
    return await asyncio.to_thread(_call_gemini_sync, node_label, existing_labels, n_count)

async def get_ai_relationships_targeted(node_label: str, target_labels: list[str]) -> list[AiRelationship]:
    return await asyncio.to_thread(_call_gemini_targeted_sync, node_label, target_labels)


# ──────────────────────────────────────────────────────────────────────────────
# APPLICATION LIFECYCLE & ROUTES
# ──────────────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    load_graph_to_memory()
    yield

app = FastAPI(title="CAUSAL-FLOW API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

@app.post("/api/start")
async def start_simulation(request: StartSimulationRequest):
    node_label = request.node_label

    with get_db_connection() as conn:
        root_id = get_or_create_node(conn, node_label)

        # -------------------------------------------------------------
        # BRANCH A: TARGETED ASSETS (Specific specific relationships)
        # -------------------------------------------------------------
        if request.target_labels:
            raw_targets = [t.strip().upper() for t in request.target_labels.split(",") if t.strip()]
            target_labels = list(dict.fromkeys(raw_targets))

            edges_to_return = []
            nodes_to_return = [{"id": root_id, "data": {"label": node_label}}]
            missing_targets = []
            target_nodes_info = {}

            # Check cache per-target specifically
            for t_label in target_labels:
                tgt_id = get_or_create_node(conn, t_label)
                target_nodes_info[t_label] = tgt_id
                
                if GRAPH.has_edge(root_id, tgt_id):
                    data = GRAPH.edges[root_id, tgt_id]
                    edges_to_return.append({
                        "id": data["id"], "source": root_id, "target": tgt_id,
                        "data": {
                            "base_direction": data["base_direction"], "impact_percentage": data["impact_percentage"], 
                            "time_horizon": data["time_horizon"], "reasoning": parse_reasoning(data["reasoning"])
                        }
                    })
                    nodes_to_return.append({"id": tgt_id, "data": {"label": t_label}})
                else:
                    missing_targets.append(t_label)
            
            # Fetch missing from AI
            if missing_targets:
                try:
                    ai_rels = await get_ai_relationships_targeted(node_label, missing_targets)
                    for rel in ai_rels:
                        tgt_label_upper = rel.label.upper()
                        tgt_id = target_nodes_info.get(tgt_label_upper)
                        if not tgt_id:
                            tgt_id = get_or_create_node(conn, rel.label)
                            target_nodes_info[tgt_label_upper] = tgt_id
                            
                        if not any(n["id"] == tgt_id for n in nodes_to_return):
                            nodes_to_return.append({"id": tgt_id, "data": {"label": rel.label}})
                            
                        edge_id = insert_edge(conn, root_id, tgt_id, rel)
                        edges_to_return.append({
                            "id": edge_id, "source": root_id, "target": tgt_id,
                            "data": {"base_direction": rel.base_direction, "impact_percentage": rel.impact_percentage,
                                     "time_horizon": rel.time_horizon, "reasoning": rel.reasoning}
                        })
                    conn.commit()
                except Exception as e:
                    logger.error(f"Targeted AI Error: {e}")
                    raise HTTPException(status_code=502, detail=str(e))

            return { "nodes": nodes_to_return, "edges": edges_to_return, "initial_state": request.initial_state, "root_id": root_id }

        # -------------------------------------------------------------
        # BRANCH B: GENERATIVE RANDOM ASSETS (Standard flow)
        # -------------------------------------------------------------
        cached_nodes, cached_edges = get_cached_subgraph(root_id, depth_limit=4)
        if cached_edges:
            return {
                "nodes": [{"id": root_id, "data": {"label": node_label}}] + cached_nodes,
                "edges": cached_edges,
                "initial_state": request.initial_state,
                "root_id": root_id
            }

        try:
            ai_rels = await get_ai_relationships(node_label, [node_label], n_count=request.n_count)
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
        "edges": new_edges, "initial_state": request.initial_state, "root_id": root_id
    }

@app.post("/api/expand/{node_id}")
async def expand_node(node_id: str, request: ExpandNodeRequest):
    if node_id not in GRAPH:
        raise HTTPException(status_code=404, detail="Node not found.")

    cached_nodes, cached_edges = get_cached_subgraph(node_id, depth_limit=4)
    if cached_edges:
        return {"nodes": cached_nodes, "edges": cached_edges}

    try:
        ai_rels = await get_ai_relationships(request.label, request.existing_labels, n_count=request.n_count)
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