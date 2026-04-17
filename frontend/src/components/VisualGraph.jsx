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
  
  // Track the root of the simulation to recalculate states on expand
  const [simRootId, setSimRootId] = useState(null);
  const [simRootState, setSimRootState] = useState("INCREASING");

  // Reusable BFS Engine to calculate states and styles
  const applyStateAndStyles = useCallback((rawNodes, rawEdges, rootId, initialState) => {
    const nodeStates = {};
    nodeStates[rootId] = initialState;
    
    const queue = [rootId];
    const visitedEdges = new Set();
    const visitedNodes = new Set([rootId]);

    while (queue.length > 0) {
      const sourceId = queue.shift();
      const sourceState = nodeStates[sourceId];

      const outgoingEdges = rawEdges.filter(e => e.source === sourceId);
      for (const edge of outgoingEdges) {
        if (visitedEdges.has(edge.id)) continue;
        visitedEdges.add(edge.id);

        const targetState = edge.data?.base_direction === 'DIRECT'
          ? sourceState
          : (sourceState === 'INCREASING' ? 'DECREASING' : 'INCREASING');
        
        nodeStates[edge.target] = targetState;
        
        if (!visitedNodes.has(edge.target)) {
          visitedNodes.add(edge.target);
          queue.push(edge.target);
        }
      }
    }

    const styledNodes = rawNodes.map(node => {
      const state = nodeStates[node.id] || 'INCREASING'; 
      const label = node.data?.label || node.label || "Unknown Node";
      
      return {
        ...node,
        data: { ...node.data, label, state },
        // Keep tailwind for shadows/rounding, but force colors via style
        className: 'rounded-lg shadow-md !p-3 text-sm font-bold text-gray-800 text-center',
        style: { 
          width: 150, 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center',
          backgroundColor: state === 'INCREASING' ? '#f0fdf4' : '#fef2f2', // bg-green-50 / bg-red-50
          borderColor: state === 'INCREASING' ? '#22c55e' : '#ef4444',     // border-green-500 / border-red-500
          borderWidth: '2px',
          borderStyle: 'solid'
        }
      };
    });

    const styledEdges = rawEdges.map(edge => {
      const targetState = nodeStates[edge.target] || 'INCREASING';
      return {
        ...edge,
        animated: true,
        style: {
          stroke: targetState === 'INCREASING' ? '#22c55e' : '#ef4444',
          strokeWidth: calculateEdgeWidth(edge.data?.impact_percentage || 1),
        },
      };
    });

    return { styledNodes, styledEdges };
  }, []);

  const onNodeClick = useCallback((_, node) => {
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
    if (!selectedNode || !simRootId) return;

    try {
      const response = await axios.post(`http://localhost:8000/api/expand/${selectedNode.id}`, {
        label: selectedNode.label,
        existing_labels: nodes.map(n => n.data?.label)
      });

      // Format new elements
      const newNodes = response.data.nodes.map(n => ({...n, data: { ...n.data, label: n.data?.label || n.label}}));
      const newEdges = response.data.edges.map(e => ({...e, data: e.data || {}}));

      const combinedNodes = [...nodes, ...newNodes];
      const combinedEdges = [...edges, ...newEdges];

      // Re-run the BFS engine over the entire combined graph to cascade colors!
      const { styledNodes, styledEdges } = applyStateAndStyles(combinedNodes, combinedEdges, simRootId, simRootState);
      
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(styledNodes, styledEdges);

      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      setSelectedNode(null);
    } catch (e) {
      console.error("Error expanding node:", e);
    }
  };

  const startSimulation = useCallback(async (node_label, initial_state) => {
    try {
      const response = await axios.post('http://localhost:8000/api/start', {
        node_label,
        initial_state
      });

      const { nodes: rawNodes, edges: rawEdges } = response.data;
      if (!rawNodes || rawNodes.length === 0) return;
      
      const rootNodeId = rawNodes[0].id;
      
      // Save root context for future expansions
      setSimRootId(rootNodeId);
      setSimRootState(initial_state);

      // Apply BFS and Styling
      const { styledNodes, styledEdges } = applyStateAndStyles(rawNodes, rawEdges, rootNodeId, initial_state);

      // Apply Dagre Layout
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(styledNodes, styledEdges);
      
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      setSelectedNode(null);
    } catch (error) {
      console.error("Error starting simulation:", error);
    }
  }, [applyStateAndStyles]);

  useEffect(() => {
    const handleStartSim = (e) => startSimulation(e.detail.node_label, e.detail.initial_state);
    window.addEventListener('start-sim', handleStartSim);
    return () => window.removeEventListener('start-sim', handleStartSim);
  }, [startSimulation]);

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        fitView
      >
        <Background color="#cbd5e1" gap={16} />
        <Controls />
        <MiniMap nodeColor={(n) => n.className?.includes('bg-green-50') ? '#22c55e' : '#ef4444'} />
      </ReactFlow>

      {selectedNode && (
        <SidePanel
          nodeData={selectedNode}
          onClose={() => setSelectedNode(null)}
          onExpand={handleExpand}
        />
      )}
    </div>
  );
};

export default VisualGraph;