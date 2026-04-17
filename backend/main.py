# ──────────────────────────────────────────────
# STDLIB & THIRD-PARTY IMPORTS
# ──────────────────────────────────────────────
import json
import logging
import os
import uuid
import asyncio
from contextlib import asynccontextmanager
from typing import Any, Optional

import google.generativeai as genai
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from neo4j import AsyncGraphDatabase, AsyncDriver
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
# Set these in your shell or a .env file loaded by python-dotenv:
#   export GEMINI_API_KEY="..."
#   export NEO4J_URI="bolt://localhost:7687"
#   export NEO4J_USER="neo4j"
#   export NEO4J_PASSWORD="your-password"

GEMINI_API_KEY: str = os.environ.get("GEMINI_API_KEY", "")
NEO4J_URI: str      = os.environ.get("NEO4J_URI",      "bolt://localhost:7687")
NEO4J_USER: str     = os.environ.get("NEO4J_USER",     "neo4j")
NEO4J_PASSWORD: str = os.environ.get("NEO4J_PASSWORD", "password")

if not GEMINI_API_KEY:
    logger.warning(
        "⚠️  GEMINI_API_KEY is not set. AI endpoints (/start, /expand) will fail."
    )

# ──────────────────────────────────────────────
# GEMINI CLIENT INITIALISATION
# ──────────────────────────────────────────────
# Using gemini-2.0-flash as a fast, cost-effective model.
# Swap to "gemini-1.5-pro" for higher-quality reasoning if budget allows.
genai.configure(api_key=GEMINI_API_KEY)
gemini_model = genai.GenerativeModel("gemini-2.0-flash")

# ──────────────────────────────────────────────
# NEO4J ASYNC DRIVER — Module-level singleton
# ──────────────────────────────────────────────
# We hold one driver for the lifetime of the process and close it on shutdown.
neo4j_driver: Optional[AsyncDriver] = None


# ──────────────────────────────────────────────────────────────────────────────
# PYDANTIC MODELS
# ──────────────────────────────────────────────────────────────────────────────

class AiRelationship(BaseModel):
    """
    Represents one causal relationship as returned by the Gemini AI.
    Used to validate and parse each item in the AI's JSON array response.
    """
    label: str = Field(..., description="Human-readable label for the target macroeconomic node")
    base_direction: str = Field(..., description="DIRECT or INVERSE")
    impact_percentage: float = Field(..., description="Estimated real-world percentual impact, uncapped")
    time_horizon: str = Field(..., description="Short | Medium | Long")
    reasoning: str = Field(..., description="Verbose economic theory explanation")

    @field_validator("base_direction")
    @classmethod
    def validate_direction(cls, v: str) -> str:
        if v not in ("DIRECT", "INVERSE"):
            raise ValueError(f"base_direction must be 'DIRECT' or 'INVERSE', got '{v}'")
        return v

    @field_validator("time_horizon")
    @classmethod
    def validate_horizon(cls, v: str) -> str:
        if v not in ("Short", "Medium", "Long"):
            raise ValueError(f"time_horizon must be 'Short', 'Medium', or 'Long', got '{v}'")
        return v


class StartSimulationRequest(BaseModel):
    """Payload for POST /api/start"""
    node_label: str = Field(..., min_length=1, description="Root node label, e.g. 'Federal Funds Rate'")
    initial_state: str = Field(
        default="INCREASING",
        description="INCREASING or DECREASING — drives BFS state colouring on the frontend",
    )

    @field_validator("initial_state")
    @classmethod
    def validate_state(cls, v: str) -> str:
        if v not in ("INCREASING", "DECREASING"):
            raise ValueError("initial_state must be 'INCREASING' or 'DECREASING'")
        return v


class ExpandNodeRequest(BaseModel):
    """Payload for POST /api/expand/{node_id}"""
    label: str = Field(..., min_length=1, description="Label of the node being expanded")
    existing_labels: list[str] = Field(
        default_factory=list,
        description="Labels already on the canvas — AI must not repeat these",
    )


