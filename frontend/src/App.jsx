import VisualGraph from "./components/VisualGraph";

function App() {
  return (
    <div className="flex flex-col h-screen w-screen bg-gray-900 text-white">
      {/* Navigation Bar */}
      <nav className="h-16 flex items-center px-6 border-b border-gray-700 bg-gray-800 shrink-0">
        <h1 className="text-xl font-bold mr-8 tracking-tight">CAUSAL-FLOW</h1>
        
        <div className="flex items-center gap-4">
          <input 
            type="text" 
            placeholder="What happens if [Node] goes..." 
            className="px-4 py-2 rounded bg-gray-900 border border-gray-600 focus:outline-none focus:border-blue-500 w-80 text-white"
          />
          
          <select className="px-4 py-2 rounded bg-gray-900 border border-gray-600 focus:outline-none focus:border-blue-500">
            <option value="INCREASING">INCREASING</option>
            <option value="DECREASING">DECREASING</option>
          </select>
          
          <button className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded font-semibold transition-colors">
            Start Simulation
          </button>
        </div>
      </nav>

      {/* Main Canvas Area */}
      <main className="flex-grow w-full relative h-[calc(100vh-64px)] overflow-hidden">
        <VisualGraph />
      </main>
    </div>
  );
}

export default App;

