import { LANGUAGES, useI18n } from '../i18n/index.jsx';
import { THEMES, useTheme } from '../theme.jsx';

export default function TopBar({ status, projector, counters, onHelp }) {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();

  const connected = status === 'live';
  const cursor = projector?.cursor ?? 0;
  const head = Math.max(counters?.head ?? counters?.events ?? 0, cursor);
  const behind = Math.max(0, head - cursor);
  const paused = projector?.paused === true;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__mark">LASTCALL</span>
        <span className="brand__dot" aria-hidden="true" />
        <span className="brand__sub">{t('app.sub')}</span>
      </div>

      <div className="status-cluster">
        <span className={`chip ${connected ? 'chip--live' : 'chip--warn'}`}>
          <span className="chip__led" aria-hidden="true" />
          {connected ? t('top.live') : status === 'connecting' ? t('top.connecting') : t('top.offline')}
        </span>

        <span className="chip" title={`${t('top.log')}: ${cursor}/${head}`}>
          {t('top.log')} <b>{cursor}</b>/<b>{head}</b>
        </span>

        <span className={`chip ${behind > 0 ? 'chip--warn' : ''}`}>
          {t('top.lag')} <b>{behind}</b>
        </span>

        <span className="chip" title={t('chaos.duplicatesAbsorbed')}>
          {t('top.dupes')} <b>{counters?.duplicateDeliveries ?? 0}</b>
        </span>

        <span className="chip" title={t('chaos.gapsCaught')}>
          {t('top.gaps')} <b>{counters?.gaps ?? 0}</b>
        </span>

        <span className={`chip ${paused ? 'chip--warn' : ''}`}>
          {t('top.consumer')} <b>{paused ? t('top.stopped') : t('top.running')}</b>
        </span>
      </div>

      <div className="controls">
        <div className="seg" role="group" aria-label={t('top.theme')}>
          {THEMES.map((option) => (
            <button
              key={option.code}
              type="button"
              className="seg__btn"
              aria-pressed={theme === option.code}
              onClick={() => setTheme(option.code)}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>

        <div className="seg" role="group" aria-label={t('top.lang')}>
          {LANGUAGES.map((option) => (
            <button
              key={option.code}
              type="button"
              className="seg__btn"
              aria-pressed={lang === option.code}
              onClick={() => setLang(option.code)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button type="button" className="icon-btn" onClick={onHelp} title={t('top.help')} aria-label={t('top.help')}>
          ?
        </button>
      </div>
    </header>
  );
}
