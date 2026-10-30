<svelte:head>
    <title>Tournoi des Maisons - Clicker</title>
    <script src="https://cdn.tailwindcss.com"></script>
</svelte:head>

<script>
    import { onDestroy, onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { supabase } from '../lib/supabaseClient';
    import { clearPlayerEmail, findPlayerByEmail, getSavedPlayerEmail } from '../lib/playerSession';
    import {
        fetchActiveFamilyPlayers,
        fetchClickerSettings,
        fetchTeamScores,
        recordClick,
        subscribeToClickerScores
    } from '../lib/games/clicker';

    /**
     * @typedef {{
     *   id: string | number,
     *   name: string | null,
     *   group: { id: string | number, name: string } | null
     * }} Player
     */
    /** @type {Player | null} */
    let currentPlayer = $state(null);
    /** @type {{ id: string | number, name: string } | null} */
    let playerGroup = $state(null);
    /** @type {Array<{ id: string | number, name: string, clicks: number }>} */
    let leaderboard = $state([]);
    /** @type {import('@supabase/supabase-js').RealtimeChannel | undefined} */
    let clickSubscription;

    // États du jeu
    let isLoading = $state(true);
    let isMobile = $state(true);
    let isDebugMode = $state(false);
    let authError = $state('');
    let clickErrorMessage = $state('');
    let settingsWarning = $state('');
    let totalClicks = $state(0);
    let clicksSinceBonus = $state(0);
    let nextBonusAt = $state(30);
    let familyExtraRemainder = 0;
    let familyCoefficientPerPlayer = 1.1;
    let activeFamilyPlayerCount = $state(0);
    let activeFamilyPlayerIds = new Set();
    /** @type {number} */
    let familyMultiplier = $derived(
        activeFamilyPlayerCount > 0
            ? Math.pow(familyCoefficientPerPlayer, activeFamilyPlayerCount)
            : 1
    );
    let bonusMinClicks = 30;
    let bonusMaxClicks = 60;
    let bonusMessage = $state('');
    /** @type {Array<{ id: number, left: number, top: number, rotation: number }>} */
    let clickParticles = $state([]);
    /** @type {ReturnType<typeof setTimeout>[]} */
    let particleTimeouts = [];
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let leaderboardTimeout;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let bonusMessageTimeout;
    let nextParticleId = 0;

    // Thèmes visuels des maisons
    const houseStyles = {
        'athena': { 
            bg: 'bg-slate-900', 
            border: 'border-blue-500', 
            text: 'text-blue-400', 
            btn: 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 shadow-blue-500/20' 
        },
        'hephaistos': { 
            bg: 'bg-red-950', 
            border: 'border-red-600', 
            text: 'text-red-400', 
            btn: 'bg-red-600 hover:bg-red-500 active:bg-red-700 shadow-red-500/20' 
        },
        'promethee': { 
            bg: 'bg-emerald-950', 
            border: 'border-emerald-600', 
            text: 'text-emerald-400', 
            btn: 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 shadow-emerald-500/20' 
        },
        'default': { 
            bg: 'bg-amber-950', 
            border: 'border-amber-600', 
            text: 'text-amber-400', 
            btn: 'bg-amber-600 hover:bg-amber-500 active:bg-amber-700 shadow-amber-500/20' 
        }
    };

    /** @param {string | null | undefined} groupName */
    function getHouseStyle(groupName) {
        if (!groupName) return houseStyles.default;
        const name = groupName.toLowerCase();
        if (name.includes('ath')) return houseStyles.athena;
        if (name.includes('hep') || name.includes('hép')) return houseStyles.hephaistos;
        if (name.includes('prom')) return houseStyles.promethee;
        return houseStyles.default;
    }

    onMount(async () => {
        await checkDebugMode();

        const userAgent = navigator.userAgent || navigator.vendor || '';
        const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
        const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        
        isMobile = isMobileUA && hasTouch;

        await restorePlayerSession();
    });

    onDestroy(() => {
        if (clickSubscription) supabase.removeChannel(clickSubscription);
        if (leaderboardTimeout) window.clearTimeout(leaderboardTimeout);
        if (bonusMessageTimeout) window.clearTimeout(bonusMessageTimeout);
        particleTimeouts.forEach((timeout) => window.clearTimeout(timeout));
    });

    async function checkDebugMode() {
        try {
            const { data, error } = await supabase
                .from('debug')
                .select('is_debug');

            if (!error && data && data.length > 0) {
                isDebugMode = data.some(/** @param {{ is_debug: boolean | string }} row */ (row) =>
                    row.is_debug === true || row.is_debug === 'true' || row.is_debug === 'TRUE'
                );
            }
        } catch (err) {
            console.error("Erreur vérification debug :", err);
        }
    }

    async function restorePlayerSession() {
        const savedEmail = getSavedPlayerEmail();
        if (!savedEmail) {
            await goto('/login', { replaceState: true });
            return;
        }

        const { player, error } = await findPlayerByEmail(savedEmail);
        if (error) {
            authError = "Impossible de vérifier la session. Réessayez.";
            isLoading = false;
            return;
        }

        if (!player) {
            clearPlayerEmail();
            await goto('/login', { replaceState: true });
            return;
        }

        currentPlayer = player;
        playerGroup = player.group;

        const { data: settings, error: settingsError } = await fetchClickerSettings();
        if (settingsError) {
            console.error('Réglages bonus Supabase indisponibles :', settingsError);
            settingsWarning = 'Réglages Supabase indisponibles : seuil 30–60 et coefficient ×1,1 par défaut.';
        } else if (settings) {
            const minClicks = Number(settings.bonus_min_clicks);
            const maxClicks = Number(settings.bonus_max_clicks);
            const coefficient = Number(settings.family_coefficient_per_player);

            if (
                Number.isInteger(minClicks) &&
                Number.isInteger(maxClicks) &&
                minClicks > 0 &&
                maxClicks >= minClicks &&
                Number.isFinite(coefficient) &&
                coefficient >= 1
            ) {
                bonusMinClicks = minClicks;
                bonusMaxClicks = maxClicks;
                familyCoefficientPerPlayer = coefficient;
            } else {
                settingsWarning = 'Réglages bonus invalides dans clicker_game_settings.';
            }
        }

        const { count, error: countError } = await supabase
            .from('ClickerCompetition')
            .select('id', { count: 'exact', head: true })
            .eq('author_id', player.id);
        if (countError) {
            console.error('Impossible de charger le score du joueur :', countError);
        }
        totalClicks = count ?? 0;

        const progressKey = `clicker_bonus_progress_${player.id}`;
        let savedProgress = null;
        try {
            const storedProgress = localStorage.getItem(progressKey);
            savedProgress = storedProgress ? JSON.parse(storedProgress) : null;
        } catch (error) {
            console.warn('Progression du bonus invalide, elle sera réinitialisée :', error);
        }

        if (
            Number.isInteger(savedProgress?.clicksSinceBonus) &&
            Number.isInteger(savedProgress?.nextBonusAt) &&
            savedProgress.nextBonusAt > 0
        ) {
            clicksSinceBonus = savedProgress.clicksSinceBonus;
            nextBonusAt = savedProgress.nextBonusAt;
            familyExtraRemainder = Number.isFinite(savedProgress.familyExtraRemainder)
                ? savedProgress.familyExtraRemainder
                : 0;
        } else {
            clicksSinceBonus = 0;
            nextBonusAt = randomBonusInterval();
        }

        await refreshActiveFamilyPlayers();
        clickSubscription = subscribeToClickerScores('public:ClickerCompetition', scheduleLeaderboardRefresh);
        await refreshLeaderboard();
        isLoading = false;
    }

    async function handleClick() {
        if (!currentPlayer) return;

        clickErrorMessage = '';
        animateClick();
        const player = currentPlayer;
        recordPlayerClick(player);
    }

    /** @param {KeyboardEvent} event */
    function preventEnterRepeat(event) {
        if (event.key === 'Enter' && event.repeat) {
            event.preventDefault();
        }
    }

    /**
     * @param {Player} player
     */
    async function recordPlayerClick(player) {
        const nextClickCount = clicksSinceBonus + 1;
        const bonusTriggered = nextClickCount >= nextBonusAt;
        const nextClicksSinceBonus = bonusTriggered ? 0 : nextClickCount;
        const nextBonusTarget = bonusTriggered ? randomBonusInterval() : nextBonusAt;
        const playerId = String(player.id);
        const firstActiveClick = playerGroup !== null && !activeFamilyPlayerIds.has(playerId);
        const membersForClick = activeFamilyPlayerCount + (firstActiveClick ? 1 : 0);
        const coefficientForClick = membersForClick > 0
            ? Math.pow(familyCoefficientPerPlayer, membersForClick)
            : 1;
        const accumulatedRemainder = familyExtraRemainder + coefficientForClick - 1;
        const familyExtraClicks = Math.floor(accumulatedRemainder + 1e-9);
        const nextFamilyRemainder = accumulatedRemainder - familyExtraClicks;
        const extraClicks = familyExtraClicks + (bonusTriggered ? 1 : 0);

        clicksSinceBonus = nextClicksSinceBonus;
        nextBonusAt = nextBonusTarget;
        familyExtraRemainder = nextFamilyRemainder;
        totalClicks += 1 + extraClicks;

        if (firstActiveClick) {
            activeFamilyPlayerIds = new Set([...activeFamilyPlayerIds, playerId]);
            activeFamilyPlayerCount = activeFamilyPlayerIds.size;
        }

        try {
            localStorage.setItem(
                `clicker_bonus_progress_${player.id}`,
                JSON.stringify({ clicksSinceBonus, nextBonusAt, familyExtraRemainder })
            );
        } catch (storageError) {
            console.warn('Impossible de sauvegarder la progression du joueur :', storageError);
        }

        const { error } = await recordClick(player.id, extraClicks);
        if (error) {
            console.error('Erreur enregistrement clic :', error);
            clickErrorMessage = `Clic non enregistré : ${error.message}`;
            await refreshActiveFamilyPlayers();
            return;
        }

        if (extraClicks > 0) {
            bonusMessage = `BONUS +${extraClicks} CLIC${extraClicks > 1 ? 'S' : ''} !`;
            if (bonusMessageTimeout) window.clearTimeout(bonusMessageTimeout);
            bonusMessageTimeout = window.setTimeout(() => {
                bonusMessage = '';
                bonusMessageTimeout = undefined;
            }, 1500);
        }

        scheduleLeaderboardRefresh();
    }

    async function refreshActiveFamilyPlayers() {
        const { playerIds, error } = await fetchActiveFamilyPlayers(playerGroup?.id);
        if (error) {
            console.error('Impossible de compter les joueurs actifs de la famille :', error);
            return;
        }

        activeFamilyPlayerIds = playerIds;
        activeFamilyPlayerCount = playerIds.size;
    }

    function randomBonusInterval() {
        return Math.floor(Math.random() * (bonusMaxClicks - bonusMinClicks + 1)) + bonusMinClicks;
    }

    function animateClick() {
        const newParticles = Array.from({ length: 7 }, () => ({
            id: ++nextParticleId,
            left: 20 + Math.random() * 60,
            top: 20 + Math.random() * 60,
            rotation: Math.round(Math.random() * 120 - 60)
        }));
        clickParticles = [...clickParticles, ...newParticles];

        const particleIds = newParticles.map((particle) => particle.id);
        const timeout = window.setTimeout(() => {
            clickParticles = clickParticles.filter((particle) => !particleIds.includes(particle.id));
            particleTimeouts = particleTimeouts.filter((timer) => timer !== timeout);
        }, 750);
        particleTimeouts.push(timeout);
    }

    async function refreshLeaderboard() {
        leaderboard = await fetchTeamScores();
    }

    function scheduleLeaderboardRefresh() {
        if (leaderboardTimeout) window.clearTimeout(leaderboardTimeout);
        leaderboardTimeout = window.setTimeout(() => {
            leaderboardTimeout = undefined;
            refreshLeaderboard();
            refreshActiveFamilyPlayers();
        }, 200);
    }

    async function logout() {
        clearPlayerEmail();
        currentPlayer = null;
        playerGroup = null;
        await goto('/login', { replaceState: true });
    }
</script>

<main class="min-h-screen bg-slate-950 text-slate-100 max-w-md mx-auto p-4 pb-20 flex flex-col justify-between font-sans relative">

    {#if isLoading}
        <div class="my-auto text-center text-slate-400 font-medium">
            Chargement de l'arène...
        </div>

    {:else if !isMobile && !isDebugMode}
        <!-- Blocage PC -->
        <div class="my-auto bg-slate-900 border-2 border-red-500/80 rounded-2xl p-6 text-center shadow-2xl space-y-4">
            <div class="text-6xl">🏛️</div>
            <h1 class="text-2xl font-black text-red-400 tracking-wider uppercase">Accès Restreint</h1>
            <p class="text-slate-300 text-sm leading-relaxed">
                L'arène est réservée exclusivement aux joueurs sur <strong>Smartphone ou Tablette</strong>.
            </p>
        </div>

    {:else if authError}
        <div role="alert" class="my-auto bg-slate-900 border border-red-500/50 rounded-2xl p-6 text-center space-y-3">
            <p class="text-red-300 text-sm">{authError}</p>
            <button onclick={() => location.reload()} class="text-amber-400 underline text-sm">Réessayer</button>
        </div>

    {:else if !currentPlayer}
        <div class="my-auto text-center text-slate-400">Redirection vers la connexion...</div>

    {:else}
        {@const style = getHouseStyle(playerGroup?.name)}

        <div class="space-y-4">
            <!-- 1. CLASSEMENT ÉQUIPES (HAUT) -->
            <section class="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
                <h3 class="text-amber-400 font-bold uppercase text-center text-xs tracking-wider mb-3 flex items-center justify-center gap-2">
                    🏆 Classement des Équipes
                </h3>

                <div class="space-y-2">
                    {#each leaderboard as group, index}
                        {@const gStyle = getHouseStyle(group.name)}
                        <div class={`flex items-center justify-between p-2.5 rounded-xl border transition ${group.id === playerGroup?.id ? `${gStyle.bg} ${gStyle.border} ring-1 ring-amber-400/50` : 'bg-slate-950/60 border-slate-800'}`}>
                            <div class="flex items-center space-x-3">
                                <span class="font-bold text-slate-500 w-5 text-center text-xs">
                                    #{index + 1}
                                </span>
                                <span class="font-semibold text-xs text-slate-200">
                                    {group.name}
                                </span>
                            </div>
                            <div class="font-mono font-bold text-amber-400 text-xs">
                                {group.clicks} <span class="text-[10px] text-slate-500 font-normal">pts</span>
                            </div>
                        </div>
                    {/each}
                </div>
            </section>

            <!-- EN-TÊTE JOUEUR -->
            <header class="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex items-center justify-between shadow-lg">
                <div>
                    <p class="text-[9px] text-slate-400 uppercase tracking-widest font-bold">Joueur</p>
                    <h2 class="font-bold text-sm text-white">{currentPlayer.name}</h2>
                </div>
                
                <div class="text-right">
                    <span class={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${style.bg} ${style.border} ${style.text}`}>
                        {playerGroup?.name || 'Sans Équipe'}
                    </span>
                    <button onclick={logout} class="block text-right text-[10px] text-slate-400 hover:text-slate-200 mt-1 underline ml-auto">
                        Déconnexion
                    </button>
                </div>
            </header>
        </div>

        <!-- 2. BOUTON CIRCULAIRE (CENTRE) -->
        <section class="my-auto py-6 text-center flex flex-col items-center justify-center">
            <button 
                onclick={handleClick}
                onkeydown={preventEnterRepeat}
                style={`--heat: ${Math.min(totalClicks / 200, 0.7)};`}
                class={`heat-button relative w-52 h-52 rounded-full border-4 ${style.border} ${style.btn} text-white text-2xl font-black uppercase tracking-widest shadow-2xl transform active:scale-90 transition-all flex flex-col items-center justify-center space-y-2 hover:scale-105`}
            >
                {#each clickParticles as particle (particle.id)}
                    <span
                        aria-hidden="true"
                        class="click-spark"
                        style={`left: ${particle.left}%; top: ${particle.top}%; --rotation: ${particle.rotation}deg;`}
                    >✦</span>
                {/each}
                <span class="text-5xl">⚡</span>
                <span>CLIQUER !</span>
            </button>
            <p class="text-[11px] text-slate-400 mt-4 font-medium">
                Famille : {activeFamilyPlayerCount} joueur{activeFamilyPlayerCount === 1 ? '' : 's'} actif{activeFamilyPlayerCount === 1 ? '' : 's'} · ×{familyMultiplier.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}
            </p>
            {#if bonusMessage}
                <p class="text-sm font-bold text-amber-300 mt-2 animate-pulse">
                    ✨ {bonusMessage}
                </p>
            {/if}
            {#if clickErrorMessage}
                <p role="alert" class="text-xs text-red-400 mt-2">{clickErrorMessage}</p>
            {/if}
            {#if settingsWarning}
                <p class="text-[10px] text-amber-400 mt-2">{settingsWarning}</p>
            {/if}
        </section>

        <!-- 3. BARRE DE NAVIGATION (BAS) -->
        <nav class="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-slate-900/95 backdrop-blur border-t border-slate-800 px-6 py-2.5 flex justify-around items-center z-50">
            <a href="/" class="flex flex-col items-center text-amber-400 font-bold text-[11px]">
                <span class="text-xl">⚡</span>
                <span>Jeu</span>
            </a>
            <a href="/scores" class="flex flex-col items-center text-slate-400 hover:text-amber-400 font-medium text-[11px] transition">
                <span class="text-xl">👤</span>
                <span>Joueurs</span>
            </a>
            <a href="/maisons" class="flex flex-col items-center text-slate-400 hover:text-amber-400 font-medium text-[11px] transition">
                <span class="text-xl">🏆</span>
                <span>Maisons</span>
            </a>
        </nav>
    {/if}

</main>

<style>
    .heat-button {
        background-image: linear-gradient(
            rgba(239, 68, 68, var(--heat)),
            rgba(239, 68, 68, var(--heat))
        );
        filter: saturate(calc(1 + var(--heat)));
    }

    .click-spark {
        position: absolute;
        z-index: 1;
        color: #fde68a;
        font-size: 1.25rem;
        pointer-events: none;
        animation: spark-rise 700ms ease-out forwards;
    }

    @keyframes spark-rise {
        0% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.3) rotate(0);
        }
        20% {
            opacity: 1;
        }
        100% {
            opacity: 0;
            transform: translate(calc(-50% + 16px), calc(-50% - 42px)) scale(1.3) rotate(var(--rotation));
        }
    }
</style>