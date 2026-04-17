const SidePanel = ({ nodeData, onClose, onExpand }) => {
  if (!nodeData) return null;

  return (
    <div className="fixed top-0 right-0 h-full w-96 bg-white shadow-2xl border-l border-gray-200 z-50 overflow-y-auto p-6 flex flex-col transform transition-transform duration-300">
      
      {/* Close Button */}
      <button 
        onClick={onClose} 
        className="self-end text-gray-400 hover:text-gray-800 mb-2 transition-colors text-sm font-medium"
      >
        ✕ Close
      </button>

      {/* Title */}
      <h2 className="text-xl font-extrabold text-gray-900 mb-4 border-b border-gray-100 pb-3">
        {nodeData.label}
      </h2>
      
      {/* Dynamic Content: Only show reasoning if it's a child node with an incoming edge */}
      {nodeData.edgeData ? (
        <div className="space-y-5 flex-grow mt-2">
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Reasoning</h3>
            <p className="text-sm text-gray-700 leading-relaxed">{nodeData.edgeData.reasoning}</p>
          </div>
          
          <div className="flex justify-between border-t border-b border-gray-100 py-3">
            <div>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Impact</h3>
              <p className="text-lg font-bold text-blue-600">{nodeData.edgeData.impact_percentage}%</p>
            </div>
            <div className="text-right">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Time Horizon</h3>
              <p className="text-sm font-semibold text-gray-700">{nodeData.edgeData.time_horizon}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-grow mt-4">
          <div className="bg-blue-50 border border-blue-100 rounded-md p-4">
            <p className="text-sm text-blue-800 leading-relaxed">
              This is the <strong>Root Node</strong> of your simulation. It represents the initial market condition you defined.
            </p>
          </div>
        </div>
      )}

      {/* Expand Button - Now always visible at the bottom so you can expand the root! */}
      <button 
        onClick={onExpand}
        className="w-full mt-6 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-5 rounded-md transition-colors shadow-md flex items-center justify-center space-x-2"
      >
        <span>Expand Node</span>
        <span>→</span>
      </button>
    </div>
  );
};

export default SidePanel;