import { useEffect, useState, useCallback } from 'react';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios';
import { getLayoutedElements } from '../utils/layoutUtils';
import SidePanel from './common/SidePanel';

// Utility for edge thickness
const calculateEdgeWidth = (impactPercentage) => {
  if (impactPercentage <= 0) return 1;
  return Math.max(1, Math.min(8, Math.log10(impactPercentage + 1) * 3));
};

const VisualGraph = () => {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);

  const onNodeClick = useCallback((_, node) => {
    console.log("Node clicked:", node);
    // Directly access label from data if it exists, otherwise use top-level label
    const label = node.data?.label || node.label;

    const incomingEdge = edges.find((e) => e.target === node.id);
    setSelectedNode({
      label: label,
      edgeData: incomingEdge ? incomingEdge.data : null,
    });
  }, [edges]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get('http://localhost:8000/api/mock-simulation');
        const { nodes: rawNodes, edges: rawEdges } = response.data;

        // BFS Engine to calculate states
        const nodeStates = {};
        const rootNodeId = rawNodes[0].id;
        nodeStates[rootNodeId] = 'INCREASING';
        
        const queue = [rootNodeId];
        const visitedEdges = new Set();

        while (queue.length > 0) {
          const sourceId = queue.shift();
          const sourceState = nodeStates[sourceId];

          const outgoingEdges = rawEdges.filter(e => e.source === sourceId);
          for (const edge of outgoingEdges) {
            if (visitedEdges.has(edge.id)) continue;
            visitedEdges.add(edge.id);

            const targetState = edge.data.base_direction === 'DIRECT' 
              ? sourceState 
              : (sourceState === 'INCREASING' ? 'DECREASING' : 'INCREASING');
            
            nodeStates[edge.target] = targetState;
            queue.push(edge.target);
          }
        }

        // Apply styles and layout
        const styledNodes = rawNodes.map(node => ({
          ...node,
          data: { label: node.label, state: nodeStates[node.id] },
          style: {
            background: nodeStates[node.id] === 'INCREASING' ? '#dcfce7' : '#fee2e2',
            border: `1px solid ${nodeStates[node.id] === 'INCREASING' ? '#22c55e' : '#ef4444'}`,
            borderRadius: '8px',
            padding: '10px',
            width: 150,
          },
        }));

        const styledEdges = rawEdges.map(edge => {
          const targetState = nodeStates[edge.target];
          return {
            ...edge,
            animated: true,
            style: {
              stroke: targetState === 'INCREASING' ? '#22c55e' : '#ef4444',
              strokeWidth: calculateEdgeWidth(edge.data.impact_percentage),
            },
          };
        });

        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(styledNodes, styledEdges);
        
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
      } catch (error) {
        console.error("Error fetching/processing simulation:", error);
      }
    };

    fetchData();
  }, []);

  return (
    <div className="flex-grow w-full h-full" style={{ height: '800px', display: 'flex' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <ReactFlow 
          nodes={nodes} 
          edges={edges} 
          onNodeClick={onNodeClick}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
      
      {/* Sidebar - fixed z-index and pointer-events */}
      {selectedNode && (
        <div className="h-full w-80 bg-red-900 border-l border-gray-700 shadow-2xl p-6 text-white" style={{ position: 'static' }}>
          <button 
            onClick={() => setSelectedNode(null)} 
            className="text-white p-4 font-bold"
          >
            ✕ CLOSE
          </button>
          <div className="p-6">
            <h1 className="text-2xl font-bold">{selectedNode.label}</h1>
            <p className="mt-4">TESTING RENDER</p>
            {selectedNode.edgeData && (
               <div className="mt-4 text-sm text-gray-300">
                  <p>Reasoning: {selectedNode.edgeData.reasoning}</p>
               </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VisualGraph;

