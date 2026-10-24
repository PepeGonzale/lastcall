import { useI18n } from '../i18n/index.jsx';

export default function Intro({ onStart, onDismiss, canStart }) {
  const { t } = useI18n();

  return (
    <section className="intro" aria-label={t('intro.kicker')}>
      <div className="intro__copy">
        <div className="intro__kicker">{t('intro.kicker')}</div>
        <h2 className="intro__title">{t('intro.title')}</h2>
        <p className="intro__body">{t('intro.body')}</p>
      </div>

      <div className="intro__actions">
        <button type="button" className="btn btn--primary" onClick={onStart} disabled={!canStart}>
          {t('intro.start')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onDismiss}>
          {t('intro.dismiss')}
        </button>
      </div>
    </section>
  );
}
