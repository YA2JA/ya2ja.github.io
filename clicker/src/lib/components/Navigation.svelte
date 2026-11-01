<script>
    import { page } from '$app/state';

    const navItems = [
        { href: '/', label: 'Jeu', icon: '⚡' },
        { href: '/scores', label: 'Joueurs', icon: '👤' },
        { href: '/maisons', label: 'Maisons', icon: '🏆' }
    ];
</script>

<nav class="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-slate-900/95 backdrop-blur border-t border-slate-800 px-6 py-2.5 flex justify-around items-center z-50">
    {#each navItems as item}
        {@const isActive = page.url.pathname === item.href}
        <a
            href={item.href}
            class="flex flex-col items-center font-medium text-[11px] transition {isActive ? 'text-amber-400 font-bold' : 'text-slate-400 hover:text-amber-400'}"
            aria-current={isActive ? 'page' : undefined}
        >
            <span class="text-xl">{item.icon}</span>
            <span>{item.label}</span>
        </a>
    {/each}
</nav>