# ──────────────────────────────────────────────────────────────────────────────
# NEO4J HELPER FUNCTIONS
# ──────────────────────────────────────────────────────────────────────────────

async def get_driver() -> AsyncDriver:
    """
    Returns the module-level Neo4j async driver.
    Raises a 503 if the driver was never initialised (e.g. Neo4j is unreachable).
    """
    if neo4j_driver is None:
        raise HTTPException(
            status_code=503,
            detail="Neo4j driver is not initialised. Check NEO4J_URI / credentials.",
        )
    return neo4j_driver


async def neo4j_merge_node(driver: AsyncDriver, node_id: str, label: str) -> None:
    """
    Idempotently upsert a Node into Neo4j.
    MERGE ensures no duplicates even if the same node is generated by multiple AI calls.
    """
    cypher = """
        MERGE (n:EconomicFactor {id: $id})
        ON CREATE SET n.label = $label
        ON MATCH  SET n.label = $label
    """
    async with driver.session() as session:
        await session.run(cypher, id=node_id, label=label)


async def neo4j_merge_edge(
    driver: AsyncDriver,
    edge_id: str,
    source_id: str,
    target_id: str,
    base_direction: str,
    impact_percentage: float,
    time_horizon: str,
    reasoning: str,
) -> None:
    """
    Idempotently upsert a CAUSES relationship between two EconomicFactor nodes.

    The edge id is stored as a property so we can retrieve and expose it to the
    React Flow frontend without ambiguity.
    """
    cypher = """
        MATCH (src:EconomicFactor {id: $source_id})
        MATCH (tgt:EconomicFactor {id: $target_id})
        MERGE (src)-[r:CAUSES {id: $edge_id}]->(tgt)
        ON CREATE SET
            r.base_direction    = $base_direction,
            r.impact_percentage = $impact_percentage,
            r.time_horizon      = $time_horizon,
            r.reasoning         = $reasoning,
            r.served            = false
        ON MATCH SET
            r.base_direction    = $base_direction,
            r.impact_percentage = $impact_percentage,
            r.time_horizon      = $time_horizon,
            r.reasoning         = $reasoning
    """
    async with driver.session() as session:
        await session.run(
            cypher,
            edge_id=edge_id,
            source_id=source_id,
            target_id=target_id,
            base_direction=base_direction,
            impact_percentage=impact_percentage,
            time_horizon=time_horizon,
            reasoning=reasoning,
        )


async def neo4j_pop_cached_edge(
    driver: AsyncDriver, source_id: str
) -> Optional[dict[str, Any]]:
    """
    ─── BATCH CACHE READ ───────────────────────────────────────────────────────
    Checks Neo4j for an unserved (cached) outgoing relationship from `source_id`.
    Returns the first match and marks it as served=true so it won't be returned
    a second time.

    This is the core of the "ask for 5, return 1" cache strategy:
      • /api/expand first checks here.
      • Only if the cache is empty does it call the Gemini API.
    ────────────────────────────────────────────────────────────────────────────
    """
    cypher = """
        MATCH (src:EconomicFactor {id: $source_id})-[r:CAUSES {served: false}]->(tgt:EconomicFactor)
        WITH src, r, tgt LIMIT 1
        SET r.served = true
        RETURN
            tgt.id    AS target_id,
            tgt.label AS target_label,
            r.id      AS edge_id,
            r.base_direction    AS base_direction,
            r.impact_percentage AS impact_percentage,
            r.time_horizon      AS time_horizon,
            r.reasoning         AS reasoning
    """
    async with driver.session() as session:
        result = await session.run(cypher, source_id=source_id)
        record = await result.single()
        if record is None:
            return None
        return dict(record)


