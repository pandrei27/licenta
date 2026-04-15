from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import sqlite3
import networkx as nx
import json

app = FastAPI(title="CAUSAL-FLOW API")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    node_label = payload.get("node_label", "Root Node")
    initial_state = payload.get("initial_state", "INCREASING")

    # Return the mock cascade, but set the root node label to the user's input
    nodes = [
        {"id": f"node-{i}", "label": (node_label if i == 0 else f"Factor {i}")}
        for i in range(15)
    ]

    edges = [
        {"id": f"edge-{i}", "source": f"node-{i}", "target": f"node-{i+1}", "data": {
            "base_direction": "DIRECT" if i % 2 == 0 else "INVERSE",
            "impact_percentage": 5.0 + float(i),
            "time_horizon": "Medium",
            "reasoning": f"Economic chain reaction step {i}"
        }} for i in range(14)
    ]

    return {"nodes": nodes, "edges": edges, "initial_state": initial_state}

