import { dark, shadcn } from '@clerk/themes'
import type { ThemePreference } from '@/hooks/use-theme'

export function getClerkAppearance(theme: ThemePreference) {
  return {
    baseTheme: theme === 'dark' ? dark : shadcn,
    variables: {
      colorPrimary: 'var(--primary)',
      colorBackground: 'var(--panel)',
      colorInputBackground: 'var(--field)',
      colorInputText: 'var(--ink)',
      colorText: 'var(--copy)',
      colorTextSecondary: 'var(--muted-copy)',
      colorDanger: 'var(--status-danger)',
      borderRadius: '0.75rem',
      fontFamily:
        'geistNumbers, "Suisse Intl", Suisse, Inter, "Segoe UI", system-ui, sans-serif',
    },
    layout: {
      socialButtonsVariant: 'blockButton' as const,
      logoPlacement: 'none' as const,
    },
    elements: {
      rootBox: 'font-sans text-[11px]',
      cardBox:
        'bg-panel border border-line shadow-none rounded-2xl max-h-[700px] h-[75vh]',
      card: 'bg-transparent shadow-none',
      headerTitle:
        'page-title-gradient font-bold uppercase tracking-wider text-[12px]',
      headerSubtitle: 'text-muted-copy text-[11px]',
      formButtonPrimary:
        'brand-button font-medium rounded-lg text-[11px] h-7 px-3 py-0',
      formButtonReset:
        'text-muted-copy hover:text-ink text-[11px] transition-colors',
      formFieldLabel:
        'text-muted-copy font-medium tracking-wider text-[10px] mb-1',
      formFieldInput:
        'brand-focus bg-field border border-line text-ink rounded-lg text-[11px] h-7 px-2 transition-colors',
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
      formFieldInputShowPasswordButton:
        'text-muted-copy hover:text-ink transition-colors',
      alertText: 'text-status-danger text-[11px]',
      formFieldSuccessText: 'text-status-success text-[11px]',
      formFieldErrorText: 'text-status-danger text-[11px]',
      footer: 'hidden',
      profileSectionTitle:
        'text-muted-copy font-bold uppercase tracking-wider text-[10px] border-b border-line pb-1 mb-2',
      profileSectionPrimaryButton:
        'text-copy hover:text-ink transition-colors text-[11px] font-medium',
      profilePage: 'bg-panel',
      badge:
        'bg-panel-muted border-line text-copy text-[9px] uppercase tracking-wider rounded-lg',
      navbar: 'bg-panel border-r border-line',
      navbarButton:
        'text-muted-copy text-[11px] hover:bg-panel-muted hover:text-ink rounded-lg transition-all data-[active=true]:bg-panel-hover data-[active=true]:text-ink data-[active=true]:border-l-2 data-[active=true]:border-line-strong',
      navbarMobileMenuButton: 'text-muted-copy hover:text-ink',
      activeDeviceIcon: 'text-status-danger',
      menuButton: 'text-muted-copy hover:text-ink',
      menuList: 'bg-panel border border-line rounded-lg',
      menuItem:
        'text-[11px] text-copy hover:bg-panel-hover rounded-lg transition-colors',
      button: 'text-[11px] rounded-lg',
      avatarImageActionsUpload:
        'text-copy hover:text-ink transition-colors text-[11px]',
      avatarImageActionsRemove:
        'text-status-danger hover:text-status-danger text-[11px]',
      userPreviewSecondaryIdentifier: 'text-subtle-copy text-[10px]',
      breadcrumbsItem: 'text-[11px]',
      breadcrumbsItemDivider: 'text-[11px]',
      scrollBox: 'bg-transparent',
    },
  }
}


