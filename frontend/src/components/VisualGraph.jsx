import { useEffect, useState, useCallback } from 'react';
import ReactFlow, { Background, Controls, MiniMap, MarkerType } from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios';
import { getLayoutedElements } from '../utils/layoutUtils';
import SidePanel from './common/SidePanel';

// REVERTED to original Log10 mathematical calculation
const calculateEdgeWidth = (impactPercentage) => {
  if (impactPercentage <= 0) return 1;
  return Math.max(1, Math.min(25, Math.log10(impactPercentage + 1) * 5));
};

const VisualGraph = () => {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  
  const [simRootId, setSimRootId] = useState(null);
  const [simRootState, setSimRootState] = useState("INCREASING");

  const applyStateAndStyles = useCallback((rawNodes, rawEdges, rootId, initialState) => {
    const nodeStates = {};
    const nodeOrder = {}; 
    let orderCounter = 0;
    
    nodeStates[rootId] = initialState;
    nodeOrder[rootId] = orderCounter++;
    
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
          nodeOrder[edge.target] = orderCounter++; 
          queue.push(edge.target);
        }
      }
    }

    const styledNodes = rawNodes.map(node => {
      const state = nodeStates[node.id] || 'INCREASING'; 
      const label = node.data?.label || node.label || "Unknown Node";
      
      const delay = (nodeOrder[node.id] || 0) * 150; 
      
      return {
        ...node,
        data: { ...node.data, label, state },
        className: 'rounded-lg shadow-md !p-3 text-sm font-bold text-gray-800 text-center animate-pop-in',
        style: { 
          width: 150, 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center',
          backgroundColor: state === 'INCREASING' ? '#f0fdf4' : '#fef2f2',
          borderColor: state === 'INCREASING' ? '#22c55e' : '#ef4444',
          borderWidth: '2px',
          borderStyle: 'solid',
          animationDelay: `${delay}ms`
        }
      };
    });

    const styledEdges = rawEdges.map(edge => {
      const targetState = nodeStates[edge.target] || 'INCREASING';
      const strokeColor = targetState === 'INCREASING' ? '#22c55e' : '#ef4444';
      
      const targetNodeDelay = (nodeOrder[edge.target] || 0) * 150; 
      // The arrow will wait for the exact moment the target node appears, plus a 200ms grace period
      const edgeDelay = targetNodeDelay + 200; 
      
      return {
        ...edge,
        animated: false, 
        type: 'smoothstep',
        // Notice we removed the className here and moved the logic directly into the SVG style
        style: {
          stroke: strokeColor,
          strokeWidth: calculateEdgeWidth(edge.data?.impact_percentage || 1),
          // Forcing the animation inline guarantees React Flow applies it to the SVG <path>
          animation: `popIn 0.8s ease-out ${edgeDelay}ms both` 
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 7,  // REVERTED to original size
          height: 7, // REVERTED to original size
          color: strokeColor,
        },
      };
    });

    return { styledNodes, styledEdges };
  }, []);

  const onNodeClick = useCallback((_, node) => {
    const label = node.data?.label || "Unknown";
    const incomingEdge = edges.find((e) => e.target === node.id);
    
    let sourceNode = null;
    if (incomingEdge) {
      sourceNode = nodes.find(n => n.id === incomingEdge.source);
    }

    setSelectedNode({
      id: node.id,
      label: label,
      state: node.data?.state || 'INCREASING',
      edgeData: incomingEdge ? incomingEdge.data : null,
      sourceLabel: sourceNode ? (sourceNode.data?.label || sourceNode.label) : null,
      sourceState: sourceNode ? sourceNode.data?.state : null,
    });
  }, [edges, nodes]);

  const handleExpand = async () => {
    if (!selectedNode || !simRootId) return;

    try {
      const response = await axios.post(`http://localhost:8000/api/expand/${selectedNode.id}`, {
        label: selectedNode.label,
        existing_labels: nodes.map(n => n.data?.label)
      });

      const newNodes = response.data.nodes.map(n => ({...n, data: { ...n.data, label: n.data?.label || n.label}}));
      const newEdges = response.data.edges.map(e => ({...e, data: e.data || {}}));

      const combinedNodes = [...nodes, ...newNodes];
      const combinedEdges = [...edges, ...newEdges];

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
      
      setSimRootId(rootNodeId);
      setSimRootState(initial_state);

      const { styledNodes, styledEdges } = applyStateAndStyles(rawNodes, rawEdges, rootNodeId, initial_state);
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