type Attrs = Record<string, unknown> & {
  class?: string;
  style?: string;
  onclick?: (e: MouseEvent) => void;
};

/** Mini-helper om DOM-elementen te maken: h('div', {class:'x'}, kind1, kind2…). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs)
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.firstChild.remove();
}

export function toast(msg: string) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2700);
}

export function modal(title: string, body: HTMLElement, opts: { small?: boolean; onClose?: () => void; actions?: HTMLElement } = {}) {
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const back = h(
    'div',
    { class: 'modal-back', onmousedown: (e: MouseEvent) => e.target === back && close() },
    h(
      'div',
      { class: `modal${opts.small ? ' small' : ''}` },
      h('header', null, h('h2', null, title), h('div', { style: 'display:flex;gap:6px;align-items:center' }, opts.actions ?? null, h('button', { class: 'icon-btn', title: 'Sluiten', onclick: close }, '✕'))),
      h('div', { class: 'body' }, body),
    ),
  );
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  return close;
}

export function stars(n: number, max = 3) {
  const s = h('span', { class: 'stars' });
  for (let i = 0; i < max; i++) s.append(h('span', { class: i < n ? '' : 'off' }, '★'));
  return s;
}
