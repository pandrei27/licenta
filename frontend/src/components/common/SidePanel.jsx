const SidePanel = ({ nodeData, onClose, onExpand }) => {
  if (!nodeData) return null;

  // Helper functions for the Ticker colors and arrows
  const getArrow = (state) => state === 'INCREASING' ? '▲' : '▼';
  const getBoxColor = (state) => state === 'INCREASING' ? 'bg-green-50 border-green-300 text-green-700' : 'bg-red-50 border-red-300 text-red-700';
  const getTextColor = (state) => state === 'INCREASING' ? 'text-green-600' : 'text-red-600';

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
      
      {nodeData.edgeData ? (
        <div className="space-y-5 flex-grow mt-2">
          
          {/* The Visual Context Ticker */}
          {nodeData.sourceLabel && (
            <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200 shadow-sm">
              <div className={`flex flex-col items-center justify-center w-5/12 px-2 py-2 border rounded shadow-sm text-center ${getBoxColor(nodeData.sourceState)}`}>
                <span className="text-xs font-bold truncate w-full" title={nodeData.sourceLabel}>{nodeData.sourceLabel}</span>
                <span className="text-sm">{getArrow(nodeData.sourceState)}</span>
              </div>
              
              <div className="w-2/12 flex justify-center">
                <span className="text-slate-400 font-black text-xl">→</span>
              </div>

              <div className={`flex flex-col items-center justify-center w-5/12 px-2 py-2 border rounded shadow-sm text-center ${getBoxColor(nodeData.state)}`}>
                <span className="text-xs font-bold truncate w-full" title={nodeData.label}>{nodeData.label}</span>
                <span className="text-sm">{getArrow(nodeData.state)}</span>
              </div>
            </div>
          )}

          {/* NEW: The Structured Reasoning Section */}
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Reasoning</h3>
            
            {Array.isArray(nodeData.edgeData.reasoning) ? (
              <ul className="list-none space-y-3">
                {nodeData.edgeData.reasoning.map((step, index) => {
                  // Bold the prefixes ("Trigger:", "Flow:", "Effect:") for extra readability
                  const [prefix, ...rest] = step.split(':');
                  return (
                    <li key={index} className="text-sm text-gray-700 leading-relaxed bg-slate-50 p-3 rounded border border-slate-100">
                      {rest.length > 0 ? (
                        <>
                          <strong className="text-gray-900">{prefix}:</strong> {rest.join(':')}
                        </>
                      ) : (
                        step
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line space-y-2">
                {nodeData.edgeData.reasoning}
              </p>
            )}
          </div>
          
          <div className="flex justify-between border-t border-b border-gray-100 py-3 mt-4">
            <div>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Impact</h3>
              <p className={`text-xl font-black ${getTextColor(nodeData.state)}`}>
                {nodeData.edgeData.impact_percentage}%
              </p>
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

      {/* Expand Button */}
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