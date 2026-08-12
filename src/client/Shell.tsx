import { useState, type ReactNode } from 'react';
import { LanguageSwitch, useT } from './i18n/index.js';
import type { Settings } from './settings/useSettings.js';

export type Mode = 'local' | 'online';

export interface MenuSpec {
  id: string;
  label: string;
  /** Small count bubble on the button, e.g. unread chat. */
  badge?: number;
  body: ReactNode;
  /** Anchors the panel to the right edge instead of the left. */
  alignRight?: boolean;
}

export interface ShellProps {
  mode: Mode;
  setMode: (mode: Mode) => void;
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  /** Pop-over panels, in the order their buttons appear. */
  menus: MenuSpec[];
  /** Room code, connection state — whatever belongs in the chip on the right. */
  status: ReactNode;
  /** Rendered as a red button in the bar. Omitted when there is nothing to leave. */
  onLeave?: () => void;
  children: ReactNode;
}

/**
 * The frame every screen sits in: brand, menu buttons, mode switch, and the two
 * soft blobs behind it all.
 *
 * The menus are pop-overs rather than panels stacked above the table. At a card
 * table the felt is the interface; settings, rules and the transcript are
 * things you consult and dismiss, so they float over it and give the table the
 * whole window when you are not looking at them.
 */
export function Shell({
  mode,
  setMode,
  settings,
  set,
  menus,
  status,
  onLeave,
  children,
}: ShellProps) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const active = menus.find((m) => m.id === open) ?? null;

  return (
    <div className="app" data-theme={settings.theme} data-skin={settings.skin}>
      <div className="app__blob app__blob--1" />
      <div className="app__blob app__blob--2" />

      <header className="topbar">
        <h1 className="brand">
          {t('app.title')}
          <span aria-hidden="true">.</span>
        </h1>

        <nav className="topbar__menus">
          {menus.map((menu) => (
            <button
              key={menu.id}
              type="button"
              className="btn btn--ghost"
              aria-expanded={open === menu.id}
              onClick={() => setOpen((current) => (current === menu.id ? null : menu.id))}
            >
              {menu.label} {menu.badge === undefined ? '▾' : <span className="pill">{menu.badge}</span>}
            </button>
          ))}
          <button
            type="button"
            className="btn btn--ghost"
            aria-pressed={settings.showLog}
            onClick={() => set('showLog', !settings.showLog)}
          >
            {t('log.title')}
          </button>
          {onLeave ? (
            <button type="button" className="btn btn--ghost btn--danger" onClick={onLeave}>
              {t('action.leave')}
            </button>
          ) : null}
        </nav>

        <div className="topbar__right">
          {status}
          <button
            type="button"
            className="btn btn--icon"
            title={t('settings.theme')}
            aria-label={t('settings.theme')}
            onClick={() => set('theme', settings.theme === 'dark' ? 'light' : 'dark')}
          >
            {settings.theme === 'dark' ? '☀' : '☾'}
          </button>
          <div className="seg">
            <button
              type="button"
              className="seg__opt"
              aria-pressed={mode === 'local'}
              onClick={() => setMode('local')}
            >
              {t('mode.local')}
            </button>
            <button
              type="button"
              className="seg__opt"
              aria-pressed={mode === 'online'}
              onClick={() => setMode('online')}
            >
              {t('mode.online')}
            </button>
          </div>
          <LanguageSwitch />
        </div>
      </header>

      {active === null ? null : (
        <>
          <div className="menu__scrim" onClick={() => setOpen(null)} />
          <section
            className={`menu menu--${active.id}${active.alignRight ? ' menu--right' : ''}`}
            aria-label={active.label}
          >
            <h2>{active.label}</h2>
            {active.body}
          </section>
        </>
      )}

      {children}
    </div>
  );
}

/** The chip on the right of the bar: a dot, and whatever the mode wants to say. */
export function StatusChip({
  tone = 'ok',
  children,
}: {
  tone?: 'ok' | 'connecting' | 'offline';
  children: ReactNode;
}) {
  return (
    <div className="roomchip">
      <span className={`roomchip__dot${tone === 'ok' ? '' : ` roomchip__dot--${tone}`}`} />
      <span>{children}</span>
    </div>
  );
}
