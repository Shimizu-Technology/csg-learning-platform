import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'
/**
 * md = 44px and lg = 48px everywhere. sm is a compact control for dense
 * desktop toolbars only: it keeps the 44px touch target on phones and tablets
 * and drops to 36px at the desktop breakpoint.
 */
export type ButtonSize = 'sm' | 'md' | 'lg'
/** `brand` uses the CSG site's 6px radius on public and sign-in surfaces. */
export type ButtonShape = 'default' | 'brand'

const SHAPES: Record<ButtonShape, string> = {
  default: 'rounded-xl',
  brand: 'rounded-md',
}

const base =
  'inline-flex select-none items-center justify-center gap-2 font-semibold ' +
  'transition-[background-color,border-color,color,box-shadow,scale] duration-[120ms] ease-out ' +
  'active:scale-[0.97] motion-reduce:active:scale-100 ' +
  'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50'

export const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-action-primary text-on-action shadow-raised hover:bg-action-primary-hover active:bg-action-primary-pressed',
  secondary: 'border border-line-strong bg-surface-raised text-ink shadow-raised hover:border-slate-400 hover:bg-surface-sunken active:bg-slate-200/70',
  quiet: 'text-ink-secondary hover:bg-surface-sunken hover:text-ink active:bg-slate-200/70',
  danger: 'border border-danger-200 bg-surface-raised text-danger-700 shadow-raised hover:bg-danger-50 active:bg-danger-100',
}

export const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 py-2 text-sm lg:min-h-9',
  md: 'min-h-11 px-4 py-2.5 text-sm',
  lg: 'min-h-12 px-5 py-3 text-base',
}

interface ButtonStyleOptions {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  shape?: ButtonShape
  className?: string
}

/** Class list for anything that should look like a Button (links included). */
export function buttonClasses({ variant = 'primary', size = 'md', fullWidth = false, shape = 'default', className = '' }: ButtonStyleOptions = {}) {
  return `${base} ${SHAPES[shape]} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${fullWidth ? 'w-full' : ''} ${className}`.replace(/\s+/g, ' ').trim()
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  shape?: ButtonShape
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, className = '', variant = 'primary', size = 'md', fullWidth = false, shape = 'default', type = 'button', ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} data-variant={variant} className={buttonClasses({ variant, size, fullWidth, shape, className })} {...props}>
      {children}
    </button>
  )
})

interface LinkButtonProps extends LinkProps {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  shape?: ButtonShape
}

/** A router link styled as a Button. Use for navigation; use Button for actions. */
export function LinkButton({ children, className = '', variant = 'primary', size = 'md', fullWidth = false, shape = 'default', ...props }: LinkButtonProps) {
  return (
    <Link data-variant={variant} className={buttonClasses({ variant, size, fullWidth, shape, className })} {...props}>
      {children}
    </Link>
  )
}

interface AnchorButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  shape?: ButtonShape
}

/** An external link styled as a Button. */
export function AnchorButton({ children, className = '', variant = 'secondary', size = 'md', fullWidth = false, shape = 'default', ...props }: AnchorButtonProps) {
  return (
    <a data-variant={variant} className={buttonClasses({ variant, size, fullWidth, shape, className })} {...props}>
      {children}
    </a>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  children: ReactNode
  variant?: 'quiet' | 'secondary' | 'danger'
  /** sm is 36px on desktop toolbars only; touch keeps 44px. */
  size?: 'sm' | 'md'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, className = '', variant = 'quiet', size = 'md', type = 'button', ...props },
  ref,
) {
  const sizeClass = size === 'sm' ? 'h-11 w-11 lg:h-9 lg:w-9' : 'h-11 w-11'
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      data-variant={variant}
      className={`${base} rounded-xl shrink-0 ${sizeClass} ${BUTTON_VARIANTS[variant]} ${className}`.replace(/\s+/g, ' ').trim()}
      {...props}
    >
      {children}
    </button>
  )
})
