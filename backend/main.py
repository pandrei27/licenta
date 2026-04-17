from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import sqlite3
import networkx as nx
import json
import os
import uuid
import google.generativeai as genai
from tenacity import retry, wait_exponential, stop_after_attempt
import logging
import asyncio

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("CAUSAL-FLOW")

app = FastAPI(title="CAUSAL-FLOW API")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load API key from environment variable
api_key = os.environ.get("GEMINI_API_KEY")

# Fallback for local dev if environment variable isn't picking up
# Replace this with your actual key if you still have issues,
# but keep it out of the public repo!
logger.info(api_key)
if not api_key:
    logger.info(f"No API key here")
    # Set this locally if you must, but don't commit it to git
    # api_key = "" ## HUMAN NOTE: it only works if i hardcode it

genai.configure(api_key=api_key)
# Using gemini-1.5-flash-8b as it is the most lightweight 'Flash Lite' model available
# in the current API for 1.5 series.
model = genai.GenerativeModel("gemini-3.1-flash-lite-preview")

# Use run_in_executor to avoid blocking the FastAPI event loop
async def run_ai_task(func, *args):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: func(*args))

def init_db():
    conn = sqlite3.connect("causal_flow.db")
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            label TEXT
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS edges (
            id TEXT PRIMARY KEY,
            source_id TEXT,
            target_id TEXT,
            base_direction TEXT,
            impact_percentage REAL,
            time_horizon TEXT,
            reasoning TEXT
        )
    """)
    # Seed data if empty
    cursor.execute("SELECT count(*) FROM nodes")
    if cursor.fetchone()[0] == 0:
        nodes = [
            ("node-0", "Federal Funds Rate"), ("node-1", "Mortgage Rates"), 
            ("node-2", "Housing Demand"), ("node-3", "Construction Activity"),
            ("node-4", "Job Market"), ("node-5", "Consumer Spending"), 
            ("node-6", "Inflation"), ("node-7", "Treasury Yields"), 
            ("node-8", "Stock Market"), ("node-9", "Corporate Investment"), 
            ("node-10", "USD Value"), ("node-11", "Import Prices"), 
            ("node-12", "Export Competitiveness"), ("node-13", "GDP Growth"), 
            ("node-14", "Real Estate Prices")
        ]
        cursor.executemany("INSERT INTO nodes VALUES (?, ?)", nodes)
        edges = [
            (f"edge-{i}", f"node-{i}", f"node-{i+1}", "DIRECT" if i % 2 == 0 else "INVERSE", 
             5.0 + float(i), "Medium", f"Economic chain reaction step {i}")
            for i in range(14)
        ]
        cursor.executemany("INSERT INTO edges VALUES (?, ?, ?, ?, ?, ?, ?)", edges)
        conn.commit()
    conn.close()

# Initialize Database and Graph
init_db()
graph = nx.DiGraph()

def load_graph():
    conn = sqlite3.connect("causal_flow.db")
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM nodes")
    for row in cursor.fetchall():
        graph.add_node(row[0], label=row[1])
    cursor.execute("SELECT * FROM edges")
    for row in cursor.fetchall():
        graph.add_edge(row[1], row[2], id=row[0], base_direction=row[3], 
                       impact_percentage=row[4], time_horizon=row[5], reasoning=row[6])
    conn.close()

load_graph()

@retry(wait=wait_exponential(multiplier=1, min=4, max=10), stop=stop_after_attempt(2))
def get_ai_factors(node_label, existing_labels=[]):
    logger.info(api_key)
    logger.info(f"AI Brain querying for: {node_label}")
    prompt = f"""
    You are an expert macroeconomist. Identify 5 macroeconomic factors structurally affected by a significant move in {node_label}.
    Do not include {', '.join(existing_labels)}.
    Determine if the causal relationship is DIRECT or INVERSE.
    Estimate the 'impact_percentage' (realistic, un-capped numerical percentage).
    Determine the 'time_horizon' (Short = 3 months, Medium = 2 years, Long = 10+ years).
    Provide verbose reasoning.
    Respond in strict JSON matching the required schema:
    [
        {{
            "label": "string",
            "base_direction": "DIRECT" | "INVERSE",
            "impact_percentage": float,
            "time_horizon": "Short" | "Medium" | "Long",
            "reasoning": "string"
        }}
    ]
    """
    response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
    logger.info("AI Brain response received.")
    return json.loads(response.text)

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}

@app.get("/api/mock-simulation")
async def get_simulation():
    # Convert NetworkX to the JSON format React Flow expects
    nodes = [{"id": n, "label": d["label"]} for n, d in graph.nodes(data=True)]
    edges = []
    for u, v, d in graph.edges(data=True):
        edges.append({
            "id": d["id"],
            "source": u,
            "target": v,
            "data": {
                "base_direction": d["base_direction"],
                "impact_percentage": d["impact_percentage"],
                "time_horizon": d["time_horizon"],
                "reasoning": d["reasoning"]
            }
        })
    return {"nodes": nodes, "edges": edges}

@app.post("/api/start")
async def start_simulation(payload: dict):
    node_label = payload.get("node_label")
    initial_state = payload.get("initial_state", "INCREASING")

    # Run blocking AI call in executor
    ai_data = await run_ai_task(get_ai_factors, node_label)

    root_id = str(uuid.uuid4())
    nodes = [{"id": root_id, "label": node_label}]
    edges = []

    for item in ai_data:
        target_id = str(uuid.uuid4())
        nodes.append({"id": target_id, "label": item["label"]})
        edges.append({
            "id": str(uuid.uuid4()), "source": root_id, "target": target_id,
            "data": {
                "base_direction": item["base_direction"],
                "impact_percentage": item["impact_percentage"],
                "time_horizon": item["time_horizon"],
                "reasoning": item["reasoning"]
            }
        })
    return {"nodes": nodes, "edges": edges, "initial_state": initial_state}

@app.post("/api/expand/{node_id}")
async def expand_node(node_id: str, payload: dict):
    node_label = payload.get("label")
    existing_labels = payload.get("existing_labels", [])

    # Run blocking AI call in executor
    ai_data = await run_ai_task(get_ai_factors, node_label, existing_labels)

    # Batch Cache strategy: Take first, save others to DB (skipped here for brevity)
    new_node = ai_data[0]
    target_id = str(uuid.uuid4())

    return {
        "nodes": [{"id": target_id, "label": new_node["label"]}],
        "edges": [{
            "id": str(uuid.uuid4()), "source": node_id, "target": target_id,
            "data": {
                "base_direction": new_node["base_direction"],
                "impact_percentage": new_node["impact_percentage"],
                "time_horizon": new_node["time_horizon"],
                "reasoning": new_node["reasoning"]
            }
        }]
    }

