from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Allow CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "Server is running"}

@app.get("/api/simulation/{node_id}")
async def get_simulation(node_id: str):
    return {
        "nodes": [
            { "id": "uuid-1", "data": { "label": "Gold" }, "position": { "x": 250, "y": 50 } },
            { "id": "uuid-2", "data": { "label": "USD Strength" }, "position": { "x": 100, "y": 200 } },
            { "id": "uuid-3", "data": { "label": "Inflation" }, "position": { "x": 400, "y": 200 } }
        ],
        "edges": [
            { 
                "id": "edge-1", 
                "source": "uuid-1", 
                "target": "uuid-2", 
                "data": { "base_direction": "INVERSE", "impact_magnitude": 8, "reasoning": "Higher gold value reflects weaker USD." } 
            },
            { 
                "id": "edge-2", 
                "source": "uuid-1", 
                "target": "uuid-3", 
                "data": { "base_direction": "DIRECT", "impact_magnitude": 5, "reasoning": "Gold often rises with inflationary expectations." } 
            }
        ]
    }
