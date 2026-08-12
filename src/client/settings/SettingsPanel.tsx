import { useT } from '../i18n/index.js';
import { BOT_DELAY_RANGE, SKINS, type Settings, type Skin } from './useSettings.js';

export interface SettingsPanelProps {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

/**
 * The swatch trio each skin button shows.
 *
 * Deliberately hard-coded rather than read from custom properties: the button
 * has to preview a skin that is *not* currently applied, so it cannot ask the
 * cascade what that skin looks like.
 */
const SWATCHES: Record<Skin, [string, string, string]> = {
  organic: ['#c67139', '#7a8a5e', '#f5ead8'],
  modern: ['#3b6dfb', '#101318', '#f2f4f8'],
  classic: ['#1f6b45', '#8d1c1c', '#c9a227'],
};

/**
 * The comfort knobs, rendered as a plain block.
 *
 * No disclosure of its own: it sits inside the one menu the header already has,
 * because two separate fold-outs for "how the game is set up" and "how it
 * behaves" is one more thing to hunt through than anybody needs.
 */
export function SettingsPanel({ settings, set }: SettingsPanelProps) {
  const t = useT();
  const seconds = (settings.botDelayMs / 1000).toFixed(1);

  return (
    <section className="settings">
      <h3>{t('settings.appearance')}</h3>

      <div>
        <div className="menu__label">{t('settings.skin')}</div>
        <div className="settings__grid">
          {SKINS.map((skin) => (
            <button
              key={skin}
              type="button"
              className={`skinbtn skinbtn--${skin}`}
              aria-pressed={settings.skin === skin}
              onClick={() => set('skin', skin)}
            >
              <span className="skinbtn__swatch">
                {SWATCHES[skin].map((colour) => (
                  <i key={colour} style={{ background: colour }} />
                ))}
              </span>
              <span>{t(`skin.${skin}`)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings__row">
        <span>
          {t('settings.theme')}
          <span className="seg">
            <button
              type="button"
              className="seg__opt"
              aria-pressed={settings.theme === 'light'}
              onClick={() => set('theme', 'light')}
            >
              {t('theme.light')}
            </button>
            <button
              type="button"
              className="seg__opt"
              aria-pressed={settings.theme === 'dark'}
              onClick={() => set('theme', 'dark')}
            >
              {t('theme.dark')}
            </button>
          </span>
        </span>
      </div>

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