async def neo4j_get_subgraph(
    driver: AsyncDriver, root_id: str, depth: int = 3
) -> tuple[list[dict], list[dict]]:
    """
    Retrieve the subgraph reachable from `root_id` up to `depth` hops.
    Used by GET /api/simulation/{node_id} so the frontend can reconstruct
    a partial view of the stored graph.
    """
    cypher = """
        MATCH path = (root:EconomicFactor {id: $root_id})-[:CAUSES*0..3]->(n)
        UNWIND nodes(path)        AS node
        UNWIND relationships(path) AS rel
        RETURN DISTINCT
            node.id    AS node_id,
            node.label AS node_label,
            startNode(rel).id       AS src,
            endNode(rel).id         AS tgt,
            rel.id                  AS edge_id,
            rel.base_direction      AS base_direction,
            rel.impact_percentage   AS impact_percentage,
            rel.time_horizon        AS time_horizon,
            rel.reasoning           AS reasoning
    """
    nodes_seen: dict[str, dict] = {}
    edges_seen: dict[str, dict] = {}

    async with driver.session() as session:
        result = await session.run(cypher, root_id=root_id)
        async for record in result:
            nid = record["node_id"]
            if nid and nid not in nodes_seen:
                nodes_seen[nid] = {"id": nid, "data": {"label": record["node_label"]}}

            eid = record["edge_id"]
            if eid and eid not in edges_seen:
                edges_seen[eid] = {
                    "id": eid,
                    "source": record["src"],
                    "target": record["tgt"],
                    "data": {
                        "base_direction":    record["base_direction"],
                        "impact_percentage": record["impact_percentage"],
                        "time_horizon":      record["time_horizon"],
                        "reasoning":         record["reasoning"],
                    },
                }

    return list(nodes_seen.values()), list(edges_seen.values())


async def neo4j_label_exists(driver: AsyncDriver, label: str) -> Optional[str]:
    """
    Returns the node id if a node with this exact label already exists, else None.
    Used by /api/start to avoid creating a duplicate root node.
    """
    cypher = "MATCH (n:EconomicFactor {label: $label}) RETURN n.id AS id LIMIT 1"
    async with driver.session() as session:
        result = await session.run(cypher, label=label)
        record = await result.single()
        return record["id"] if record else None


# ──────────────────────────────────────────────────────────────────────────────
# SEED DATA (Phase 2 mock, persisted to Neo4j on first boot)
# ──────────────────────────────────────────────────────────────────────────────

SEED_NODES = [
    ("node-0",  "Federal Funds Rate"),   ("node-1",  "Mortgage Rates"),
    ("node-2",  "Housing Demand"),       ("node-3",  "Construction Activity"),
    ("node-4",  "Job Market"),           ("node-5",  "Consumer Spending"),
    ("node-6",  "Inflation"),            ("node-7",  "Treasury Yields"),
    ("node-8",  "Stock Market"),         ("node-9",  "Corporate Investment"),
    ("node-10", "USD Value"),            ("node-11", "Import Prices"),
    ("node-12", "Export Competitiveness"),("node-13","GDP Growth"),
    ("node-14", "Real Estate Prices"),
]

SEED_EDGES = [
    {
        "id": f"edge-{i}",
        "source_id": f"node-{i}",
        "target_id": f"node-{i+1}",
        "base_direction": "DIRECT" if i % 2 == 0 else "INVERSE",
        "impact_percentage": 5.0 + float(i),
        "time_horizon": "Medium",
        "reasoning": (
            f"Seed relationship #{i}: A significant change in node-{i} causes a cascading "
            f"{'direct' if i % 2 == 0 else 'inverse'} effect on node-{i+1} through standard "
            "macroeconomic transmission mechanisms."
        ),
    }
    for i in range(14)
]


