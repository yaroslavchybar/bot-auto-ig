import { dark } from '@clerk/themes'

export const clerkAppearance = {
    baseTheme: dark,
    variables: {
        colorPrimary: '#ef4444', // Red-500 for brand
        colorBackground: '#0a0a0a', // Deep modal background
        colorInputBackground: 'rgba(0, 0, 0, 0.5)', // bg-black/50
        colorInputText: '#f4f4f5',
        colorText: '#e5e7eb',
        colorTextSecondary: '#9ca3af',
        colorDanger: '#ef4444',
        borderRadius: '0.5rem', // Rounded-lg
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    },
    layout: {
        socialButtonsVariant: 'blockButton' as const,
        logoPlacement: 'none' as const, // Remove logo for a denser look
    },
    elements: {
        rootBox: 'font-sans text-[11px]', // Base typography for all Clerk components
        cardBox: 'bg-[#0a0a0a] border border-white/10 shadow-none rounded-2xl max-h-[700px] h-[75vh]', // Dark modal wrapper with custom height
        card: 'bg-transparent shadow-none',
        headerTitle: 'bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent font-bold uppercase tracking-wider text-[12px]',
        headerSubtitle: 'text-gray-400 text-[11px]',
        formButtonPrimary: 'bg-gradient-to-r from-red-600 to-orange-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)] hover:shadow-[0_0_25px_rgba(239,68,68,0.6)] font-medium rounded-lg text-[11px] h-7 px-3 py-0 border-none transition-all',
        formButtonReset: 'text-gray-400 hover:text-gray-200 text-[11px] transition-colors',
        formFieldLabel: 'text-gray-400 font-medium tracking-wider text-[10px] mb-1',
        formFieldInput: 'bg-black/50 border border-white/10 text-white focus:border-red-500 focus:ring-1 focus:ring-red-500/50 rounded-lg text-[11px] h-7 px-2 transition-colors',
        footerActionLink: 'text-gray-300 hover:text-white transition-colors font-medium text-[11px]',
        socialButtonsBlockButton: 'bg-transparent border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white rounded-lg text-[11px] h-7 transition-all',
        socialButtonsBlockButtonText: 'font-medium',
        dividerLine: 'bg-white/10',
        dividerText: 'text-gray-500 text-[10px] uppercase tracking-wider',
        identityPreview: 'bg-black/50 border border-white/10 rounded-lg p-2',
        identityPreviewText: 'text-gray-300 text-[11px]',
        identityPreviewEditButton: 'text-gray-400 hover:text-white transition-colors',
        formFieldInputShowPasswordButton: 'text-gray-400 hover:text-gray-200 transition-colors',
        alertText: 'text-red-400 text-[11px]',
        formFieldSuccessText: 'text-green-400 text-[11px]',
        formFieldErrorText: 'text-red-400 text-[11px]',
        footer: 'hidden', // Keep hidden if we don't want footer
        // Profile page specific elements
        profileSectionTitle: 'text-gray-400 font-bold uppercase tracking-wider text-[10px] border-b border-white/10 pb-1 mb-2',
        profileSectionPrimaryButton: 'text-gray-300 hover:text-white transition-colors text-[11px] font-medium',
        profilePage: 'bg-[#0a0a0a]',
        badge: 'bg-white/5 border-white/10 text-gray-300 text-[9px] uppercase tracking-wider rounded-lg',
        navbar: 'bg-[#0a0a0a] border-r border-white/10', // Sidebar of the profile modal
        navbarButton: 'text-gray-400 text-[11px] hover:bg-white/5 hover:text-gray-200 rounded-lg transition-all data-[active=true]:bg-white/10 data-[active=true]:text-white data-[active=true]:border-l-2 data-[active=true]:border-red-500',
        navbarMobileMenuButton: 'text-gray-400 hover:text-gray-200',
        activeDeviceIcon: 'text-red-500',
        menuButton: 'text-gray-400 hover:text-gray-200',
        menuList: 'bg-[#0a0a0a] border border-white/10 rounded-lg',
        menuItem: 'text-[11px] text-gray-300 hover:bg-white/10 rounded-lg transition-colors',
        button: 'text-[11px] rounded-lg', // General buttons
        avatarImageActionsUpload: 'text-gray-300 hover:text-white transition-colors text-[11px]',
        avatarImageActionsRemove: 'text-red-500 hover:text-red-400 text-[11px]',
        userPreviewSecondaryIdentifier: 'text-gray-500 text-[10px]',
        breadcrumbsItem: 'text-[11px]',
        breadcrumbsItemDivider: 'text-[11px]',
        scrollBox: 'bg-transparent',
    }
}
