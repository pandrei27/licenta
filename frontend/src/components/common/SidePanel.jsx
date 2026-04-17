const SidePanel = ({ nodeData, onClose, onExpand }) => {
  if (!nodeData) return null;

  return (
    <div className="h-full w-80 bg-gray-900 border-l border-gray-700 p-6 shadow-2xl flex flex-col z-[1000] overflow-y-auto">
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
            onClick={onExpand}
            className="w-full mt-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
        >
            Expand Node
          </button>
        </div>
      )}
    </div>
  );
};

export default SidePanel;