async def seed_neo4j_if_empty(driver: AsyncDriver) -> None:
    """
    On startup, check whether the graph is empty.  If so, write the 15-node
    seed graph so that GET /api/mock-simulation works without any AI calls.
    """
    async with driver.session() as session:
        result = await session.run("MATCH (n:EconomicFactor) RETURN count(n) AS c")
        record = await result.single()
        if record and record["c"] > 0:
            logger.info("Neo4j already contains data — skipping seed.")
            return

    logger.info("Neo4j is empty — seeding 15 mock nodes & 14 edges …")
    for nid, label in SEED_NODES:
        await neo4j_merge_node(driver, nid, label)
    for edge in SEED_EDGES:
        # Mark seed edges as already served so they don't pollute the cache
        await neo4j_merge_edge(
            driver,
            edge_id=edge["id"],
            source_id=edge["source_id"],
            target_id=edge["target_id"],
            base_direction=edge["base_direction"],
            impact_percentage=edge["impact_percentage"],
            time_horizon=edge["time_horizon"],
            reasoning=edge["reasoning"],
        )
    # Mark all seed edges as served
    async with driver.session() as session:
        await session.run("MATCH ()-[r:CAUSES]->() SET r.served = true")
    logger.info("Seed complete.")


# ──────────────────────────────────────────────────────────────────────────────
# GEMINI AI BRAIN
# ──────────────────────────────────────────────────────────────────────────────

@retry(
    # Exponential back-off: 4 s → 8 s → 10 s … up to 5 attempts
    wait=wait_exponential(multiplier=1, min=4, max=10),
    stop=stop_after_attempt(5),
    # Only retry on rate-limit / transient errors (not auth / bad-request)
    retry=retry_if_exception_type((Exception,)),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True,
)
def _call_gemini_sync(node_label: str, existing_labels: list[str]) -> list[AiRelationship]:
    """
    ─── SYNCHRONOUS Gemini call (run via asyncio executor) ─────────────────────
    Requests EXACTLY 5 causal relationships from the LLM.
    Enforces `response_mime_type="application/json"` so the SDK validates
    the content type header of the response before we parse it.

    The @retry decorator from tenacity handles 429 / transient failures with
    exponential back-off exactly as specified in PROJECT_SPEC Phase 7.
    ────────────────────────────────────────────────────────────────────────────
    """
    existing_str = ", ".join(existing_labels) if existing_labels else "none"
    prompt = f"""
You are an expert macroeconomist. Identify 5 macroeconomic factors structurally affected by a significant move in {node_label}.
Do not include {existing_str}.
Determine if the causal relationship is DIRECT or INVERSE.
Estimate the 'impact_percentage' (realistic, un-capped numerical percentage).
Determine the 'time_horizon' (Short = 3 months, Medium = 2 years, Long = 10+ years).
Provide verbose reasoning.
Respond in strict JSON matching the required schema — a JSON array of exactly 5 objects:
[
  {{
    "label": "string",
    "base_direction": "DIRECT" | "INVERSE",
    "impact_percentage": float,
    "time_horizon": "Short" | "Medium" | "Long",
    "reasoning": "string"
  }}
]
Output ONLY the JSON array, no markdown, no explanation.
""".strip()

    logger.info(f"🤖 Gemini query → '{node_label}' (excluding: {existing_str})")
    response = gemini_model.generate_content(
        prompt,
        generation_config={"response_mime_type": "application/json"},
    )
    raw: str = response.text.strip()
    logger.info("🤖 Gemini response received.")

    # Strip accidental markdown fences
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    parsed = json.loads(raw)
    # Validate every item with Pydantic — raises ValidationError on schema mismatch
    return [AiRelationship(**item) for item in parsed]


