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

const CAP_OPTIONS: { value: string; label: string; cap: AttackCap }[] = [
  { value: 'defenderHand', label: 'Podľa ruky obrancu', cap: { kind: 'defenderHand' } },
  { value: 'unlimited', label: 'Bez limitu', cap: { kind: 'unlimited' } },
  { value: 'fixed4', label: 'Najviac 4 karty', cap: { kind: 'fixed', n: 4 } },
  { value: 'fixed6', label: 'Najviac 6 kariet', cap: { kind: 'fixed', n: 6 } },
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
  const set = <K extends keyof RuleConfig>(key: K, value: RuleConfig[K]): void =>
    onChange({ ...config, [key]: value });

  const activePreset = PRESETS.find((p) => JSON.stringify(p.config) === JSON.stringify(config));

  return (
    <details className="rules">
      <summary>
        Pravidlá
        <span className="rules__current">{activePreset ? activePreset.name : 'vlastné nastavenie'}</span>
      </summary>

      <div className="rules__body">
        <div className="panel__row">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`btn btn--ghost${activePreset?.id === preset.id ? ' btn--on' : ''}`}
              onClick={() => onChange(preset.config)}
              title={preset.blurb}
            >
              {preset.name}
            </button>
          ))}
        </div>

        <div className="panel__row">
          <label>
            Kto smie prihadzovať
            <select
              value={config.attackerScope}
              onChange={(e) => set('attackerScope', e.target.value as AttackerScope)}
            >
              <option value="all">Ktokoľvek</option>
              <option value="neighbours">Len susedia obrancu</option>
            </select>
          </label>

          <label>
            Limit útoku
            <select
              value={capValue(config.attackCap)}
              onChange={(e) =>
                set('attackCap', CAP_OPTIONS.find((o) => o.value === e.target.value)!.cap)
              }
            >
              {CAP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            {'Prihadzovanie po „beriem"'}
            <select
              value={config.throwInAfterTakeCap}
              onChange={(e) => set('throwInAfterTakeCap', e.target.value as ThrowInAfterTakeCap)}
              disabled={!config.throwInAfterTake}
            >
              <option value="sameAsAttack">Rovnaký limit ako útok</option>
              <option value="defenderHandAtBoutStart">Podľa ruky na začiatku kola</option>
              <option value="unlimited">Až po strop stola</option>
            </select>
          </label>

          <label>
            Kto začína
            <select
              value={config.firstAttacker}
              onChange={(e) => set('firstAttacker', e.target.value as RuleConfig['firstAttacker'])}
            >
              <option value="lowestTrump">Najnižší tromf</option>
              <option value="random">Náhodne</option>
            </select>
          </label>
        </div>

        <div className="rules__toggles">
          <Toggle
            label="Prehadzovanie (perevodnoy)"
            hint="Obranca môže útok posunúť ďalej kartou rovnakej hodnoty."
            checked={config.transfer.enabled}
            onChange={(v) => set('transfer', { ...config.transfer, enabled: v })}
          />
          <Toggle
            label="Reťazenie prehodení"
            hint="Aj nový obranca smie prehodiť ďalej."
            checked={config.transfer.allowChains}
            disabled={!config.transfer.enabled}
            onChange={(v) => set('transfer', { ...config.transfer, allowChains: v })}
          />
          <Toggle
            label="Prehodenie ukázaním tromfu"
            hint="Tromf rovnakej hodnoty stačí ukázať, zostáva v ruke."
            checked={config.transfer.withTrumpReveal}
            disabled={!config.transfer.enabled}
            onChange={(v) => set('transfer', { ...config.transfer, withTrumpReveal: v })}
          />
          <Toggle
            label="Obranca musí zbiť, ak môže"
            hint="Brať sa dá až keď naozaj niet čím zbiť. Mení hru viac, než sa zdá."
            checked={config.defenderMustBeatAll}
            onChange={(v) => set('defenderMustBeatAll', v)}
          />
          <Toggle
            label={'Prihadzovať aj po „beriem"'}
            checked={config.throwInAfterTake}
            onChange={(v) => set('throwInAfterTake', v)}
          />
          <Toggle
            label="Prvé kolo obmedzené"
            hint="Prvý útok v hre smie mať najviac o kartu menej, než je veľkosť ruky."
            checked={config.firstBoutCapFive}
            onChange={(v) => set('firstBoutCapFive', v)}
          />
          <Toggle
            label="Tromfová karta viditeľná"
            hint="Spodná karta balíka leží lícom hore."
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
