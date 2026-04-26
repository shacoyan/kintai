import * as React from 'react';
import { cn } from '../../lib/cn';

export type CardPadding = 'sm' | 'md' | 'lg' | 'none';
export type CardElement = 'div' | 'section' | 'article';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  as?: CardElement;
}

export type CardSlotProps = React.HTMLAttributes<HTMLDivElement>;

const paddingMap: Record<CardPadding, string> = {
  none: 'p-0',
  sm: 'p-4',
  md: 'p-5 md:p-6',
  lg: 'p-6 md:p-8',
};

const CardPaddingContext = React.createContext<CardPadding>('md');

function CardRoot(props: CardProps): JSX.Element {
  const { padding = 'md', as = 'section', className, children, ...rest } = props;
  const Tag = as as React.ElementType;
  return (
    <CardPaddingContext.Provider value={padding}>
      <Tag
        className={cn(
          'bg-white border border-neutral-100 rounded-lg shadow-xs',
          paddingMap[padding],
          className,
        )}
        {...rest}
      >
        {children}
      </Tag>
    </CardPaddingContext.Provider>
  );
}

function CardHeader(props: CardSlotProps): JSX.Element {
  const { className, children, ...rest } = props;
  return (
    <header
      className={cn(
        'border-b border-neutral-100 pb-4 mb-4 text-heading-3 text-neutral-900',
        className,
      )}
      {...rest}
    >
      {children}
    </header>
  );
}

function CardBody(props: CardSlotProps): JSX.Element {
  const { className, children, ...rest } = props;
  return (
    <div className={cn(className)} {...rest}>
      {children}
    </div>
  );
}

function CardFooter(props: CardSlotProps): JSX.Element {
  const { className, children, ...rest } = props;
  const padding = React.useContext(CardPaddingContext);
  const horizontalPadding = padding === 'none' ? 'px-5 md:px-6' : '';
  return (
    <footer
      className={cn(
        'border-t border-neutral-100 pt-4 mt-4 flex items-center justify-end gap-2',
        horizontalPadding,
        className,
      )}
      {...rest}
    >
      {children}
    </footer>
  );
}

interface CardComponent {
  (props: CardProps): JSX.Element;
  Header: (props: CardSlotProps) => JSX.Element;
  Body: (props: CardSlotProps) => JSX.Element;
  Footer: (props: CardSlotProps) => JSX.Element;
}

const CardWithSlots = CardRoot as CardComponent;
CardWithSlots.Header = CardHeader;
CardWithSlots.Body = CardBody;
CardWithSlots.Footer = CardFooter;

export const Card: CardComponent = CardWithSlots;