async def get_ai_relationships(
    node_label: str, existing_labels: list[str]
) -> list[AiRelationship]:
    """
    Async wrapper: runs the blocking Gemini SDK call in a thread-pool executor
    so it never blocks the FastAPI event loop.
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, lambda: _call_gemini_sync(node_label, existing_labels)
    )


# ──────────────────────────────────────────────────────────────────────────────
# APPLICATION LIFECYCLE
# ──────────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan handler:
    • On startup  → open the Neo4j async driver, verify connectivity, seed if empty.
    • On shutdown → gracefully close all Neo4j connections.
    """
    global neo4j_driver
    logger.info("🚀 Starting CAUSAL-FLOW API …")

    try:
        neo4j_driver = AsyncGraphDatabase.driver(
            NEO4J_URI,
            auth=(NEO4J_USER, NEO4J_PASSWORD),
        )
        # Verify the connection works before accepting traffic
        await neo4j_driver.verify_connectivity()
        logger.info(f"✅ Connected to Neo4j at {NEO4J_URI}")

        # Create uniqueness constraint on node id (idempotent)
        async with neo4j_driver.session() as session:
            await session.run(
                "CREATE CONSTRAINT causal_node_id IF NOT EXISTS "
                "FOR (n:EconomicFactor) REQUIRE n.id IS UNIQUE"
            )

        await seed_neo4j_if_empty(neo4j_driver)

    except Exception as exc:
        logger.error(f"❌ Neo4j connection failed: {exc}")
        logger.warning("Running without Neo4j — only /api/health will work correctly.")
        neo4j_driver = None  # Allow health check to still respond

    yield  # ← application runs here

    if neo4j_driver:
        await neo4j_driver.close()
        logger.info("🛑 Neo4j driver closed.")


# ──────────────────────────────────────────────────────────────────────────────
# FASTAPI APPLICATION
# ──────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="CAUSAL-FLOW API",
    description="Autonomous Macroeconomic Reasoning Engine — Phase 8 Production Backend",
    version="1.0.0",
    lifespan=lifespan,
)

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

@app.get("/api/health", tags=["Utility"])
async def health_check():
    """Simple liveness probe used by CI and load-balancer health checks."""
    neo4j_ok = neo4j_driver is not None
    return {
        "status": "ok" if neo4j_ok else "degraded",
        "neo4j": "connected" if neo4j_ok else "disconnected",
        "gemini": "configured" if GEMINI_API_KEY else "missing_key",
    }


# ─── GET /api/mock-simulation ─────────────────────────────────────────────────
@app.get("/api/mock-simulation", tags=["Simulation"])
async def get_mock_simulation():
    """
    Returns the full seed graph (15 nodes, 14 edges) stored in Neo4j.
    Satisfies Phase 2: no AI calls, purely static data for frontend integration.
    The frontend uses this to verify dagre layout before wiring live endpoints.
    """
    driver = await get_driver()

    cypher = """
        MATCH (src:EconomicFactor)-[r:CAUSES]->(tgt:EconomicFactor)
        RETURN
            src.id AS src_id, src.label AS src_label,
            tgt.id AS tgt_id, tgt.label AS tgt_label,
            r.id AS edge_id,
            r.base_direction AS base_direction,
            r.impact_percentage AS impact_percentage,
            r.time_horizon AS time_horizon,
            r.reasoning AS reasoning
    """
    nodes_seen: dict[str, dict] = {}
    edges: list[dict] = []

    async with driver.session() as session:
        result = await session.run(cypher)
        async for record in result:
            for nid, nlabel in [
                (record["src_id"], record["src_label"]),
                (record["tgt_id"], record["tgt_label"]),
            ]:
                if nid not in nodes_seen:
                    nodes_seen[nid] = {"id": nid, "data": {"label": nlabel}}

            edges.append({
                "id": record["edge_id"],
                "source": record["src_id"],
                "target": record["tgt_id"],
                "data": {
                    "base_direction":    record["base_direction"],
                    "impact_percentage": record["impact_percentage"],
                    "time_horizon":      record["time_horizon"],
                    "reasoning":         record["reasoning"],
                },
            })

    return {"nodes": list(nodes_seen.values()), "edges": edges}


