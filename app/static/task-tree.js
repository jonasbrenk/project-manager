/* Pure task-tree operations. These deliberately return new collections so
 * screens can render optimistically without mutating their current snapshot. */
window.PM = window.PM || {};

window.PM.taskTree = (() => {
  const find = (steps, targetId, parent = null) => {
    for (let index = 0; index < (steps || []).length; index += 1) {
      const step = steps[index];
      if (step.id === targetId) return { step, parent, index, collection: steps };
      const nested = find(step.children || [], targetId, step);
      if (nested) return nested;
    }
    return null;
  };

  const depthOf = (steps, targetId, depth = 0) => {
    for (const step of (steps || [])) {
      if (step.id === targetId) return depth;
      const nested = depthOf(step.children || [], targetId, depth + 1);
      if (nested != null) return nested;
    }
    return null;
  };

  const subtreeDepth = step => {
    const children = step?.children || [];
    return children.length ? 1 + Math.max(...children.map(subtreeDepth)) : 0;
  };

  const contains = (steps, targetId) => Boolean(find(steps, targetId));
  const update = (steps, targetId, updater) => (steps || []).map(step => (
    step.id === targetId
      ? updater(step)
      : { ...step, children: update(step.children || [], targetId, updater) }
  ));
  const remove = (steps, targetId) => (steps || [])
    .filter(step => step.id !== targetId)
    .map(step => ({ ...step, children: remove(step.children || [], targetId) }));

  const removeAndCapture = (steps, targetId) => {
    let captured = null;
    const next = (steps || []).flatMap(step => {
      if (step.id === targetId) {
        captured = step;
        return [];
      }
      const nested = removeAndCapture(step.children || [], targetId);
      if (nested.captured) captured = nested.captured;
      return [{ ...step, children: nested.steps }];
    });
    return { steps: next, captured };
  };

  const insert = (steps, parentId, stepToInsert, position = "bottom") => {
    if (parentId == null) {
      const root = [...(steps || [])];
      if (position === "top") root.unshift(stepToInsert);
      else root.push(stepToInsert);
      return root;
    }
    return update(steps || [], parentId, step => ({
      ...step,
      children: position === "top"
        ? [stepToInsert, ...(step.children || [])]
        : [...(step.children || []), stepToInsert],
    }));
  };

  const canPlace = (steps, source, parentId, maxDepth) => {
    const parentDepth = parentId == null ? -1 : depthOf(steps, parentId);
    return parentDepth != null && parentDepth + 1 + subtreeDepth(source) <= maxDepth;
  };

  const progress = (steps) => (steps || []).reduce((total, step) => {
    const nested = progress(step.children || []);
    return { total: total.total + 1 + nested.total, done: total.done + Number(Boolean(step.done)) + nested.done };
  }, { total: 0, done: 0 });

  return { find, depthOf, subtreeDepth, contains, update, remove, removeAndCapture, insert, canPlace, progress };
})();
