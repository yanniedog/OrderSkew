function createNodeElement(node, activeHash, expandedSet) {
  const wrapper = document.createElement("div");
  wrapper.className = "tree-node";
  wrapper.dataset.hash = String(node.hash);

  const row = document.createElement("div");
  row.className = "node-row" + (String(node.hash) === String(activeHash) ? " active" : "");

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "toggle" + (hasChildren ? "" : " ghost");
  toggle.textContent = hasChildren ? (expandedSet.has(String(node.hash)) ? "-" : "+") : "·";

  const move = document.createElement("span");
  move.className = "move";
  move.textContent = node.moveSequence ? node.moveSequence.split(" ").slice(-1)[0] : "ROOT";

  const evalScore = document.createElement("span");
  evalScore.className = "eval";
  evalScore.textContent = node.eval == null ? "-" : ((Number(node.eval) / 100).toFixed(2));

  const depth = document.createElement("span");
  depth.className = "depth";
  depth.textContent = "d" + node.depth;

  row.append(toggle, move, evalScore, depth);
  wrapper.appendChild(row);

  const children = document.createElement("div");
  children.className = "children" + (expandedSet.has(String(node.hash)) ? " open" : "");
  wrapper.appendChild(children);

  return { wrapper, row, toggle, children };
}

function appendChildren(parentEl, parentNode, tree, activeHash, expandedSet, onSelect, onToggle) {
  if (!expandedSet.has(String(parentNode.hash))) return;
  if (!Array.isArray(parentNode.children)) return;
  for (const edge of parentNode.children) {
    const child = tree.get(String(edge.childHash));
    if (!child) continue;
    const childEl = createNodeElement(child, activeHash, expandedSet);
    childEl.row.addEventListener("click", () => onSelect(child.hash));
    childEl.toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      onToggle(child.hash);
    });
    parentEl.appendChild(childEl.wrapper);
    appendChildren(childEl.children, child, tree, activeHash, expandedSet, onSelect, onToggle);
  }
}

export function renderTree(container, state, expandedSet, onSelect, onToggle) {
  container.innerHTML = "";
  if (!state.rootHash || state.tree.size === 0) {
    container.innerHTML = '<div class="empty">No tree loaded.</div>';
    return;
  }
  const root = state.tree.get(String(state.rootHash));
  if (!root) {
    container.innerHTML = '<div class="empty">Root node missing.</div>';
    return;
  }

  const rootEl = createNodeElement(root, state.activeHash, expandedSet);
  rootEl.row.addEventListener("click", () => onSelect(root.hash));
  rootEl.toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    onToggle(root.hash);
  });
  container.appendChild(rootEl.wrapper);
  appendChildren(rootEl.children, root, state.tree, state.activeHash, expandedSet, onSelect, onToggle);
}
