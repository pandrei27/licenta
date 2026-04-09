import React, { useEffect } from 'react';
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
  
  const getTargetState = (sourceState, edgeType) => {
    if (edgeType === 'DIRECT') return sourceState;
    return sourceState === 'INCREASING' ? 'DECREASING' : 'INCREASING';
  };

  const processEdges = (sourceId) => {
    edges.forEach(edge => {
      if (edge.source === sourceId) {
        const sourceState = nodeStates[sourceId];
        const targetState = getTargetState(sourceState, edge.data.base_direction);
        nodeStates[edge.target] = targetState;
        // Recursive call to cascade state through the branches
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

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get('http://127.0.0.1:8000/api/simulation/uuid-1');
        const { nodes: apiNodes, edges: apiEdges } = response.data;

        // Simulation parameters (Root is INCREASING)
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

        const styledEdges = apiEdges.map(edge => ({
          ...edge,
          markerEnd: {
            type: MarkerType.ArrowClosed,
          },
          style: { 
            strokeWidth: edge.data.impact_magnitude,
            stroke: states[edge.source] === 'INCREASING' ? 
              (edge.data.base_direction === 'DIRECT' ? '#22c55e' : '#ef4444') :
              (edge.data.base_direction === 'DIRECT' ? '#ef4444' : '#22c55e')
          }
        }));

        setNodes(styledNodes);
        setEdges(styledEdges);
      } catch (error) {
        console.error("Error fetching simulation data:", error);
      }
    };

    fetchData();
  }, [setNodes, setEdges]);

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.5 }}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}

export default App;
