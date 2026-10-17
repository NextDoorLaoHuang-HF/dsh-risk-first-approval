// Standalone client half, two contributions:
// 1. Preserve explanation paragraphs in the existing approval dialog.
// 2. Reviewer-route settings card in the Plugins section (0.1.4).
// No shell assets, hashed class names, React replacements, or theme overrides.
window.__ModuleLoader__.load({
  id: 'dsh-risk-first-approval',
  factory: (require) => {
    const react = require('react');
    const { useState, useEffect, useCallback, useSyncExternalStore, createElement: h } = react;

    /** Locale namespace owned by this card. */
    const NS = 'settings.risk-first-approval';
    /** Reasoning efforts offered for the fixed reviewer effort. */
    const EFFORTS = ['', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

    const en = {
      title: 'Risk-first Approval',
      intro: 'Route Auto-mode risk reviews to a dedicated provider, model, and reasoning effort instead of every session\'s own route. Empty provider and model keep the historical follow-the-session behavior.',
      provider: 'Reviewer provider',
      model: 'Reviewer model',
      effort: 'Reviewer reasoning effort',
      followSession: 'Follow session route',
      chooseModel: 'Choose a model…',
      effortAuto: 'Automatic',
      providerHelp: 'For example commandcode or zai-coding-cn. Must be set together with the model.',
      modelHelp: 'For example deepseek/deepseek-v4.1-flash. Prefer a metered channel so subscription caps cannot fail-close Auto mode.',
      effortHelp: 'Empty resolves automatically from the reviewer model\'s capabilities; unsupported values fail closed before any request.',
      settingsLoading: 'Loading reviewer route…',
      settingsUnavailable: 'The reviewer-route form is unavailable in this profile.',
      settingsReadOnly: 'The reviewer-route configuration is read-only.',
      invalidPair: 'Reviewer provider and model must be set together, or both left empty.',
      invalidEffort: 'A fixed reasoning effort requires both provider and model.',
      routingNote: 'While the dev hot-engine bundle is installed, these values configure the risk-first-hot-engine row; the production row applies after removing the dev bundle. Saved edits apply to the next review without a restart.',
      discard: 'Discard',
      save: 'Save',
      saving: 'Saving…',
      settingsSaved: 'Reviewer route saved.',
      settingsSaveFailed: 'The host refused the reviewer-route change.',
    };

    const zh = {
      title: 'Risk-first 审批',
      intro: '把 Auto 模式的风险审核路由到专用的供应商、模型与推理档位，不再跟随每个会话自己的路由。供应商与模型留空即保持“跟随会话”的历史行为。',
      provider: '审核供应商',
      model: '审核模型',
      effort: '审核推理档位',
      followSession: '跟随会话路由',
      chooseModel: '选择模型…',
      effortAuto: '自动',
      providerHelp: '例如 commandcode 或 zai-coding-cn。必须与模型成对设置。',
      modelHelp: '例如 deepseek/deepseek-v4.1-flash。建议选择按量计费通道，订阅限额就不会让 Auto 模式整体失效。',
      effortHelp: '留空时按审核模型的能力自动解析；配置了不支持的档位会在发出请求前明确失败。',
      settingsLoading: '正在加载审核路由…',
      settingsUnavailable: '当前 profile 未提供审核路由配置表单。',
      settingsReadOnly: '审核路由配置为只读。',
      invalidPair: '审核供应商与模型必须成对设置，或都留空。',
      invalidEffort: '固定推理档位需要同时设置供应商与模型。',
      routingNote: '安装了 dev 热引擎 bundle 时，这些值配置 risk-first-hot-engine 行；卸载 dev bundle 后作用于生产行。保存后下一次审核即生效，无需重启。',
      discard: '放弃',
      save: '保存',
      saving: '保存中…',
      settingsSaved: '审核路由已保存。',
      settingsSaveFailed: '主机拒绝了审核路由修改。',
    };

    const sectionStyle = { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720, color: 'var(--dsw-alias-label-primary)' };
    const titleStyle = { margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' };
    const bodyStyle = { margin: 0, fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-secondary)' };
    const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 6 };
    const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 };
    const labelStyle = { fontSize: 13, lineHeight: '20px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' };
    const helpStyle = { margin: 0, fontSize: 13, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' };
    const controlStyle = { boxSizing: 'border-box', width: '100%', minHeight: 36, padding: '7px 10px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 13 };
    const actionsStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 };
    const buttonsStyle = { display: 'flex', gap: 8 };
    const buttonStyle = { boxSizing: 'border-box', minHeight: 34, padding: '6px 14px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 18, background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 13, cursor: 'pointer' };
    const primaryButtonStyle = { ...buttonStyle, borderColor: 'var(--dsw-alias-brand-primary)', background: 'var(--dsw-alias-brand-primary)', color: 'white' };
    const errorStyle = { ...bodyStyle, color: 'var(--dsw-alias-state-error-primary)' };
    const successStyle = { ...bodyStyle, color: 'var(--dsw-alias-state-success-primary, #16825d)' };

    const UNAVAILABLE_SNAPSHOT = {
      status: 'unavailable', value: undefined, base: undefined, user: undefined,
      revision: undefined, writable: false, mode: 'memory',
    };
    const FIELDS = ['reviewerProvider', 'reviewerModel', 'reviewerReasoningEffort'];

    function ReviewerRouteCard({ form, t, models }) {
      // The framework supplies t from the registered locale namespace; the
      // English dictionary is only a last-resort fallback for missing wiring.
      const translate = t || (key => en[key] ?? key);
      const subscribe = useCallback(listener => (form ? form.subscribe(listener) : () => undefined), [form]);
      const getSnapshot = useCallback(() => (form ? form.getSnapshot() : UNAVAILABLE_SNAPSHOT), [form]);
      const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
      const [draft, setDraft] = useState(snapshot.value);
      const [dirty, setDirty] = useState(false);
      const [busy, setBusy] = useState(false);
      const [feedback, setFeedback] = useState('idle');
      // One shared model catalog (providers, models, reasoning efforts) from
      // the same directory service the chat model picker uses.
      const [catalog, setCatalog] = useState(undefined);
      useEffect(() => {
        if (!models) return;
        let live = true;
        models.load().then(value => { if (live) setCatalog(value); }).catch(() => {});
        return () => { live = false; };
      }, [models]);

      useEffect(() => {
        if (!dirty && !busy) setDraft(snapshot.value);
      }, [busy, dirty, snapshot.revision, snapshot.value]);

      const update = (field, value) => {
        setDraft(current => (current === undefined ? current : { ...current, [field]: value }));
        setDirty(true);
        setFeedback('idle');
      };

      const trimmed = field => (typeof draft?.[field] === 'string' ? draft[field].trim() : '');
      const provider = trimmed('reviewerProvider');
      const model = trimmed('reviewerModel');
      const effort = trimmed('reviewerReasoningEffort');
      const pairValid = (provider.length === 0) === (model.length === 0);
      const effortValid = provider.length > 0 || effort.length === 0;
      const valid = pairValid && effortValid;

      // Dropdown sources from the live catalog; a configured value that is
      // absent from the catalog stays selectable so nothing silently resets.
      const groups = catalog?.groups ?? [];
      const providerOptions = groups.map(group => group.id);
      const groupModels = provider.length > 0
        ? (groups.find(group => group.id === provider)?.models ?? []).map(entry => entry.id)
        : [];
      const reasoning = provider && model && models ? models.reasoningFor({ provider, model }) : undefined;
      const effortOptions = reasoning?.efforts?.map(entry => entry.id).filter(id => id && id !== 'off') ?? EFFORTS.filter(id => id !== '');
      const withCurrent = (options, current) => (current && !options.includes(current) ? [...options, current] : options);

      const save = async () => {
        if (form === undefined || draft === undefined || !snapshot.writable || !valid) return;
        const desired = { ...draft, reviewerProvider: provider, reviewerModel: model, reviewerReasoningEffort: effort };
        setBusy(true);
        setFeedback('idle');
        try {
          for (const field of FIELDS) {
            const accepted = form.getSnapshot().value;
            if (accepted?.[field] === desired[field]) continue;
            await form.set(field, desired[field]);
            if (form.getSnapshot().value?.[field] !== desired[field]) {
              throw new Error(`Host refused ${field}`);
            }
          }
          setDraft(form.getSnapshot().value);
          setDirty(false);
          setFeedback('saved');
        } catch {
          setDraft(form.getSnapshot().value);
          setDirty(false);
          setFeedback('error');
        } finally {
          setBusy(false);
        }
      };

      const loading = snapshot.status === 'loading';
      const editable = snapshot.status === 'ready' && snapshot.writable && !busy;

      return h('section', { style: sectionStyle, 'aria-labelledby': 'risk-first-approval-card-title' },
        h('h3', { id: 'risk-first-approval-card-title', style: titleStyle }, translate('title')),
        h('p', { style: bodyStyle }, translate('intro')),
        loading ? h('p', { style: bodyStyle, role: 'status' }, translate('settingsLoading')) : null,
        snapshot.status === 'unavailable' ? h('p', { style: errorStyle, role: 'alert' }, translate('settingsUnavailable')) : null,
        snapshot.status === 'ready' && !snapshot.writable ? h('p', { style: errorStyle, role: 'alert' }, translate('settingsReadOnly')) : null,
        draft === undefined ? null : h('div', { style: gridStyle, 'aria-disabled': !editable },
          h('label', { style: fieldStyle },
            h('span', { style: labelStyle }, translate('provider')),
            h('select', {
              style: controlStyle, value: draft.reviewerProvider || '', disabled: !editable,
              'aria-invalid': String(!pairValid),
              onChange: event => { update('reviewerProvider', event.currentTarget.value); if (event.currentTarget.value === '') update('reviewerModel', ''); },
            },
              h('option', { value: '' }, translate('followSession')),
              withCurrent(providerOptions, provider).map(id => h('option', { key: id, value: id }, id)),
            ),
            h('span', { style: helpStyle }, translate('providerHelp')),
          ),
          h('label', { style: fieldStyle },
            h('span', { style: labelStyle }, translate('model')),
            h('select', {
              style: controlStyle, value: draft.reviewerModel || '', disabled: !editable || provider.length === 0,
              'aria-invalid': String(!pairValid),
              onChange: event => update('reviewerModel', event.currentTarget.value),
            },
              h('option', { value: '' }, provider.length === 0 ? '—' : translate('chooseModel')),
              withCurrent(groupModels, model).map(id => h('option', { key: id, value: id }, id)),
            ),
            h('span', { style: helpStyle }, translate('modelHelp')),
          ),
          h('label', { style: fieldStyle },
            h('span', { style: labelStyle }, translate('effort')),
            h('select', {
              style: controlStyle, value: draft.reviewerReasoningEffort || '', disabled: !editable,
              'aria-invalid': String(!effortValid),
              onChange: event => update('reviewerReasoningEffort', event.currentTarget.value),
            },
              h('option', { value: '' }, translate('effortAuto')),
              withCurrent(effortOptions, effort).map(id => h('option', { key: id, value: id }, id)),
            ),
            h('span', { style: helpStyle }, translate('effortHelp')),
          ),
        ),
        !pairValid && draft !== undefined ? h('p', { style: errorStyle, role: 'alert' }, translate('invalidPair')) : null,
        !effortValid && draft !== undefined ? h('p', { style: errorStyle, role: 'alert' }, translate('invalidEffort')) : null,
        h('p', { style: helpStyle }, translate('routingNote')),
        h('div', { style: actionsStyle },
          h('span', { 'aria-live': 'polite' },
            feedback === 'saved' ? h('span', { style: successStyle }, translate('settingsSaved')) : null,
            feedback === 'error' ? h('span', { style: errorStyle }, translate('settingsSaveFailed')) : null,
          ),
          h('span', { style: buttonsStyle },
            h('button', {
              type: 'button', style: buttonStyle, disabled: !dirty || busy,
              onClick: () => { setDirty(false); setFeedback('idle'); setDraft(form ? form.getSnapshot().value : undefined); },
            }, translate('discard')),
            h('button', {
              type: 'button', style: primaryButtonStyle,
              disabled: !dirty || !valid || !snapshot.writable || busy,
              onClick: () => { void save(); },
            }, busy ? translate('saving') : translate('save')),
          ),
        ),
      );
    }

    return {
      name: 'risk-first-approval-client',
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        // 1. Approval-dialog explanation paragraphs (unchanged behavior).
        ctx.effect(() => {
          const style = document.createElement('style');
          style.dataset.plugin = 'dsh-risk-first-approval';
          style.textContent = '[data-approval-scroll] > :first-child { white-space: pre-wrap; overflow-wrap: anywhere; }';
          document.head.appendChild(style);
          return () => style.remove();
        }, 'risk-first approval explanation paragraphs');
        // 2. Reviewer-route card in the Plugins settings section.
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'risk-first-approval: settings copy');
        // The dev hot-engine row owns the reviewer while its bundle is
        // installed; fall back to the production row when it is not.
        const resolveForm = () => {
          for (const id of ['risk-first-hot-engine', 'risk-first-auto-review']) {
            try {
              const form = ctx.configForms.get(id);
              if (form !== undefined) return form;
            } catch { /* entry absent in this composition */ }
          }
          return undefined;
        };
        ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
          name: 'settings.plugins.tab',
          id: 'risk-first-approval',
          order: 31,
          label: () => ctx.locale.bind(NS)('title'),
          locale: NS,
          inject: () => ({ form: resolveForm(), models: ctx.modelDirectories }),
        }, ReviewerRouteCard));
      },
    };
  },
});
