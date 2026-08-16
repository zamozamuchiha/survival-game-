const box = document.getElementById('toasts');
const queue = [];

export function toast(text, kind = 'good') {
  const el = document.createElement('div');
  el.className = `toast ${kind === 'good' ? '' : kind}`.trim();
  el.innerHTML = text;
  box.appendChild(el);
  queue.push(el);
  if (queue.length > 7) queue.shift().remove();
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => { el.remove(); const i = queue.indexOf(el); if (i >= 0) queue.splice(i, 1); }, 300);
  }, 2600);
}

export function toastLoot(drops, items) {
  const parts = drops.map((d) => `${items[d.id]?.icon ?? ''} ${items[d.id]?.name ?? d.id} ×${d.n}`);
  toast(parts.join('<br>'));
}
