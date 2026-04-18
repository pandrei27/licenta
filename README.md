# CAUSAL-FLOW
Autonomous Macroeconomic Reasoning Engine & Market Dynamics Analyzer.

## Overview
Causal-Flow is a specialized tool for visualizing macroeconomic causal relationships. It combines a React-based interactive canvas with a Python-powered analytical backend to model how changes in one economic asset or factor propagate through a system.

## Key Features
- **Interactive DAG Visualization:** Uses React Flow and Dagre for automated hierarchical graph layout.
- **Economic Reasoning Engine:** Powered by LLM-driven analysis to identify direct and inverse macroeconomic causal relationships.
- **State-Aware Simulation:** Dynamically calculates and renders the propagation of "Increasing" or "Decreasing" market states.
- **Fast Development Architecture:** Built on FastAPI, SQLite, and NetworkX for rapid, local-first performance.

## Tech Stack
- **Frontend:** React 18, Vite, React Flow, TailwindCSS, Dagre.
- **Backend:** Python 3.11+, FastAPI, Uvicorn, SQLAlchemy/SQLite, NetworkX.
- **AI Integration:** Google Gemini API (with rate-limit handling via Tenacity).

## Development Phases
1. Zero-API Scaffolding
2. v0 Static Mock Engine
3. State Calculation & Auto-Layout
4. Interaction Layer
5. Local Database Integration (NetworkX/SQLite)
6. Simulation Initialization UI
7. Resilient AI Brain (Gemini)
