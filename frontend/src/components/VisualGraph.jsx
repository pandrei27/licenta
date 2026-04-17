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
    // FIX: Access the label from node.data.label, which is where the API puts it
    const label = node.data?.label || "Unknown";
    console.log("Clicked Node:", node);
    const incomingEdge = edges.find((e) => e.target === node.id);
    setSelectedNode({
      id: node.id,
      label: label,
      edgeData: incomingEdge ? incomingEdge.data : null,
    });
  }, [edges]);

  const handleExpand = async () => {
    try {
      const response = await axios.post(`http://localhost:8000/api/expand/${selectedNode.id}`, {
        label: selectedNode.label,
        existing_labels: nodes.map(n => n.data?.label)
      });

      // FIX: Ensure new nodes correctly set data.label
      const newNodes = response.data.nodes.map(n => ({...n, data: {label: n.data?.label || n.label}}));
      const newEdges = response.data.edges.map(e => ({
        ...e,
        animated: true,
        style: { stroke: '#ef4444', strokeWidth: 2 }
      }));

      const combinedNodes = [...nodes, ...newNodes];
      const combinedEdges = [...edges, ...newEdges];
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(combinedNodes, combinedEdges);

      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      setSelectedNode(null);
    } catch (e) {
      console.error(e);
    }
  };

  const startSimulation = useCallback(async (node_label, initial_state) => {
    try {
      const response = await axios.post('http://localhost:8000/api/start', {
        node_label,
        initial_state
      });

        const { nodes: rawNodes, edges: rawEdges } = response.data;
      const rootNodeId = rawNodes[0].id;

      // BFS Engine to calculate states starting from user's choice
      const nodeStates = {};
      nodeStates[rootNodeId] = initial_state;
        
        const queue = [rootNodeId];
        const visitedEdges = new Set();
      const visitedNodes = new Set([rootNodeId]);

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
          if (!visitedNodes.has(edge.target)) {
            visitedNodes.add(edge.target);
            queue.push(edge.target);
          }
        }
      }

      const styledNodes = rawNodes.map(node => ({
          ...node,
          // FIX: Correctly map data.label
          data: { label: node.data?.label || node.label, state: nodeStates[node.id] },
          style: {
            background: nodeStates[node.id] === 'INCREASING' ? '#dcfce7' : '#fee2e2',
            border: `1px solid ${nodeStates[node.id] === 'INCREASING' ? '#22c55e' : '#ef4444'}`,
            borderRadius: '8px',
            padding: '10px',
            width: 150,
          cursor: 'pointer',
          },
        }));

      const styledEdges = rawEdges.map(edge => ({
            ...edge,
            animated: true,
            style: {
          stroke: nodeStates[edge.target] === 'INCREASING' ? '#22c55e' : '#ef4444',
              strokeWidth: calculateEdgeWidth(edge.data.impact_percentage),
            },
      }));

        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(styledNodes, styledEdges);
        
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
      setSelectedNode(null);
      } catch (error) {
      console.error("Error starting simulation:", error);
      }
  }, []);

  useEffect(() => {
    const handleStartSim = (e) => startSimulation(e.detail.node_label, e.detail.initial_state);
    window.addEventListener('start-sim', handleStartSim);
    return () => window.removeEventListener('start-sim', handleStartSim);
  }, [startSimulation]);

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

      {selectedNode && (
        <div style={{ position: 'static' }}>
          <SidePanel
            nodeData={selectedNode}
            onClose={() => setSelectedNode(null)}
            onExpand={handleExpand}
          />
        </div>
      )}
    </div>
  );
};

export default VisualGraph;

