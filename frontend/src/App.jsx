import { useState } from "react";
import VisualGraph from "./components/VisualGraph";

function App() {
  const [nodeLabel, setNodeLabel] = useState("");
  const [initialState, setInitialState] = useState("INCREASING");
  const [isSimulated, setIsSimulated] = useState(false);

  const startSimulation = () => {
    if (!nodeLabel.trim()) return;
    setIsSimulated(true);

    // Use setTimeout to ensure the component has mounted before dispatching
    setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent("start-sim", {
        detail: {
          node_label: nodeLabel,
          initial_state: initialState,
        },
      })
    );
    }, 100);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-white font-sans overflow-hidden">
      {/* Navigation Bar - Fixed Issue 1 & 2 */}
      {!isSimulated ? (
        <div className="flex flex-col items-center justify-center h-full animate-fade-in animate-zoom-in">
          <h1 className="text-5xl font-extrabold text-gray-900 mb-8 tracking-tighter">
          CAUSAL-FLOW
        </h1>
          <div className="flex items-center space-x-3 w-full max-w-lg">
          <input
            type="text"
            value={nodeLabel}
            onChange={(e) => setNodeLabel(e.target.value)}
              placeholder="Enter economic indicator..."
              className="flex-grow border border-gray-300 rounded-xl px-5 py-3 text-lg focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-lg transition-all"
          />
          <select
            value={initialState}
            onChange={(e) => setInitialState(e.target.value)}
              className="border border-gray-300 rounded-xl px-4 py-3 text-lg focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-lg cursor-pointer transition-all bg-white"
          >
              <option value="INCREASING">Increasing</option>
              <option value="DECREASING">Decreasing</option>
          </select>
          <button
            onClick={startSimulation}
              className="bg-gray-900 hover:bg-black text-white font-semibold py-3 px-6 rounded-xl transition-all shadow-lg active:scale-95"
          >
              Run
          </button>
        </div>
        </div>
      ) : (
        <>
          <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 shadow-sm z-10 relative">
            <h1 className="text-xl font-bold tracking-tight text-gray-900">
              CAUSAL-FLOW
            </h1>
            <div className="flex items-center space-x-3">
              <input
                type="text"
                value={nodeLabel}
                onChange={(e) => setNodeLabel(e.target.value)}
                placeholder="Root Node (e.g. S&P 500)"
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none w-48 transition-all"
              />
              <select
                value={initialState}
                onChange={(e) => setInitialState(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer transition-all"
              >
                <option value="INCREASING">Increasing</option>
                <option value="DECREASING">Decreasing</option>
              </select>
              <button
                onClick={startSimulation}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-1.5 px-4 rounded-md transition-colors"
              >
                Run
              </button>
    </div>
          </header>
          <main className="w-full h-[calc(100vh-65px)] bg-slate-50 relative overflow-hidden">
            <VisualGraph />
          </main>
        </>
      )}
    </div>
  );
}

export default App;