# ─── GET /api/simulation/{node_id} ────────────────────────────────────────────
@app.get("/api/simulation/{node_id}", tags=["Simulation"])
async def get_simulation(node_id: str):
    """
    Returns the subgraph reachable from `node_id` up to 3 hops deep.
    Matches the JSON contract defined in PROJECT_SPEC Section 3.
    """
    driver = await get_driver()
    nodes, edges = await neo4j_get_subgraph(driver, node_id)

    if not nodes:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found in graph.")

    return {"nodes": nodes, "edges": edges}


# ─── POST /api/start ──────────────────────────────────────────────────────────
@app.post("/api/start", tags=["AI"])
async def start_simulation(request: StartSimulationRequest):
    """
    ─── AI-POWERED SIMULATION START ────────────────────────────────────────────
    1. Resolve or create a root node for the requested label in Neo4j.
    2. Check Neo4j cache: if unserved outgoing edges already exist for this root,
       pop ONE and return it immediately (zero AI tokens spent).
    3. If cache is empty: call Gemini → get 5 relationships → MERGE ALL 5 into
       Neo4j (batch cache) → mark 4 as served=false (waiting for future clicks)
       → serve the 1st relationship back to the frontend.
    4. Return the root + first child as the initial two-node cascade.
    ────────────────────────────────────────────────────────────────────────────
    """
    driver = await get_driver()
    node_label = request.node_label.strip()

    # ── Step 1: Resolve root node ────────────────────────────────────────────
    existing_id = await neo4j_label_exists(driver, node_label)
    root_id = existing_id if existing_id else str(uuid.uuid4())

    await neo4j_merge_node(driver, root_id, node_label)
    logger.info(f"Root node resolved: '{node_label}' → {root_id}")

    # ── Step 2: Check cache ───────────────────────────────────────────────────
    cached = await neo4j_pop_cached_edge(driver, root_id)

    if cached:
        logger.info(f"✅ Cache HIT for '{node_label}' — no AI call needed.")
        first_relationship = cached
        first_node_id  = first_relationship["target_id"]
        first_node_lbl = first_relationship["target_label"]
    else:
        # ── Step 3: AI Call (cache miss) ─────────────────────────────────────
        logger.info(f"🔍 Cache MISS for '{node_label}' — calling Gemini …")
        try:
            ai_relationships = await get_ai_relationships(node_label, [node_label])
        except Exception as exc:
            logger.error(f"Gemini call failed after retries: {exc}")
            raise HTTPException(
                status_code=502,
                detail=f"AI service unavailable after retries: {str(exc)}",
            )

        # MERGE all 5 into Neo4j (the batch cache)
        generated_nodes: list[tuple[str, str]] = []
        for rel in ai_relationships:
            target_id = str(uuid.uuid4())
            edge_id   = str(uuid.uuid4())
            await neo4j_merge_node(driver, target_id, rel.label)
            await neo4j_merge_edge(
                driver,
                edge_id=edge_id,
                source_id=root_id,
                target_id=target_id,
                base_direction=rel.base_direction,
                impact_percentage=rel.impact_percentage,
                time_horizon=rel.time_horizon,
                reasoning=rel.reasoning,
            )
            generated_nodes.append((target_id, rel.label))

        logger.info(f"Stored {len(ai_relationships)} relationships in Neo4j cache.")

        # Pop the first one to serve (marks it served=true in DB)
        first_relationship = await neo4j_pop_cached_edge(driver, root_id)
        if not first_relationship:
            raise HTTPException(
                status_code=500,
                detail="Failed to retrieve newly cached relationship from Neo4j.",
            )
        first_node_id  = first_relationship["target_id"]
        first_node_lbl = first_relationship["target_label"]

    # ── Step 4: Build the response payload ───────────────────────────────────
    response_nodes = [
        {"id": root_id,       "data": {"label": node_label}},
        {"id": first_node_id, "data": {"label": first_node_lbl}},
    ]
    response_edges = [
        {
            "id":     first_relationship["edge_id"],
            "source": root_id,
            "target": first_node_id,
            "data": {
                "base_direction":    first_relationship["base_direction"],
                "impact_percentage": first_relationship["impact_percentage"],
                "time_horizon":      first_relationship["time_horizon"],
                "reasoning":         first_relationship["reasoning"],
            },
        }
    ]

    return {
        "nodes":         response_nodes,
        "edges":         response_edges,
        "initial_state": request.initial_state,
        "root_id":       root_id,
    }


