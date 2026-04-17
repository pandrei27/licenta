import { useState } from "react";
import VisualGraph from "./components/VisualGraph";

function App() {
  // Use React state instead of document.getElementById for stability
  const [nodeLabel, setNodeLabel] = useState("");
  const [initialState, setInitialState] = useState("INCREASING");

  const startSimulation = () => {
    if (!nodeLabel.trim()) return;

    // Dispatch event for VisualGraph to pick up
    window.dispatchEvent(
      new CustomEvent("start-sim", {
        detail: {
          node_label: nodeLabel,
          initial_state: initialState,
        },
      })
    );
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-white font-sans overflow-hidden">
      {/* Navigation Bar - Fixed Issue 1 & 2 */}
      <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 shadow-sm z-10 relative">
        <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">
          CAUSAL-FLOW
        </h1>

        <div className="flex items-center space-x-3">
          <input
            type="text"
            value={nodeLabel}
            onChange={(e) => setNodeLabel(e.target.value)}
            placeholder="Root Node (e.g. S&P 500)"
            className="border border-gray-300 rounded-md px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none w-64 shadow-sm transition-all"
          />

          <select
            value={initialState}
            onChange={(e) => setInitialState(e.target.value)}
            className="border border-gray-300 rounded-md px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-sm cursor-pointer transition-all"
          >
            <option value="INCREASING">INCREASING</option>
            <option value="DECREASING">DECREASING</option>
          </select>

          <button
            onClick={startSimulation}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-5 rounded-md transition-colors shadow-sm"
          >
            Start Simulation
          </button>
        </div>
      </header>

      {/* Main Canvas Area */}
      <main className="w-full h-[calc(100vh-73px)] bg-slate-50 relative overflow-hidden">
        <VisualGraph />
      </main>
    </div>
  );
}

export default App;