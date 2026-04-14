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
import dagre from 'dagre';

// --- Dagre Layout Utility ---
const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const getLayoutedElements = (nodes, edges) => {
  dagreGraph.setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 200 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 150, height: 50 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: { x: nodeWithPosition.x - 75, y: nodeWithPosition.y - 25 },
    };
  });

  return { nodes: layoutedNodes, edges };
};

// --- State Calculation Logic ---
const calculateState = (nodes, edges, rootNodeId, rootState) => {
  const nodeStates = { [rootNodeId]: rootState };
  const visited = new Set();
  
  const getTargetState = (sourceState, edgeType) => {
    if (edgeType === 'DIRECT') return sourceState;
    return sourceState === 'INCREASING' ? 'DECREASING' : 'INCREASING';
  };

  const processEdges = (sourceId) => {
    if (visited.has(sourceId)) return;
    visited.add(sourceId);

    edges.forEach(edge => {
      if (edge.source === sourceId) {
        const sourceState = nodeStates[sourceId];
        const targetState = getTargetState(sourceState, edge.data.base_direction);
        nodeStates[edge.target] = targetState;
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

        // 1. Calculate states
        const rootId = 'uuid-1';
        const rootState = 'INCREASING';
        const states = calculateState(apiNodes, apiEdges, rootId, rootState);

        // 2. Prepare nodes for layout
        const baseNodes = apiNodes.map(node => ({
          ...node,
          style: { 
            background: states[node.id] === 'INCREASING' ? '#22c55e' : (states[node.id] === 'DECREASING' ? '#ef4444' : '#6b7280'),
            color: '#fff',
            borderRadius: 5,
            width: 150
          },
          data: { label: node.data.label }
        }));

        // 3. Prepare edges with styling and scaling
        const baseEdges = apiEdges.map(edge => {
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

        // 4. Apply Dagre Layout
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(baseNodes, baseEdges);
        
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
      } catch (error) {
        console.error("Error:", error);
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
      <div className="absolute inset-0 z-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          fitView
        >
          <Background color="#334155" />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>

      {/* Floating Sidebar (z-10) */}
      {selectedNode && (
        <div className="absolute right-0 top-0 h-full w-96 z-10 bg-slate-900/90 backdrop-blur-md border-l border-slate-800 shadow-2xl p-8 flex flex-col gap-6 text-slate-100 overflow-y-auto">
          <h2 className="text-2xl font-bold text-white border-b border-slate-700 pb-4">{selectedNode.data.label}</h2>
          {selectedNode.edgeData ? (
            <div className="flex flex-col gap-4">
              <p><strong className="text-white block">Reasoning:</strong> <span className="text-slate-300">{selectedNode.edgeData.reasoning}</span></p>
              <p><strong className="text-white">Impact:</strong> <span className="text-slate-300">{selectedNode.edgeData.impact_percentage}%</span></p>
              <p><strong className="text-white">Time Horizon:</strong> <span className="text-slate-300">{selectedNode.edgeData.time_horizon}</span></p>
              <button className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-md transition-colors font-medium w-full mt-4">
                Expand (Coming Soon)
              </button>
            </div>
          ) : (
            <p className="text-slate-400">Root node (no causal impact data).</p>
          )}
          <button 
            onClick={() => setSelectedNode(null)} 
            className="mt-auto border border-slate-600 hover:bg-slate-800 text-slate-300 py-2 rounded-md transition-colors w-full"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
