import { useT } from '../i18n/index.js';
import { BOT_DELAY_RANGE, type Settings } from './useSettings.js';

export interface SettingsPanelProps {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

/**
 * The comfort knobs, rendered as a plain block.
 *
 * No disclosure of its own: it sits inside the one panel the page already has,
 * because two separate fold-outs for "how the game is set up" and "how it
 * behaves" is one more thing to hunt through than anybody needs.
 */
export function SettingsPanel({ settings, set }: SettingsPanelProps) {
  const t = useT();
  const seconds = (settings.botDelayMs / 1000).toFixed(1);

  return (
    <section className="settings">
      <h3>{t('settings.title')}</h3>

      <div className="settings__body">
        <label className="settings__row">
          <span>
            {t('settings.botSpeed')}
            <em>{t('settings.seconds', { n: seconds })}</em>
          </span>
          <input
            type="range"
            min={BOT_DELAY_RANGE.min}
            max={BOT_DELAY_RANGE.max}
            step={BOT_DELAY_RANGE.step}
            value={settings.botDelayMs}
            aria-label={t('settings.botSpeed')}
            onChange={(e) => set('botDelayMs', Number(e.target.value))}
          />
          <small>{t('settings.botSpeed.hint')}</small>
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.holdForThrowIn}
            onChange={(e) => set('holdForThrowIn', e.target.checked)}
          />
          <span>
            {t('settings.holdForThrowIn')}
            <small>{t('settings.holdForThrowIn.hint')}</small>
          </span>
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.showStatus}
            onChange={(e) => set('showStatus', e.target.checked)}
          />
          <span>
            {t('settings.showStatus')}
            <small>{t('settings.showStatus.hint')}</small>
          </span>
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.showLog}
            onChange={(e) => set('showLog', e.target.checked)}
          />
          <span>
            {t('settings.showLog')}
            <small>{t('settings.showLog.hint')}</small>
          </span>
        </label>
      </div>
    </section>
  );
}
