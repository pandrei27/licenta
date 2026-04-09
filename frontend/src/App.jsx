import React, { useEffect, useState } from 'react';
import ReactFlow, { 
  Background, 
  Controls, 
  MiniMap, 
  useNodesState, 
  useEdgesState,
  MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios';

// Logic for calculating state (as per Section 5)
const calculateState = (nodes, edges, rootNodeId, rootState) => {
  const nodeStates = { [rootNodeId]: rootState };
  const visited = new Set(); // Rule 3: Registry to prevent infinite feedback loops
  
  const getTargetState = (sourceState, edgeType) => {
    if (edgeType === 'DIRECT') return sourceState;
    return sourceState === 'INCREASING' ? 'DECREASING' : 'INCREASING';
  };

  const processEdges = (sourceId) => {
    if (visited.has(sourceId)) return; // Terminate if already visited
    visited.add(sourceId);

    edges.forEach(edge => {
      if (edge.source === sourceId) {
        const sourceState = nodeStates[sourceId];
        const targetState = getTargetState(sourceState, edge.data.base_direction);
        nodeStates[edge.target] = targetState;
        
        // Recursive call
        processEdges(edge.target);
      }
    });
  };

  processEdges(rootNodeId);
  return nodeStates;
};

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get('http://127.0.0.1:8000/api/simulation/uuid-1');
        const { nodes: apiNodes, edges: apiEdges } = response.data;

        const rootId = 'uuid-1';
        const rootState = 'INCREASING';
        const states = calculateState(apiNodes, apiEdges, rootId, rootState);

        const styledNodes = apiNodes.map(node => ({
          ...node,
          style: { 
            background: states[node.id] === 'INCREASING' ? '#22c55e' : (states[node.id] === 'DECREASING' ? '#ef4444' : '#6b7280'),
            color: '#fff',
            padding: 10,
            borderRadius: 5,
            width: 150
          },
          data: { label: node.data.label }
        }));

        const styledEdges = apiEdges.map(edge => {
          const edgeColor = states[edge.source] === 'INCREASING' ? 
            (edge.data.base_direction === 'DIRECT' ? '#22c55e' : '#ef4444') :
            (edge.data.base_direction === 'DIRECT' ? '#ef4444' : '#22c55e');
          
          const percentage = edge.data.impact_percentage || 1;
          const strokeWidth = Math.min(10, Math.max(1, Math.log10(percentage + 1) * 3));
            
          return {
            ...edge,
            markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
            style: { strokeWidth, stroke: edgeColor }
          };
        });

        setNodes(styledNodes);
        setEdges(styledEdges);
      } catch (error) {
        console.error("Error fetching simulation data:", error);
      }
    };
    fetchData();
  }, [setNodes, setEdges]);

  const onNodeClick = (event, node) => {
    const edge = edges.find(e => e.target === node.id);
    setSelectedNode({ ...node, edgeData: edge?.data });
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950">
      {/* Full-Screen Canvas (z-0) */}
      <div className="absolute inset-0 w-full h-full z-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.5 }}
        >
          <Background color="#334155" />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>

      {/* Floating Sidebar (z-10) */}
      {selectedNode && (
        <div className="absolute right-0 top-0 h-full w-96 z-10 bg-slate-900/90 backdrop-blur-md border-l border-slate-800 shadow-2xl p-8 flex flex-col gap-6 text-slate-100">
          <h2 className="text-2xl font-bold text-white border-b border-slate-700 pb-4">{selectedNode.data.label}</h2>
          {selectedNode.edgeData ? (
            <div className="flex flex-col gap-4">
              <p><strong className="text-white block mb-1">Reasoning:</strong> <span className="text-slate-300">{selectedNode.edgeData.reasoning}</span></p>
              <p><strong className="text-white">Impact:</strong> <span className="text-slate-300">{selectedNode.edgeData.impact_percentage}%</span></p>
              <p><strong className="text-white">Time Horizon:</strong> <span className="text-slate-300">{selectedNode.edgeData.time_horizon}</span></p>
              <button className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-md transition-colors font-medium">
                Expand (Coming Soon)
              </button>
            </div>
          ) : (
            <p className="text-slate-400">Root node (no causal impact data).</p>
          )}
          <button 
            onClick={() => setSelectedNode(null)} 
            className="mt-auto border border-slate-600 hover:bg-slate-800 text-slate-300 py-2 rounded-md transition-colors"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
