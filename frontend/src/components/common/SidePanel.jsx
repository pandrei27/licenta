const SidePanel = ({ nodeData, onClose }) => {
  if (!nodeData) return null;

  return (
    <div className="absolute top-0 right-0 h-full w-80 bg-gray-800 border-l border-gray-700 p-6 shadow-xl z-10">
      <button onClick={onClose} className="text-gray-400 hover:text-white mb-4">✕ Close</button>
      <h2 className="text-xl font-bold text-white mb-4">{nodeData.label}</h2>
      
      {nodeData.edgeData && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-400">Reasoning</h3>
            <p className="text-gray-200 text-sm mt-1">{nodeData.edgeData.reasoning}</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-400">Impact</h3>
            <p className="text-gray-200 text-sm mt-1">{nodeData.edgeData.impact_percentage}%</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-400">Time Horizon</h3>
            <p className="text-gray-200 text-sm mt-1">{nodeData.edgeData.time_horizon}</p>
          </div>
          
          <button 
            disabled
            className="w-full mt-6 py-2 bg-gray-600 text-gray-400 rounded cursor-not-allowed text-sm"
          >
            Expand (Phase 7)
          </button>
        </div>
      )}
    </div>
  );
};

export default SidePanel;
