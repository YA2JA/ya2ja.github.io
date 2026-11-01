<svelte:head>
    <title>Tournoi des Maisons - Clicker</title>
</svelte:head>

<script>
    import { onDestroy, onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { supabase } from '#lib/supabaseClient';
    import { clearPlayerEmail, findPlayerByEmail, getSavedPlayerEmail } from '#lib/playerSession';
    import {
        fetchActiveFamilyPlayers,
        fetchClickerSettings,
        fetchTeamScores,
        recordClick,
        subscribeToClickerScores
    } from '#lib/games/clicker';
    import { playClickSound, playBonusSound, triggerHaptic, isMuted, toggleMute } from '#lib/sound';
    import Navigation from '#lib/components/Navigation.svelte';

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
    let activeFamilyPlayerIds = $state(/** @type {Set<string>} */ (new Set()));
    let activeFamilyPlayerCount = $derived(activeFamilyPlayerIds.size);
    let familyMultiplier = $derived(
        activeFamilyPlayerCount > 0
            ? Math.pow(familyCoefficientPerPlayer, activeFamilyPlayerCount)
            : 1
    );
    let bonusMinClicks = 30;
    let bonusMaxClicks = 60;
    let bonusMessage = $state('');

    // Effets visuels & sonores du click
    let soundMuted = $state(false);
    let comboStreak = $state(0);
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let comboTimeout;
    let isSquished = $state(false);
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let squishTimeout;
    /** @type {Array<{ id: number, text: string, x: number, y: number, isBonus: boolean }>} */
    let floatingNumbers = $state([]);
    let nextFloatId = 0;
    /** @type {Array<{ id: number }>} */
    let shockwaves = $state([]);
    let nextWaveId = 0;
    /** @type {Array<{ id: number, left: number, top: number, rotation: number, emoji: string }>} */
    let clickParticles = $state([]);
    /** @type {ReturnType<typeof setTimeout>[]} */
    let particleTimeouts = [];
    let nextParticleId = 0;

    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let leaderboardTimeout;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let bonusMessageTimeout;

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

    /** @type {ReturnType<typeof setInterval> | undefined} */
    let pollInterval;
    let lastLeaderboardTotalClicks = -1;
    let isRefreshingLeaderboard = false;

    onMount(async () => {
        soundMuted = isMuted();
        await checkDebugMode();

        const userAgent = navigator.userAgent || navigator.vendor || '';
        const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
        const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        
        isMobile = isMobileUA && hasTouch;

        await restorePlayerSession();

        pollInterval = setInterval(() => {
            refreshLeaderboard(false);
        }, 2500);
    });

    onDestroy(() => {
        if (pollInterval) clearInterval(pollInterval);
        if (clickSubscription) supabase.removeChannel(clickSubscription);
        if (leaderboardTimeout) window.clearTimeout(leaderboardTimeout);
        if (bonusMessageTimeout) window.clearTimeout(bonusMessageTimeout);
        if (comboTimeout) window.clearTimeout(comboTimeout);
        if (squishTimeout) window.clearTimeout(squishTimeout);
        particleTimeouts.forEach((timeout) => window.clearTimeout(timeout));
    });

    function handleToggleMute() {
        soundMuted = toggleMute();
    }

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
        await refreshLeaderboard(true);
        isLoading = false;
    }

    async function handleClick() {
        if (!currentPlayer) return;

        clickErrorMessage = '';
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
     * @param {number} extraClicks
     */
    function triggerJuicyEffects(extraClicks) {
        // Combo streak
        comboStreak += 1;
        if (comboTimeout) window.clearTimeout(comboTimeout);
        comboTimeout = window.setTimeout(() => {
            comboStreak = 0;
        }, 1300);

        // Sound & Haptics
        if (extraClicks > 0) {
            playBonusSound();
            triggerHaptic([30, 45, 60]);
        } else {
            playClickSound(comboStreak);
            triggerHaptic(12);
        }

        // Squash & stretch animation
        isSquished = true;
        if (squishTimeout) window.clearTimeout(squishTimeout);
        squishTimeout = window.setTimeout(() => {
            isSquished = false;
        }, 100);

        // Shockwave ripple
        const waveId = ++nextWaveId;
        shockwaves = [...shockwaves, { id: waveId }];
        const waveTimer = window.setTimeout(() => {
            shockwaves = shockwaves.filter((w) => w.id !== waveId);
        }, 550);
        particleTimeouts.push(waveTimer);

        // Floating points
        const floatId = ++nextFloatId;
        const isBonus = extraClicks > 0;
        const text = isBonus ? `+${1 + extraClicks} BONUS!` : '+1';
        const x = 50 + (Math.random() * 24 - 12);
        const y = 35 + (Math.random() * 16 - 8);
        floatingNumbers = [...floatingNumbers, { id: floatId, text, x, y, isBonus }];
        const floatTimer = window.setTimeout(() => {
            floatingNumbers = floatingNumbers.filter((f) => f.id !== floatId);
        }, 800);
        particleTimeouts.push(floatTimer);

        // Burst particles
        animateParticles(extraClicks > 0);
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

        triggerJuicyEffects(extraClicks);

        if (playerGroup) {
            const myTeam = leaderboard.find((t) => String(t.id) === String(playerGroup?.id));
            if (myTeam) {
                myTeam.clicks += 1 + extraClicks;
                leaderboard = [...leaderboard].sort((a, b) => b.clicks - a.clicks);
            }
        }

        if (firstActiveClick) {
            activeFamilyPlayerIds = new Set([...activeFamilyPlayerIds, playerId]);
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
    }

    function randomBonusInterval() {
        return Math.floor(Math.random() * (bonusMaxClicks - bonusMinClicks + 1)) + bonusMinClicks;
    }

    /** @param {boolean} isBonus */
    function animateParticles(isBonus) {
        const emojis = isBonus ? ['✨', '💥', '⚡', '🌟', '✦'] : ['✦', '✨', '⚡'];
        const count = isBonus ? 12 : 7;
        const newParticles = Array.from({ length: count }, () => ({
            id: ++nextParticleId,
            left: 15 + Math.random() * 70,
            top: 15 + Math.random() * 70,
            rotation: Math.round(Math.random() * 120 - 60),
            emoji: emojis[Math.floor(Math.random() * emojis.length)]
        }));
        clickParticles = [...clickParticles, ...newParticles];

        const particleIds = newParticles.map((particle) => particle.id);
        const timeout = window.setTimeout(() => {
            clickParticles = clickParticles.filter((particle) => !particleIds.includes(particle.id));
            particleTimeouts = particleTimeouts.filter((timer) => timer !== timeout);
        }, 750);
        particleTimeouts.push(timeout);
    }

    /** @param {boolean} [force] */
    async function refreshLeaderboard(force = false) {
        if (isRefreshingLeaderboard) return;
        isRefreshingLeaderboard = true;
        try {
            if (!force) {
                const { count } = await supabase
                    .from('ClickerCompetition')
                    .select('id', { count: 'exact', head: true });
                if (count !== null && count === lastLeaderboardTotalClicks && leaderboard.length > 0) {
                    return;
                }
                if (count !== null) lastLeaderboardTotalClicks = count;
            }
            leaderboard = await fetchTeamScores();
        } catch (err) {
            console.error('Erreur rafraîchissement leaderboard :', err);
        } finally {
            isRefreshingLeaderboard = false;
        }
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
                <div class="flex items-center justify-between mb-3">
                    <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 text-[10px] font-semibold">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        Direct
                    </span>
                    <h3 class="text-amber-400 font-bold uppercase text-center text-xs tracking-wider flex-1 mr-8 flex items-center justify-center gap-1.5">
                        🏆 Classement des Équipes
                    </h3>
                </div>

                <div class="space-y-2">
                    {#each leaderboard as group, index (group.id)}
                        {@const gStyle = getHouseStyle(group.name)}
                        <div
                            class="flex items-center justify-between p-2.5 rounded-xl border transition-all duration-300 {group.id === playerGroup?.id ? `${gStyle.bg} ${gStyle.border} ring-1 ring-amber-400/50 shadow-md` : 'bg-slate-950/60 border-slate-800'}"
                        >
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
                    <span class="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border {style.bg} {style.border} {style.text}">
                        {playerGroup?.name || 'Sans Équipe'}
                    </span>
                    <div class="flex items-center gap-2 justify-end mt-1">
                        <button
                            onclick={handleToggleMute}
                            class="text-xs px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 transition"
                            title={soundMuted ? 'Activer le son' : 'Couper le son'}
                        >
                            {soundMuted ? '🔇' : '🔊'}
                        </button>
                        <button onclick={logout} class="text-[10px] text-slate-400 hover:text-slate-200 underline">
                            Déconnexion
                        </button>
                    </div>
                </div>
            </header>
        </div>

        <!-- 2. BOUTON CIRCULAIRE (CENTRE) -->
        <section class="my-auto py-4 text-center flex flex-col items-center justify-center relative">
            <!-- Combo streak badge -->
            {#if comboStreak >= 3}
                {@const comboGradient = comboStreak >= 25 ? 'from-fuchsia-500 via-pink-500 to-rose-500 animate-pulse ring-2 ring-pink-400' : comboStreak >= 15 ? 'from-amber-400 to-red-500 ring-2 ring-orange-400' : comboStreak >= 8 ? 'from-amber-400 to-orange-500' : 'from-yellow-400 to-amber-500'}
                <div
                    class="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-gradient-to-r {comboGradient} text-slate-950 font-black text-xs uppercase tracking-wider shadow-xl mb-3 animate-bounce select-none transform"
                >
                    <span class="text-sm">🔥</span>
                    <span>Combo x{comboStreak} !</span>
                </div>
            {:else}
                <div class="h-7 mb-3"></div>
            {/if}

            <div class="relative flex items-center justify-center">
                <!-- Shockwaves -->
                {#each shockwaves as wave (wave.id)}
                    <span class="shockwave-ring" aria-hidden="true"></span>
                {/each}

                <!-- Floating +1 / +BONUS -->
                {#each floatingNumbers as num (num.id)}
                    <span
                        class="floating-num {num.isBonus ? 'text-amber-300 text-2xl font-black' : 'text-white text-lg font-extrabold'}"
                        style:left="{num.x}%"
                        style:top="{num.y}%"
                        aria-hidden="true"
                    >
                        {num.text}
                    </span>
                {/each}

                <!-- Main Punchy Button -->
                <button 
                    onclick={handleClick}
                    onkeydown={preventEnterRepeat}
                    style:--heat={Math.min(totalClicks / 200, 0.7)}
                    class="heat-button relative w-52 h-52 rounded-full border-4 {style.border} {style.btn} text-white text-2xl font-black uppercase tracking-widest shadow-2xl transition-transform flex flex-col items-center justify-center space-y-2 select-none {isSquished ? 'scale-90 rotate-[-1deg]' : 'hover:scale-105 active:scale-95'}"
                >
                    {#each clickParticles as particle (particle.id)}
                        <span
                            aria-hidden="true"
                            class="click-spark"
                            style:left="{particle.left}%"
                            style:top="{particle.top}%"
                            style:--rotation="{particle.rotation}deg"
                        >{particle.emoji}</span>
                    {/each}
                    <span class="text-5xl transition-transform duration-100 {isSquished ? 'scale-125 -rotate-6' : ''}">⚡</span>
                    <span>CLIQUER !</span>
                </button>
            </div>

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
        <Navigation />
    {/if}

</main>

<style>
    .heat-button {
        background-image: linear-gradient(
            rgba(239, 68, 68, var(--heat)),
            rgba(239, 68, 68, var(--heat))
        );
        filter: saturate(calc(1 + var(--heat)));
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
    }

    .shockwave-ring {
        position: absolute;
        width: 13rem;
        height: 13rem;
        border-radius: 9999px;
        border: 3px solid rgba(251, 191, 36, 0.7);
        pointer-events: none;
        animation: shockwave-expand 500ms ease-out forwards;
    }

    @keyframes shockwave-expand {
        0% {
            transform: scale(0.95);
            opacity: 0.9;
        }
        100% {
            transform: scale(1.45);
            opacity: 0;
        }
    }

    .floating-num {
        position: absolute;
        z-index: 20;
        pointer-events: none;
        text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8), 0 0 12px rgba(251, 191, 36, 0.6);
        animation: float-up-fade 800ms ease-out forwards;
    }

    @keyframes float-up-fade {
        0% {
            opacity: 1;
            transform: translate(-50%, 0) scale(0.7);
        }
        25% {
            opacity: 1;
            transform: translate(-50%, -24px) scale(1.25);
        }
        100% {
            opacity: 0;
            transform: translate(calc(-50% + 8px), -65px) scale(1);
        }
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
