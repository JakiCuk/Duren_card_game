import type { CSSProperties } from 'react';
import { cardCode, type CardId } from '../../engine/index.js';
import { useT } from '../i18n/index.js';
import type { CardTheme } from './assets.js';
import { useCardTheme } from './CardThemeContext.js';

export type CardSize = 'sm' | 'md' | 'lg';

export interface CardFaceProps {
  card: CardId;
  faceDown?: boolean;
  size?: CardSize;
  theme?: CardTheme;
  /** Renders the card as a button. Omit for a static card. */
  onClick?: (card: CardId) => void;
  disabled?: boolean;
  selected?: boolean;
  /** Dims the card without disabling it — used for "you may not play this now". */
  muted?: boolean;
  title?: string;
  /** Placement only — the fan angles its cards from the outside. */
  style?: CSSProperties;
}

/**
 * The only place a card becomes pixels. Game code passes a `CardId` and knows
 * nothing about files, suits glyphs or colours.
 */
export function CardFace({
  card,
  faceDown = false,
  size = 'md',
  theme,
  onClick,
  disabled = false,
  selected = false,
  muted = false,
  title,
  style,
}: CardFaceProps) {
  const t = useT();
  // The hook runs unconditionally; only its result is optional.
  const fromContext = useCardTheme();
  const deck = theme ?? fromContext;
  const src = faceDown ? deck.back : deck.card(card);
  const label = faceDown ? t('card.back') : cardCode(card);
  const className = [
    'card',
    `card--${size}`,
    selected ? 'card--selected' : '',
    muted ? 'card--muted' : '',
    onClick ? 'card--interactive' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const image = (
    <img
      className="card__img"
      src={src}
      alt={label}
      draggable={false}
      style={{ aspectRatio: String(deck.aspect) }}
    />
  );

  if (!onClick) {
    return (
      <span className={className} title={title ?? label} style={style}>
        {image}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={() => onClick(card)}
      disabled={disabled}
      title={title ?? label}
      aria-pressed={selected}
    >
      {image}
    </button>
  );
}

/** A face-down stack, e.g. the draw pile. `count` drives the visible thickness. */
export function CardBackStack({
  count,
  size = 'md',
  theme,
}: {
  count: number;
  size?: CardSize;
  theme?: CardTheme;
}) {
  const t = useT();
  // The hook runs unconditionally; only its result is optional.
  const fromContext = useCardTheme();
  const deck = theme ?? fromContext;
  const layers = Math.min(count, 4);
  return (
    <span className={`stack stack--${size}`} aria-label={t('card.deckOf', { count })}>
      {Array.from({ length: layers }, (_, i) => (
        <img
          key={i}
          className="stack__layer"
          src={deck.back}
          alt=""
          draggable={false}
          style={{ aspectRatio: String(deck.aspect), translate: `${i * 2}px ${i * -2}px` }}
        />
      ))}
    </span>
  );
}