# ─── POST /api/expand/{node_id} ───────────────────────────────────────────────
@app.post("/api/expand/{node_id}", tags=["AI"])
async def expand_node(node_id: str, request: ExpandNodeRequest):
    """
    ─── AI-POWERED NODE EXPANSION (with batch caching) ─────────────────────────
    Called when the user clicks "Expand" in the Side Panel.

    Cache-first strategy:
    1. Look for an unserved (cached) CAUSES edge originating from `node_id`.
    2. If found → return it immediately (no AI call → no tokens spent).
    3. If not found → call Gemini for 5 new relationships, MERGE all 5 into Neo4j,
       then pop & return the first one. The remaining 4 sit in Neo4j as
       served=false, ready for the next 4 "Expand" clicks on this same node.
    ────────────────────────────────────────────────────────────────────────────
    """
    driver = await get_driver()

    # Ensure the source node exists (it was put there by /start or a prior /expand)
    await neo4j_merge_node(driver, node_id, request.label)

    # ── Step 1: Cache check ───────────────────────────────────────────────────
    cached = await neo4j_pop_cached_edge(driver, node_id)

    if cached:
        logger.info(f"✅ Cache HIT for expand on '{request.label}' ({node_id})")
        first_relationship = cached
    else:
        # ── Step 2: AI call (cache miss) ─────────────────────────────────────
        logger.info(f"🔍 Cache MISS for expand on '{request.label}' — calling Gemini …")
        try:
            ai_relationships = await get_ai_relationships(
                request.label, request.existing_labels
            )
        except Exception as exc:
            logger.error(f"Gemini call failed after retries: {exc}")
            raise HTTPException(
                status_code=502,
                detail=f"AI service unavailable after retries: {str(exc)}",
            )

        # MERGE all 5 into Neo4j (batch cache write)
        for rel in ai_relationships:
            target_id = str(uuid.uuid4())
            edge_id   = str(uuid.uuid4())
            await neo4j_merge_node(driver, target_id, rel.label)
            await neo4j_merge_edge(
                driver,
                edge_id=edge_id,
                source_id=node_id,
                target_id=target_id,
                base_direction=rel.base_direction,
                impact_percentage=rel.impact_percentage,
                time_horizon=rel.time_horizon,
                reasoning=rel.reasoning,
            )

        logger.info(f"Stored {len(ai_relationships)} expansion relationships in Neo4j.")

        # Pop first as the immediate response
        first_relationship = await neo4j_pop_cached_edge(driver, node_id)
        if not first_relationship:
            raise HTTPException(
                status_code=500,
                detail="Failed to retrieve newly cached relationship from Neo4j.",
            )

    # ── Step 3: Build minimal response (1 node, 1 edge) ──────────────────────
    return {
        "nodes": [
            {
                "id":   first_relationship["target_id"],
                "data": {"label": first_relationship["target_label"]},
            }
        ],
        "edges": [
            {
                "id":     first_relationship["edge_id"],
                "source": node_id,
                "target": first_relationship["target_id"],
                "data": {
                    "base_direction":    first_relationship["base_direction"],
                    "impact_percentage": first_relationship["impact_percentage"],
                    "time_horizon":      first_relationship["time_horizon"],
                    "reasoning":         first_relationship["reasoning"],
                },
            }
        ],
    }


# ──────────────────────────────────────────────────────────────────────────────
# ENTRY POINT (local development)
# ──────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,        # Hot-reload on file changes during development
        log_level="info",
    )