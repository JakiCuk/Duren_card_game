import { useT } from '../i18n/index.js';
import {
  PRESETS,
  type AttackCap,
  type AttackerScope,
  type RuleConfig,
  type ThrowInAfterTakeCap,
} from '../../shared/rules.js';

export interface RulesPanelProps {
  config: RuleConfig;
  onChange: (config: RuleConfig) => void;
}

const CAP_OPTIONS: { value: string; cap: AttackCap }[] = [
  { value: 'defenderHand', cap: { kind: 'defenderHand' } },
  { value: 'unlimited', cap: { kind: 'unlimited' } },
  { value: 'fixed4', cap: { kind: 'fixed', n: 4 } },
  { value: 'fixed6', cap: { kind: 'fixed', n: 6 } },
];

const capValue = (cap: AttackCap): string =>
  cap.kind === 'fixed' ? `fixed${cap.n}` : cap.kind;

/**
 * Every house rule the engine honours, in one place.
 *
 * Presets exist because the full switch list is genuinely long — most people
 * want "classic" or "with transfers" and should not have to read fourteen
 * labels to get there.
 */
export function RulesPanel({ config, onChange }: RulesPanelProps) {
  const t = useT();
  const set = <K extends keyof RuleConfig>(key: K, value: RuleConfig[K]): void =>
    onChange({ ...config, [key]: value });

  const activePreset = PRESETS.find((p) => JSON.stringify(p.config) === JSON.stringify(config));

  return (
    <details className="rules">
      <summary>
        {t('rules.title')}
        <span className="rules__current">
          {activePreset ? t(`preset.${activePreset.id}`) : t('rules.custom')}
        </span>
      </summary>

      <div className="rules__body">
        <div className="panel__row">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`btn btn--ghost${activePreset?.id === preset.id ? ' btn--on' : ''}`}
              onClick={() => onChange(preset.config)}
              title={t(`preset.${preset.id}.blurb`)}
            >
              {t(`preset.${preset.id}`)}
            </button>
          ))}
        </div>

        <div className="panel__row">
          <label>
            {t('rules.scope')}
            <select
              value={config.attackerScope}
              onChange={(e) => set('attackerScope', e.target.value as AttackerScope)}
            >
              <option value="all">{t('rules.scope.all')}</option>
              <option value="neighbours">{t('rules.scope.neighbours')}</option>
            </select>
          </label>

          <label>
            {t('rules.cap')}
            <select
              value={capValue(config.attackCap)}
              onChange={(e) =>
                set('attackCap', CAP_OPTIONS.find((o) => o.value === e.target.value)!.cap)
              }
            >
              {CAP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(`rules.cap.${o.value}`)}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t('rules.afterTake')}
            <select
              value={config.throwInAfterTakeCap}
              onChange={(e) => set('throwInAfterTakeCap', e.target.value as ThrowInAfterTakeCap)}
              disabled={!config.throwInAfterTake}
            >
              <option value="sameAsAttack">{t('rules.afterTake.sameAsAttack')}</option>
              <option value="defenderHandAtBoutStart">
                {t('rules.afterTake.defenderHandAtBoutStart')}
              </option>
              <option value="unlimited">{t('rules.afterTake.unlimited')}</option>
            </select>
          </label>

          <label>
            {t('rules.firstAttacker')}
            <select
              value={config.firstAttacker}
              onChange={(e) => set('firstAttacker', e.target.value as RuleConfig['firstAttacker'])}
            >
              <option value="lowestTrump">{t('rules.firstAttacker.lowestTrump')}</option>
              <option value="random">{t('rules.firstAttacker.random')}</option>
            </select>
          </label>
        </div>

        <div className="rules__toggles">
          <Toggle
            label={t('rules.transfer')}
            hint={t('rules.transfer.hint')}
            checked={config.transfer.enabled}
            onChange={(v) => set('transfer', { ...config.transfer, enabled: v })}
          />
          <Toggle
            label={t('rules.chains')}
            hint={t('rules.chains.hint')}
            checked={config.transfer.allowChains}
            disabled={!config.transfer.enabled}
            onChange={(v) => set('transfer', { ...config.transfer, allowChains: v })}
          />
          <Toggle
            label={t('rules.reveal')}
            hint={t('rules.reveal.hint')}
            checked={config.transfer.withTrumpReveal}
            disabled={!config.transfer.enabled}
            onChange={(v) => set('transfer', { ...config.transfer, withTrumpReveal: v })}
          />
          <Toggle
            label={t('rules.mustBeat')}
            hint={t('rules.mustBeat.hint')}
            checked={config.defenderMustBeatAll}
            onChange={(v) => set('defenderMustBeatAll', v)}
          />
          <Toggle
            label={t('rules.throwInAfterTake')}
            checked={config.throwInAfterTake}
            onChange={(v) => set('throwInAfterTake', v)}
          />
          <Toggle
            label={t('rules.firstBoutCap')}
            hint={t('rules.firstBoutCap.hint')}
            checked={config.firstBoutCapFive}
            onChange={(v) => set('firstBoutCapFive', v)}
          />
          <Toggle
            label={t('rules.trumpVisible')}
            hint={t('rules.trumpVisible.hint')}
            checked={config.trumpCardVisible}
            onChange={(v) => set('trumpCardVisible', v)}
          />
        </div>
      </div>
    </details>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={`toggle${disabled ? ' toggle--off' : ''}`} title={hint ?? label}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
