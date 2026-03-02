import { dark } from '@clerk/themes'

export const clerkAppearance = {
    baseTheme: dark,
    variables: {
        colorPrimary: '#2563eb', // Blue-600 for a more standard utilitarian active color
        colorBackground: '#121212', // Match the dense dark theme background
        colorInputBackground: '#1e1e1e', // Slightly lighter for inputs
        colorInputText: '#f4f4f5',
        colorText: '#e5e5e5',
        colorTextSecondary: '#a1a1aa',
        colorDanger: '#ef4444',
        borderRadius: '2px', // Square-ish corners for classic desktop feel
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    },
    layout: {
        socialButtonsVariant: 'blockButton' as const,
        logoPlacement: 'none' as const, // Remove logo for a denser look
    },
    elements: {
        rootBox: 'font-sans text-[11px]', // Base typography for all Clerk components
        cardBox: 'bg-[#121212] border border-neutral-700 shadow-none rounded-[2px]', // Flat window look
        card: 'bg-transparent shadow-none',
        headerTitle: 'text-neutral-200 font-bold uppercase tracking-wider text-[12px]',
        headerSubtitle: 'text-neutral-400 text-[11px]',
        formButtonPrimary: 'bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-[2px] text-[11px] h-7 px-3 py-0 transition-none',
        formButtonReset: 'text-neutral-400 hover:text-neutral-200 text-[11px]',
        formFieldLabel: 'text-neutral-400 font-bold uppercase tracking-wider text-[10px] mb-1',
        formFieldInput: 'bg-[#1e1e1e] border-neutral-700 text-neutral-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-[2px] text-[11px] h-7 px-2 transition-none',
        footerActionLink: 'text-blue-500 hover:text-blue-400 font-medium text-[11px]',
        socialButtonsBlockButton: 'bg-[#1e1e1e] border-neutral-700 text-neutral-300 hover:bg-neutral-800 rounded-[2px] text-[11px] h-7 transition-none',
        socialButtonsBlockButtonText: 'font-normal',
        dividerLine: 'bg-neutral-700',
        dividerText: 'text-neutral-500 text-[10px] uppercase tracking-wider',
        identityPreview: 'bg-[#1e1e1e] border border-neutral-700 rounded-[2px] p-2',
        identityPreviewText: 'text-neutral-300 text-[11px]',
        identityPreviewEditButton: 'text-blue-500 hover:text-blue-400',
        formFieldInputShowPasswordButton: 'text-neutral-400 hover:text-neutral-200',
        alertText: 'text-red-400 text-[11px]',
        formFieldSuccessText: 'text-green-400 text-[11px]',
        formFieldErrorText: 'text-red-400 text-[11px]',
        footer: 'hidden', // Keep hidden if we don't want footer
        // Profile page specific elements
        profileSectionTitle: 'text-neutral-400 font-bold uppercase tracking-wider text-[10px] border-b border-neutral-800 pb-1 mb-2',
        profileSectionPrimaryButton: 'text-blue-500 hover:text-blue-400 text-[11px] font-medium transition-none',
        profilePage: 'bg-[#121212]',
        badge: 'bg-neutral-800 border-neutral-700 text-neutral-300 test-[9px] uppercase tracking-wider rounded-[2px]',
        navbar: 'bg-neutral-900 border-r border-neutral-800', // Sidebar of the profile modal
        navbarButton: 'text-neutral-400 text-[11px] hover:bg-neutral-800 hover:text-neutral-200 rounded-[2px] transition-none data-[active=true]:bg-blue-900/30 data-[active=true]:text-blue-400 data-[active=true]:border-l-2 data-[active=true]:border-blue-500',
        navbarMobileMenuButton: 'text-neutral-400 hover:text-neutral-200',
        activeDeviceIcon: 'text-blue-500',
        menuButton: 'text-neutral-400 hover:text-neutral-200',
        menuList: 'bg-[#1e1e1e] border border-neutral-700 rounded-[2px]',
        menuItem: 'text-[11px] text-neutral-300 hover:bg-neutral-800 rounded-[2px]',
        button: 'text-[11px] rounded-[2px]', // General buttons
        avatarImageActionsUpload: 'text-blue-500 hover:text-blue-400 text-[11px]',
        avatarImageActionsRemove: 'text-red-500 hover:text-red-400 text-[11px]',
        userPreviewSecondaryIdentifier: 'text-neutral-500 text-[10px]',
        breadcrumbsItem: 'text-[11px]',
        breadcrumbsItemDivider: 'text-[11px]',
        scrollBox: 'bg-transparent',
    }
}
