window.__ModuleLoader__.load({
  id: 'dsh-risk-first-approval-dev',
  factory() {
    return { name: 'risk-first-hot-approval-formatting', inject: [], apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.plugin = 'dsh-risk-first-approval-dev';
        style.textContent = '[data-approval-scroll] > :first-child { white-space: pre-wrap; overflow-wrap: anywhere; }';
        document.head.appendChild(style);
        return () => style.remove();
      }, 'preserve approval explanation paragraphs');
    } };
  },
});
