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
    <div className="flex flex-col h-screen w-screen bg-white font-sans overflow-hidden relative">
      {/* Injecting custom keyframes for the comic book pop-in effect */}
      <style>
        {`
          @keyframes comicPop {
            0% { opacity: 0; transform: scale(0.8) translateY(20px); }
            60% { opacity: 1; transform: scale(1.05) translateY(-5px); }
            100% { opacity: 1; transform: scale(1) translateY(0); }
          }
        `}
      </style>

      {!isSimulated ? (
        <div className="flex flex-col items-center justify-center h-full relative overflow-hidden">
          {/* CERN-like decorative rings */}
          <div className="absolute w-[600px] h-[600px] border-2 border-blue-100 rounded-full animate-[spin_20s_linear_infinite] opacity-50 -z-10" />
          <div className="absolute w-[500px] h-[500px] border-2 border-blue-50 rounded-full animate-[spin_25s_linear_infinite_reverse] opacity-30 -z-10" />
          
          <div className="flex flex-col items-center">
            <h1 className="text-5xl font-extrabold text-gray-900 mb-8 tracking-tighter text-center animate-fade-in-up">
              CAUSAL-FLOW
            </h1>
            
            <div className="relative w-full max-w-2xl flex justify-center">
              
              {/* Main Input Bar - NOW ACTING AS THE ANCHOR FOR INDICATORS */}
              <div className="flex items-center space-x-3 w-full max-w-lg bg-white/80 backdrop-blur-sm p-2 rounded-2xl shadow-xl border border-gray-100 animate-fade-in-up delay-300 relative z-20">
                <input
                  type="text"
                  value={nodeLabel}
                  onChange={(e) => setNodeLabel(e.target.value)}
                  placeholder="Enter economic indicator..."
                  className="flex-grow border-none bg-transparent px-5 py-3 text-lg focus:outline-none placeholder:text-gray-400"
                />
                <select
                  value={initialState}
                  onChange={(e) => setInitialState(e.target.value)}
                  className="border-l border-gray-200 bg-transparent px-4 py-3 text-lg focus:outline-none cursor-pointer text-gray-600"
                >
                  <option value="INCREASING">Increasing</option>
                  <option value="DECREASING">Decreasing</option>
                </select>
                <button
                  onClick={startSimulation}
                  className="bg-gray-900 hover:bg-black text-white font-semibold py-3 px-6 rounded-xl transition-all active:scale-95"
                >
                  Run
                </button>

                {/* --- COMIC BOOK INDICATORS --- */}
                
                {/* 1. Input Indicator */}
                <div 
                  className="absolute top-full mt-5 left-0 w-48 bg-yellow-200 border-2 border-black rounded-lg p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] opacity-0 pointer-events-none z-10"
                  style={{ animation: 'comicPop 0.5s ease-out forwards', animationDelay: '1.2s' }}
                >
                  <div className="absolute -top-[9px] left-10 w-4 h-4 bg-yellow-200 border-l-2 border-t-2 border-black rotate-45" />
                  <p className="text-[11px] font-bold text-black leading-tight text-center">
                    Type an economic asset/indicator (like GOLD or S&P500) to set the root cause!
                  </p>
                </div>

                {/* 2. Dropdown Indicator */}
                <div 
                  className="absolute top-full mt-5 right-[120px] w-36 bg-green-200 border-2 border-black rounded-lg p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] opacity-0 pointer-events-none z-10"
                  style={{ animation: 'comicPop 0.5s ease-out forwards', animationDelay: '1.6s' }}
                >
                  <div className="absolute -top-[9px] left-1/2 -translate-x-1/2 w-4 h-4 bg-green-200 border-l-2 border-t-2 border-black rotate-45" />
                  <p className="text-[11px] font-bold text-black leading-tight text-center">
                    Is it going UP or DOWN? This sets the initial trend.
                  </p>
                </div>

                {/* 3. Run Button Indicator */}
                <div 
                  className="absolute top-full mt-5 right-0 w-28 bg-pink-200 border-2 border-black rounded-lg p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] opacity-0 pointer-events-none z-10"
                  style={{ animation: 'comicPop 0.5s ease-out forwards', animationDelay: '2.0s' }}
                >
                  <div className="absolute -top-[9px] left-1/2 -translate-x-1/2 w-4 h-4 bg-pink-200 border-l-2 border-t-2 border-black rotate-45" />
                  <p className="text-[11px] font-bold text-black leading-tight text-center">
                    Smash RUN to simulate!
                  </p>
                </div>

              </div>
            </div>
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