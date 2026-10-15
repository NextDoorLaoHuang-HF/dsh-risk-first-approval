// Standalone client half: preserve explanation paragraphs in the existing dialog.
// No shell assets, hashed class names, React replacements, or theme overrides.
window.__ModuleLoader__.load({
  id: 'dsh-risk-first-approval',
  factory() {
    return {
      name: 'risk-first-approval-formatting',
      inject: [],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style');
          style.dataset.plugin = 'dsh-risk-first-approval';
          style.textContent = '[data-approval-scroll] > :first-child { white-space: pre-wrap; overflow-wrap: anywhere; }';
          document.head.appendChild(style);
          return () => style.remove();
        }, 'risk-first approval explanation paragraphs');
      },
    };
  },
});
