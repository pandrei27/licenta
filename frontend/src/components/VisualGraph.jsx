import { useEffect, useState, useCallback } from 'react';
import ReactFlow, { Background, Controls, MiniMap, MarkerType, Panel } from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios';
import { getLayoutedElements } from '../utils/layoutUtils';
import SidePanel from './common/SidePanel';

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
  
  const [highlightMode, setHighlightMode] = useState(null); 

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
          animationDelay: `${delay}ms`,
          transition: 'opacity 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease, background-color 0.4s ease' 
        }
      };
    });

    const styledEdges = rawEdges.map(edge => {
      const targetState = nodeStates[edge.target] || 'INCREASING';
      const strokeColor = targetState === 'INCREASING' ? '#22c55e' : '#ef4444';
      const targetNodeDelay = (nodeOrder[edge.target] || 0) * 150; 
      const edgeDelay = targetNodeDelay + 200; 
      
      return {
        ...edge,
        animated: false, 
        type: 'smoothstep',
        style: {
          stroke: strokeColor,
          strokeWidth: calculateEdgeWidth(edge.data?.impact_percentage || 1),
          animation: `popIn 0.8s ease-out ${edgeDelay}ms both`,
          transition: 'opacity 0.4s ease, stroke 0.4s ease' 
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 7, 
          height: 7, 
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

  const toggleHighlight = (mode) => {
    if (!simRootId || nodes.length === 0) return;

    // 1. REVERT STATE
    if (highlightMode === mode) {
      setHighlightMode(null);
      
      setNodes(nds => nds.map(n => ({
        ...n,
        style: {
          ...n.style,
          animation: 'none', 
          borderColor: n.data.state === 'INCREASING' ? '#22c55e' : '#ef4444',
          boxShadow: 'none',
          opacity: 1
        }
      })));

      setEdges(eds => eds.map(e => {
        const targetState = nodes.find(n => n.id === e.target)?.data?.state || 'INCREASING';
        const strokeColor = targetState === 'INCREASING' ? '#22c55e' : '#ef4444';
        return {
          ...e,
          animated: false,
          style: {
            ...e.style, stroke: strokeColor, opacity: 1, animation: 'none', filter: 'none'
          },
          // Restore the arrowheads!
          markerEnd: {
            type: MarkerType.ArrowClosed, width: 7, height: 7, color: strokeColor 
          }
        };
      }));
      return;
    }

    // 2. PATH FINDING ALGORITHMS
    let bestPath = [];
    
    if (mode === 'LONGEST') {
      const dfs = (currId, currentPath) => {
        const outEdges = edges.filter(e => e.source === currId);
        if (outEdges.length === 0) {
          if (currentPath.length > bestPath.length) bestPath = [...currentPath];
          return;
        }
        for (const e of outEdges) {
          if (!currentPath.includes(e.target)) dfs(e.target, [...currentPath, e.target]);
        }
      };
      dfs(simRootId, [simRootId]);
    } 
    else if (mode === 'IMPACT') {
      let maxScore = -1;
      const decayFactor = 0.2; 

      const dfs = (currId, currentPath, currentScore, depth) => {
        const outEdges = edges.filter(e => e.source === currId);
        
        if (outEdges.length === 0) {
          if (currentScore > maxScore) {
            maxScore = currentScore;
            bestPath = [...currentPath];
          }
          return;
        }
        
        for (const e of outEdges) {
          if (!currentPath.includes(e.target)) {
            const impact = e.data?.impact_percentage || 0;
            const edgeScore = impact * Math.pow(decayFactor, depth);
            dfs(e.target, [...currentPath, e.target], currentScore + edgeScore, depth + 1);
          }
        }
      };
      dfs(simRootId, [simRootId], 0, 0);
    }

    // 3. APPLY STYLES
    setHighlightMode(mode);
    const themeColor = mode === 'LONGEST' ? '#9333ea' : '#ea580c'; 
    const shadowColor = mode === 'LONGEST' ? 'rgba(147, 51, 234, 0.4)' : 'rgba(234, 88, 12, 0.4)';
    const glowColor = mode === 'LONGEST' ? 'rgba(147, 51, 234, 0.8)' : 'rgba(234, 88, 12, 0.8)';
    
    setNodes(nds => nds.map(n => {
      const pathIndex = bestPath.indexOf(n.id);
      if (pathIndex !== -1) {
        return {
          ...n,
          style: {
            ...n.style,
            borderColor: themeColor, 
            boxShadow: `0 4px 20px 4px ${shadowColor}`,
            opacity: 1,
            animation: `nodeJump 0.5s ease-out ${pathIndex * 0.15}s forwards`
          }
        };
      } else {
        return {
          ...n,
          style: { 
            ...n.style, opacity: 0.15, borderColor: '#cbd5e1', boxShadow: 'none', animation: 'none' 
          }
        };
      }
    }));

    setEdges(eds => eds.map(e => {
      const srcIdx = bestPath.indexOf(e.source);
      const tgtIdx = bestPath.indexOf(e.target);
      const inPath = srcIdx !== -1 && tgtIdx !== -1 && tgtIdx === srcIdx + 1;

      if (inPath) {
        return {
          ...e,
          animated: false,
          style: {
            ...e.style,
            stroke: themeColor,
            strokeWidth: (e.style?.strokeWidth || 2) + 1,
            filter: `drop-shadow(0px 0px 4px ${glowColor})`,
            opacity: 0,
            // Increased duration to 0.8s to account for the larger 3000px dash array
            animation: `pathEdgeReveal 0.8s ease-out ${(srcIdx * 0.15) + 0.1}s forwards`
          },
          // REMOVE markerEnd for the active path to fix the floating SVG artifact
          markerEnd: undefined
        };
      } else {
        return {
          ...e,
          animated: false,
          style: { 
            ...e.style, stroke: '#cbd5e1', opacity: 0.2, animation: 'none', filter: 'none'
          },
          markerEnd: {
            type: MarkerType.ArrowClosed, width: 7, height: 7, color: '#cbd5e1',
          }
        };
      }
    }));
  };

  const handleExpand = async () => {
    if (!selectedNode || !simRootId) return;
    setHighlightMode(null); 

    try {
      const response = await axios.post(`http://localhost:8000/api/expand/${selectedNode.id}`, {
        label: selectedNode.label,
        existing_labels: nodes.map(n => n.data?.label),
        n_count: 2 
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

  const startSimulation = useCallback(async (node_label, initial_state, target_labels, n_count) => {
    setHighlightMode(null); 
    try {
      const response = await axios.post('http://localhost:8000/api/start', {
        node_label,
        initial_state,
        target_labels,
        n_count
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
    const handleStartSim = (e) => startSimulation(
      e.detail.node_label, 
      e.detail.initial_state,
      e.detail.target_labels,
      e.detail.n_count
    );
    window.addEventListener('start-sim', handleStartSim);
    return () => window.removeEventListener('start-sim', handleStartSim);
  }, [startSimulation]);

  return (
    <div className="w-full h-full relative">
      <style>
        {`
          @keyframes nodeJump {
            0%, 100% { translate: 0 0; }
            50% { translate: 0 -12px; }
          }
          /* Increased limits to 3000 to cover extremely wide layout branches */
          @keyframes pathEdgeReveal {
            0% { stroke-dasharray: 3000; stroke-dashoffset: 3000; opacity: 0; }
            1% { opacity: 1; stroke-dasharray: 3000; stroke-dashoffset: 3000; }
            100% { stroke-dasharray: 3000; stroke-dashoffset: 0; opacity: 1; }
          }
        `}
      </style>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        fitView
      >
        <Background color="#cbd5e1" gap={16} />
        <Controls />
        <MiniMap nodeColor={(n) => n.className?.includes('bg-green-50') ? '#22c55e' : '#ef4444'} />
        
        <Panel position="top-right" className="bg-white/90 p-2 rounded-xl shadow-lg backdrop-blur-md border border-gray-200 mt-2 mr-2 flex space-x-2">
           
           <button 
             onClick={() => toggleHighlight('LONGEST')}
             className={`flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 ${
               highlightMode === 'LONGEST'
               ? 'bg-purple-600 text-white shadow-[0_0_15px_rgba(147,51,234,0.5)] border border-transparent' 
               : 'bg-white text-purple-600 border border-purple-200 hover:bg-purple-50 active:scale-95 opacity-80 hover:opacity-100'
             }`}
           >
             <span className="text-lg leading-none">✨</span>
             <span>Longest Chain</span>
           </button>

           <button 
             onClick={() => toggleHighlight('IMPACT')}
             className={`flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 ${
               highlightMode === 'IMPACT'
               ? 'bg-orange-600 text-white shadow-[0_0_15px_rgba(234,88,12,0.5)] border border-transparent' 
               : 'bg-white text-orange-600 border border-orange-200 hover:bg-orange-50 active:scale-95 opacity-80 hover:opacity-100'
             }`}
           >
             <span className="text-lg leading-none">🔥</span>
             <span>Highest Impact</span>
           </button>

        </Panel>
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