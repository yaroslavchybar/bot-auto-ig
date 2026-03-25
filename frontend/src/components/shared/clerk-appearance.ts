import { dark, shadcn } from '@clerk/themes'
import type { ThemePreference } from '@/hooks/use-theme'

const clerkVariables = {
  colorPrimary: 'var(--button-brand-border)',
  colorPrimaryForeground: 'var(--button-positive-foreground)',
  colorBackground: 'var(--panel)',
  colorForeground: 'var(--copy)',
  colorMutedForeground: 'var(--muted-copy)',
  colorInput: 'var(--field)',
  colorInputForeground: 'var(--ink)',
  colorDanger: 'var(--status-danger)',
  colorBorder: 'var(--line)',
  colorRing: 'var(--ring)',
  colorModalBackdrop: 'var(--overlay-strong)',
  borderRadius: '0.75rem',
  fontFamily:
    'geistNumbers, "Suisse Intl", Suisse, Inter, "Segoe UI", system-ui, sans-serif',
}

const clerkLayout = {
  socialButtonsVariant: 'blockButton' as const,
  logoPlacement: 'none' as const,
}

function getClerkFormElements() {
  return {
    formButtonPrimary:
      'brand-button font-medium rounded-lg text-[11px] h-7 px-3 py-0',
    formButtonReset:
      'text-muted-copy hover:text-ink text-[11px] transition-colors',
    formFieldLabel:
      'text-muted-copy font-medium tracking-wider text-[10px] mb-1',
    formFieldInput:
      'brand-focus bg-field border border-line text-ink rounded-lg text-[11px] h-7 px-2 transition-colors',
    formFieldSuccessText: 'text-status-success text-[11px]',
    formFieldErrorText: 'text-status-danger text-[11px]',
    formFieldInputShowPasswordButton:
      'text-muted-copy hover:text-ink transition-colors',
  }
}

function getClerkNavElements() {
  return {
    navbar: 'bg-panel border-r border-line',
    navbarButton:
      'text-muted-copy text-[11px] hover:bg-panel-muted hover:text-ink rounded-lg transition-all data-[active=true]:bg-panel-hover data-[active=true]:text-ink data-[active=true]:border-l-2 data-[active=true]:border-line-strong',
    navbarMobileMenuButton: 'text-muted-copy hover:text-ink',
  }
}

function getClerkProfileElements() {
  return {
    profileSectionTitle:
      'text-muted-copy font-bold uppercase tracking-wider text-[10px] border-b border-line pb-1 mb-2',
    profileSectionPrimaryButton:
      'text-copy hover:text-ink transition-colors text-[11px] font-medium',
    profilePage: 'bg-panel',
    avatarImageActionsUpload:
      'text-copy hover:text-ink transition-colors text-[11px]',
    avatarImageActionsRemove:
      'text-status-danger hover:text-status-danger text-[11px]',
    userPreviewSecondaryIdentifier: 'text-subtle-copy text-[10px]',
  }
}

function getClerkBaseElements() {
  return {
    rootBox: 'font-sans text-[11px]',
    cardBox:
      'bg-panel border border-line shadow-none rounded-2xl max-h-[700px] h-[75vh]',
    card: 'bg-transparent shadow-none',
    headerTitle:
      'page-title-gradient font-bold uppercase tracking-wider text-[12px]',
    headerSubtitle: 'text-muted-copy text-[11px]',
    footerActionLink: 'brand-link transition-colors font-medium text-[11px]',
    socialButtonsBlockButton:
      'button-neutral rounded-lg text-[11px] h-7 transition-all',
    socialButtonsBlockButtonText: 'font-medium',
    dividerLine: 'bg-panel-hover',
    dividerText: 'text-subtle-copy text-[10px] uppercase tracking-wider',
    identityPreview: 'bg-field border border-line rounded-lg p-2',
    identityPreviewText: 'text-copy text-[11px]',
    identityPreviewEditButton:
      'text-muted-copy hover:text-ink transition-colors',
    alertText: 'text-status-danger text-[11px]',
    footer: 'hidden',
    badge:
      'bg-panel-muted border-line text-copy text-[9px] uppercase tracking-wider rounded-lg',
    activeDeviceIcon: 'text-status-danger',
    menuButton: 'text-muted-copy hover:text-ink',
    menuList: 'bg-panel border border-line rounded-lg',
    menuItem:
      'text-[11px] text-copy hover:bg-panel-hover rounded-lg transition-colors',
    button: 'text-[11px] rounded-lg',
    breadcrumbsItem: 'text-[11px]',
    breadcrumbsItemDivider: 'text-[11px]',
    scrollBox: 'bg-transparent',
  }
}

export function getClerkAppearance(theme: ThemePreference) {
  return {
    baseTheme: theme === 'dark' ? dark : shadcn,
    variables: clerkVariables,
    layout: clerkLayout,
    elements: {
      ...getClerkBaseElements(),
      ...getClerkFormElements(),
      ...getClerkNavElements(),
      ...getClerkProfileElements(),
    },
  }
}
