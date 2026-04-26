import dagre from 'dagre';

const nodeWidth = 172;
const nodeHeight = 36;

export const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  
  dagreGraph.setGraph({ 
    rankdir: direction,
    ranksep: 120, 
    nodesep: 80   
  });

  dagreGraph.setDefaultEdgeLabel(() => ({}));

  // Sort edges descending by impact to ensure left-to-right sorting of children
  const sortedEdges = [...edges].sort((a, b) => {
    const impactA = a.data?.impact_percentage || 0;
    const impactB = b.data?.impact_percentage || 0;
    return impactB - impactA;
  });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  // Feed the sorted edges into Dagre so it prioritizes them from left to right
  sortedEdges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges: sortedEdges };
};