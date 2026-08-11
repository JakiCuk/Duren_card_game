import { cardCode, type CardId } from '../../engine/index.js';
import { defaultTheme, type CardTheme } from './assets.js';

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
}

/**
 * The only place a card becomes pixels. Game code passes a `CardId` and knows
 * nothing about files, suits glyphs or colours.
 */
export function CardFace({
  card,
  faceDown = false,
  size = 'md',
  theme = defaultTheme(),
  onClick,
  disabled = false,
  selected = false,
  muted = false,
  title,
}: CardFaceProps) {
  const src = faceDown ? theme.back : theme.card(card);
  const label = faceDown ? 'Rubová strana' : cardCode(card);
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
      style={{ aspectRatio: String(theme.aspect) }}
    />
  );

  if (!onClick) {
    return (
      <span className={className} title={title ?? label}>
        {image}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={className}
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
  theme = defaultTheme(),
}: {
  count: number;
  size?: CardSize;
  theme?: CardTheme;
}) {
  const layers = Math.min(count, 4);
  return (
    <span className={`stack stack--${size}`} aria-label={`${count} kariet v balíku`}>
      {Array.from({ length: layers }, (_, i) => (
        <img
          key={i}
          className="stack__layer"
          src={theme.back}
          alt=""
          draggable={false}
          style={{ aspectRatio: String(theme.aspect), translate: `${i * 2}px ${i * -2}px` }}
        />
      ))}
    </span>
  );
}
