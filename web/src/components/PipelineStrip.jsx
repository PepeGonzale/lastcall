import { useI18n } from '../i18n/index.jsx';

const NODES = [
  { key: 'cmd', title: 'pipe.cmd', note: 'pipe.cmdNote' },
  { key: 'tx', title: 'pipe.tx', note: 'pipe.txNote' },
  { key: 'log', title: 'pipe.log', note: 'pipe.logNote', accent: true },
  { key: 'proj', title: 'pipe.proj', note: 'pipe.projNote' },
  { key: 'view', title: 'pipe.view', note: 'pipe.viewNote' },
  { key: 'ws', title: 'pipe.ws', note: 'pipe.wsNote' },
];

export default function PipelineStrip() {
  const { t } = useI18n();

  return (
    <section className="pipeline" id="pipeline" aria-label={t('pipe.label')}>
      <div className="pipeline__label">{t('pipe.label')}</div>
      <div className="pipeline__track">
        {NODES.map((node, index) => (
          <div key={node.key} className="pipeline__step">
            <div className={`pipeline__node ${node.accent ? 'pipeline__node--accent' : ''}`}>
              <span className="pipeline__title">{t(node.title)}</span>
              <span className="pipeline__note">{t(node.note)}</span>
            </div>
            {index < NODES.length - 1 && (
              <span className="pipeline__arrow" aria-hidden="true">
                →
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="pipeline__foot">{t('pipe.foot')}</p>
    </section>
  );
}
