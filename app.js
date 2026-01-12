// ============================================
// NSU Advising Slot Checker - Standalone Website
// ============================================

// Supabase Configuration
// Option 1: Set directly here
// Option 2: Use config.js file (loaded before this script)
const SUPABASE_URL = window.ADVISING_CONFIG?.SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = window.ADVISING_CONFIG?.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

// Validate configuration
if (SUPABASE_URL === 'YOUR_SUPABASE_URL' || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
    console.warn('⚠️ Supabase not configured! Please update config.js or app.js with your credentials.');
}

// Initialize Supabase client (will be set on DOMContentLoaded)
let supabaseClient = null;

// ============================================
// State Management
// ============================================
let state = {
    nsuId: '',
    data: null,
    loading: false,
    error: '',
    phase: 'WAITING_SLOT_1',
    countdownTarget: null,
    countdownLabel: '',
    dbStatus: 'checking', // 'checking', 'connected', 'error'
    totalStudents: 0,
    phaseCountdowns: {
        phase1: null,
        phase2: null,
        phase3: null
    }
};

// Stats state for real-time analytics
let statsState = {
    total: 0,
    valid: 0,
    invalid: 0,
    accuracy: 0
};

// ============================================
// Animated Counter - Bitcoin Style
// ============================================
function animateValue(element, start, end, duration = 300) {
    if (start === end) return;

    const range = end - start;
    const startTime = performance.now();

    // Add rising animation class
    element.classList.add('rising', 'glow');

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Easing function for smooth animation
        const easeOutQuart = 1 - Math.pow(1 - progress, 4);
        const current = Math.round(start + (range * easeOutQuart));

        // Check if this is the accuracy element
        if (element.id === 'statAccuracy') {
            element.textContent = current + '%';
        } else {
            element.textContent = current.toLocaleString();
        }

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            // Remove animation classes after completion
            setTimeout(() => {
                element.classList.remove('rising', 'glow');
            }, 150);
        }
    }

    requestAnimationFrame(update);
}

// ============================================
// Stats Real-time Subscription
// ============================================
let statsSubscription = null;

async function fetchInitialStats() {
    try {
        // Fetch total searches from analytics
        const { data: analyticsData, error: analyticsError } = await supabase
            .from('advising_search_analytics')
            .select('total_searches')
            .single();

        if (analyticsError) throw analyticsError;

        // Fetch unique student IDs where found = true
        const { data: logsData, error: logsError } = await supabase
            .from('advising_search_logs')
            .select('student_id')
            .eq('found', true);

        if (logsError) throw logsError;

        // Count unique student IDs
        const uniqueIds = new Set(logsData.map(row => row.student_id));
        const uniqueCount = uniqueIds.size;

        if (analyticsData) {
            updateStatsDisplay(analyticsData.total_searches, uniqueCount, 0);
        }
    } catch (err) {
        console.log('Stats fetch error:', err);
    }
}

function updateStatsDisplay(total, valid, invalid) {
    const totalEl = document.getElementById('statTotal');
    const validEl = document.getElementById('statValid');
    const accuracyEl = document.getElementById('statAccuracy');

    if (!totalEl || !validEl || !accuracyEl) return;

    // Accuracy is always 100%
    const accuracy = 100;

    // Animate each value if changed
    if (statsState.total !== total) {
        animateValue(totalEl, statsState.total, total);
        statsState.total = total;
    }

    if (statsState.valid !== valid) {
        animateValue(validEl, statsState.valid, valid);
        statsState.valid = valid;
    }

    // Accuracy stays at 100%
    if (statsState.accuracy !== accuracy) {
        animateValue(accuracyEl, statsState.accuracy, accuracy);
        statsState.accuracy = accuracy;
    }
}

function subscribeToStats() {
    // Subscribe to real-time changes on advising_search_analytics table
    statsSubscription = supabase
        .channel('stats-changes')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'advising_search_analytics'
            },
            async (payload) => {
                console.log('Stats update received:', payload);
                if (payload.new) {
                    // Re-fetch unique IDs count when analytics updates
                    try {
                        const { data: logsData, error: logsError } = await supabase
                            .from('advising_search_logs')
                            .select('student_id')
                            .eq('found', true);

                        if (!logsError && logsData) {
                            const uniqueIds = new Set(logsData.map(row => row.student_id));
                            updateStatsDisplay(payload.new.total_searches, uniqueIds.size, 0);
                        } else {
                            updateStatsDisplay(payload.new.total_searches, statsState.valid, 0);
                        }
                    } catch (err) {
                        console.log('Error fetching unique IDs:', err);
                        updateStatsDisplay(payload.new.total_searches, statsState.valid, 0);
                    }
                }
            }
        )
        .subscribe();
}

// Phase start dates in Bangladesh Time (GMT+6)
// Converting to UTC: Bangladesh 8:32 AM = UTC 2:32 AM, Bangladesh 10:00 AM = UTC 4:00 AM
const PHASE_DATES = {
    phase1: new Date('2026-01-12T02:32:00Z'),      // Jan 12, 8:32 AM Bangladesh
    phase1End: new Date('2026-01-13T17:59:59Z'),   // Jan 13, 11:59 PM Bangladesh
    phase2: new Date('2026-01-14T02:32:00Z'),      // Jan 14, 8:32 AM Bangladesh
    phase2End: new Date('2026-01-15T17:59:59Z'),   // Jan 15, 11:59 PM Bangladesh
    phase3: new Date('2026-01-17T04:00:00Z'),      // Jan 17, 10:00 AM Bangladesh
    phase3End: new Date('2026-01-19T17:59:59Z')    // Jan 19, 11:59 PM Bangladesh
};

// Calculate phase countdown
function getPhaseStatus(phaseStart, phaseEnd) {
    const now = new Date();
    if (now < phaseStart) {
        const diff = phaseStart.getTime() - now.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const mins = Math.floor((diff / (1000 * 60)) % 60);
        const secs = Math.floor((diff / 1000) % 60);
        return { status: 'upcoming', days, hours, mins, secs };
    } else if (now >= phaseStart && now <= phaseEnd) {
        return { status: 'live' };
    } else {
        return { status: 'ended' };
    }
}

// ============================================
// Database Status Check
// ============================================
async function checkDatabaseStatus() {
    try {
        const { count, error } = await supabase
            .from('student_schedules')
            .select('*', { count: 'exact', head: true });

        if (error) throw error;

        state.dbStatus = 'connected';
        state.totalStudents = count || 0;
    } catch (err) {
        console.error('Database connection error:', err);
        state.dbStatus = 'error';
    }
    render();
}

// ============================================
// Database Query
// ============================================
async function queryAdvisingDatabase(nsuId) {
    try {
        const { data, error } = await supabase
            .from('student_schedules')
            .select('student_id, probation_flag, phase1_date, phase2_date, slot1_start_time, slot1_end_time, slot2_start_time, slot2_end_time')
            .eq('student_id', nsuId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                // No rows returned
                return null;
            }
            throw error;
        }

        if (!data) return null;

        // Format time from "8:32 AM" style columns
        const formatSlot = (startTime, endTime) => {
            return `${startTime} - ${endTime}`;
        };

        // Format date from "2026-01-12" to "12-Jan-2026"
        const formatDate = (dateStr) => {
            const d = new Date(dateStr + 'T00:00:00');
            const day = d.getDate();
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const month = months[d.getMonth()];
            const year = d.getFullYear();
            return `${day}-${month}-${year}`;
        };

        return {
            nsuId: data.student_id,
            phase1Date: formatDate(data.phase1_date),
            phase2Date: formatDate(data.phase2_date),
            phase1DateRaw: data.phase1_date,
            phase2DateRaw: data.phase2_date,
            slot1: formatSlot(data.slot1_start_time, data.slot1_end_time),
            slot2: formatSlot(data.slot2_start_time, data.slot2_end_time),
            slot1StartRaw: data.slot1_start_time,
            slot1EndRaw: data.slot1_end_time,
            slot2StartRaw: data.slot2_start_time,
            slot2EndRaw: data.slot2_end_time,
            probationFlag: data.probation_flag
        };
    } catch (err) {
        console.error('Database query error:', err);
        throw err;
    }
}

// ============================================
// Date/Time Parsing Helpers
// ============================================
function parseDbDate(dateStr) {
    // Expected format: "20-Nov-2025" or ISO date
    const months = {
        'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
        'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    };

    try {
        // Try ISO format first
        if (dateStr.includes('-') && dateStr.length === 10 && !isNaN(Date.parse(dateStr))) {
            return new Date(dateStr + 'T00:00:00');
        }

        // Parse DD-Mon-YYYY format
        const parts = dateStr.split('-');
        if (parts.length !== 3) return new Date();

        const day = parseInt(parts[0], 10);
        const month = months[parts[1]];
        const year = parseInt(parts[2], 10);

        return new Date(year, month, day);
    } catch (e) {
        return new Date();
    }
}

function parseSlotTimes(dateObj, timeRange) {
    // timeRange example: "1:32 PM - 1:52 PM"
    const [startStr, endStr] = timeRange.split(' - ');

    function parseTime(tStr) {
        const [time, modifier] = tStr.trim().split(' ');
        let [hours, minutes] = time.split(':').map(Number);

        if (hours === 12 && modifier === 'AM') hours = 0;
        if (hours !== 12 && modifier === 'PM') hours += 12;

        const d = new Date(dateObj);
        d.setHours(hours, minutes, 0, 0);
        return d;
    }

    return {
        start: parseTime(startStr),
        end: parseTime(endStr)
    };
}

// ============================================
// Phase Management
// ============================================
function updatePhase() {
    if (!state.data) return;

    const now = new Date();
    const { slot1Start, slot1End, slot2Start, slot2End } = state.data;

    if (now < slot1Start) {
        state.phase = 'WAITING_SLOT_1';
        state.countdownTarget = slot1Start;
        state.countdownLabel = 'TIME UNTIL SLOT 1';
    } else if (now >= slot1Start && now < slot1End) {
        state.phase = 'SLOT_1_LIVE';
        state.countdownTarget = slot1End;
        state.countdownLabel = 'SLOT 1 ENDS IN';
    } else if (now >= slot1End && now < slot2Start) {
        state.phase = 'WAITING_SLOT_2';
        state.countdownTarget = slot2Start;
        state.countdownLabel = 'TIME UNTIL SLOT 2';
    } else if (now >= slot2Start && now < slot2End) {
        state.phase = 'SLOT_2_LIVE';
        state.countdownTarget = slot2End;
        state.countdownLabel = 'SLOT 2 ENDS IN';
    } else {
        state.phase = 'ENDED';
        state.countdownTarget = null;
        state.countdownLabel = 'ADVISING ENDED';
    }
}

// ============================================
// Countdown Calculator
// ============================================
function calculateTimeLeft(targetDate) {
    if (!targetDate) return { days: 0, hours: 0, minutes: 0, seconds: 0 };

    const now = new Date();
    const difference = targetDate.getTime() - now.getTime();

    if (difference <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };

    return {
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60)
    };
}

// ============================================
// Fetch Data
// ============================================
async function performFetch(id) {
    state.loading = true;
    state.error = '';
    render();

    try {
        const record = await queryAdvisingDatabase(id);

        if (record) {
            // Log valid search
            logSearch(id, true);

            // Parse Phase 1 date
            const phase1DateObj = parseDbDate(record.phase1Date);
            const phase1DayOfWeek = phase1DateObj.toLocaleDateString('en-US', { weekday: 'long' });
            const phase1DatePart = phase1DateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

            // Parse Phase 2 date
            const phase2DateObj = parseDbDate(record.phase2Date);
            const phase2DayOfWeek = phase2DateObj.toLocaleDateString('en-US', { weekday: 'long' });
            const phase2DatePart = phase2DateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

            // Parse slot times for Phase 1 (for countdown)
            const { start: slot1Start, end: slot1End } = parseSlotTimes(phase1DateObj, record.slot1);
            const { start: slot2Start, end: slot2End } = parseSlotTimes(phase1DateObj, record.slot2);

            state.data = {
                nsuId: record.nsuId,
                // Phase 1
                phase1DayOfWeek,
                phase1DatePart,
                phase1DateRaw: record.phase1DateRaw,
                // Phase 2
                phase2DayOfWeek,
                phase2DatePart,
                phase2DateRaw: record.phase2DateRaw,
                // Slot times (same for both phases)
                slot1Label: record.slot1,
                slot2Label: record.slot2,
                slot1Start,
                slot1End,
                slot2Start,
                slot2End
            };

            updatePhase();
        } else {
            // Log invalid search
            logSearch(id, false);

            state.error = 'Advising data not found for you.';
            state.data = null;
        }
    } catch (err) {
        state.error = 'Connection failed. Please try again.';
        state.data = null;
    } finally {
        state.loading = false;
        render();
    }
}

// ============================================
// Search Analytics
// ============================================
async function logSearch(studentId, isValid) {
    try {
        // Log to search logs table
        await supabase.rpc('log_advising_search', {
            p_student_id: studentId,
            p_found: isValid
        });

        // Increment counters
        const functionName = isValid ? 'increment_valid_search' : 'increment_invalid_search';
        await supabase.rpc(functionName);
    } catch (err) {
        // Silently fail - don't affect user experience
        console.log('Analytics log failed:', err);
    }
}

// ============================================
// UI Components
// ============================================
function renderCountdownBox(value, label, color) {
    return `
        <div class="flex flex-col items-center gap-3">
            <div class="relative group w-20 h-24 sm:w-24 sm:h-28 perspective-1000">
                <div class="absolute -inset-0.5 bg-gradient-to-b ${color} rounded-[20px] blur opacity-20 group-hover:opacity-50 transition duration-500"></div>
                <div class="relative w-full h-full bg-gradient-to-b from-[#1E202E] to-[#10121B] border border-white/10 rounded-[20px] flex items-center justify-center shadow-2xl overflow-hidden backdrop-blur-sm">
                    <div class="absolute top-0 inset-x-0 h-1/3 bg-gradient-to-b from-white/10 to-transparent pointer-events-none"></div>
                    <span class="countdown-value text-4xl sm:text-5xl font-bold text-white z-10 font-mono drop-shadow-[0_2px_10px_rgba(255,255,255,0.15)]" data-label="${label}">
                        ${String(value).padStart(2, '0')}
                    </span>
                    <div class="absolute bottom-0 inset-x-0 h-[3px] bg-gradient-to-r ${color} shadow-[0_-2px_10px_rgba(255,255,255,0.1)]"></div>
                </div>
            </div>
            <span class="text-[10px] sm:text-xs font-bold text-gray-500 tracking-[0.2em] uppercase">${label}</span>
        </div>
    `;
}

function renderCountdownTimer(timeLeft, label) {
    return `
        <div class="flex flex-col items-center">
            ${label ? `
                <div class="relative mb-8 group cursor-default">
                    <div class="absolute -inset-0.5 bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 rounded-lg blur opacity-40 group-hover:opacity-75 transition duration-500 animate-pulse"></div>
                    <div class="relative px-6 py-2 bg-[#0f111a] rounded-lg border border-white/10 flex items-center gap-3">
                        <span class="relative flex h-2 w-2">
                            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                            <span class="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                        </span>
                        <p class="text-transparent bg-clip-text bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 text-sm font-black uppercase tracking-[0.2em]">
                            ${label}
                        </p>
                    </div>
                </div>
            ` : ''}
            <div class="flex justify-center gap-4 sm:gap-6">
                ${renderCountdownBox(timeLeft.days, 'DAYS', 'from-cyan-500 to-blue-500')}
                ${renderCountdownBox(timeLeft.hours, 'HOURS', 'from-purple-500 to-indigo-500')}
                ${renderCountdownBox(timeLeft.minutes, 'MINS', 'from-pink-500 to-rose-500')}
                ${renderCountdownBox(timeLeft.seconds, 'SECS', 'from-amber-400 to-orange-500')}
            </div>
        </div>
    `;
}

// ============================================
// Render Phase Cards (outside modal)
// ============================================
function renderPhaseCards() {
    const phaseCardsContainer = document.getElementById('phaseCards');
    if (!phaseCardsContainer) return;

    const activePhase = getActivePhase();

    // Generate phase cards with modal inserted after active phase
    const phase1Card = renderPhaseCard(1, 'Jan 12-13, 2026', 'cyan', 'Pre-advised courses only', [
        'Add, Drop, Section Change',
        'Must complete Pre-Advising',
        'No dues as of Dec 21'
    ], getPhaseStatus(PHASE_DATES.phase1, PHASE_DATES.phase1End), activePhase);

    const phase2Card = renderPhaseCard(2, 'Jan 14-15, 2026', 'purple', 'All offered courses', [
        'Add, Drop, Section Change',
        'Same eligibility as Phase 1',
        'View all available sections'
    ], getPhaseStatus(PHASE_DATES.phase2, PHASE_DATES.phase2End), activePhase);

    const phase3Card = renderPhaseCard(3, 'Jan 17-19, 2026', 'amber', 'Random advising slots', [
        'Add & Section Change only',
        '<span class="text-red-500 font-medium">No Course Drop allowed</span>',
        'Status must be "Enrolled"'
    ], getPhaseStatus(PHASE_DATES.phase3, PHASE_DATES.phase3End), activePhase);

    // Build layout - On desktop: all 3 phases in a row, modal below
    // On mobile: active phase expanded, others collapsed, modal after active phase
    let cardsHtml = '';

    // Desktop: All 3 cards in a row, modal always below all cards
    // Mobile: Dynamic based on active phase
    cardsHtml = `
        <!-- Desktop: 3 cards in a row -->
        <div class="hidden sm:grid sm:grid-cols-3 gap-4 mb-4">
            ${phase1Card}
            ${phase2Card}
            ${phase3Card}
        </div>
        
        <!-- Mobile: Dynamic layout based on active phase -->
        <div class="sm:hidden">
            ${activePhase === 1 || activePhase === 0 ? `
                <div class="mb-3">${phase1Card}</div>
                <div id="modalPlaceholderMobile" class="mb-3"></div>
                <div class="space-y-3 mb-3">
                    ${phase2Card}
                    ${phase3Card}
                </div>
            ` : activePhase === 2 ? `
                <div class="mb-3">${phase1Card}</div>
                <div class="mb-3">${phase2Card}</div>
                <div id="modalPlaceholderMobile" class="mb-3"></div>
                <div class="mb-3">${phase3Card}</div>
            ` : `
                <div class="space-y-3 mb-3">
                    ${phase1Card}
                    ${phase2Card}
                </div>
                <div class="mb-3">${phase3Card}</div>
                <div id="modalPlaceholderMobile" class="mb-3"></div>
            `}
        </div>
        
        <!-- Desktop modal placeholder -->
        <div id="modalPlaceholder" class="hidden sm:block mb-4"></div>
    `;

    // Add quick info at the end
    cardsHtml += `
        <!-- Quick Info -->
        <div class="bg-white rounded-xl p-4 border border-gray-200 text-xs shadow-sm">
            <div class="flex items-center gap-2 text-gray-700 mb-2">
                <i class="fas fa-info-circle text-teal-500"></i>
                <span class="font-semibold">Important Info</span>
            </div>
            <ul class="text-gray-600 space-y-1 text-[11px]">
                <li>• Each slot is <span class="text-gray-900 font-medium">20 minutes</span> - for <span class="text-gray-900 font-medium">Phase 1 & 2</span></li>
                <li>• Must have <span class="text-gray-900 font-medium">no dues</span> as of Dec 21, 2025</li>
                <li>• Status must be <span class="text-gray-900 font-medium">"Enrolled"</span> • Students with approved Semester Drop in Fall/Summer 2025 are also eligible</li>
            </ul>
        </div>
    `;

    phaseCardsContainer.innerHTML = cardsHtml;

    // Move the modal card into the appropriate placeholder
    const modalCard = document.getElementById('modalCard');
    const desktopPlaceholder = document.getElementById('modalPlaceholder');
    const mobilePlaceholder = document.getElementById('modalPlaceholderMobile');

    // Check screen size and place modal accordingly
    if (modalCard) {
        if (window.innerWidth >= 640 && desktopPlaceholder) {
            // Desktop: modal goes after all phase cards
            desktopPlaceholder.appendChild(modalCard);
        } else if (mobilePlaceholder) {
            // Mobile: modal goes after active phase
            mobilePlaceholder.appendChild(modalCard);
        }
    }

    // Add click handlers for collapsible phase cards (mobile only)
    const expandBtns = phaseCardsContainer.querySelectorAll('.phase-expand-btn');
    expandBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const phaseNum = btn.dataset.phase;
            const card = btn.closest('.phase-card');
            const details = card ? card.querySelector('.phase-details') : null;
            const collapsedHeader = card ? card.querySelector('.collapsed-header') : null;
            const chevron = btn.querySelector('.phase-chevron');

            if (details) {
                const isExpanding = details.classList.contains('hidden');

                if (isExpanding) {
                    // Expanding - hide collapsed header, show details
                    details.classList.remove('hidden');
                    if (collapsedHeader) collapsedHeader.classList.add('hidden');
                } else {
                    // Collapsing - show collapsed header, hide details
                    details.classList.add('hidden');
                    if (collapsedHeader) collapsedHeader.classList.remove('hidden');
                }
            }
            if (chevron) {
                chevron.classList.toggle('rotate-180');
            }
        });
    });

    // Add click handlers for collapse buttons inside expanded cards
    const collapseBtns = phaseCardsContainer.querySelectorAll('.phase-collapse-btn');
    collapseBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const card = btn.closest('.phase-card');
            const details = card ? card.querySelector('.phase-details') : null;
            const collapsedHeader = card ? card.querySelector('.collapsed-header') : null;

            if (details && collapsedHeader) {
                // Collapse - show collapsed header, hide details
                details.classList.add('hidden');
                collapsedHeader.classList.remove('hidden');
            }
        });
    });
}

// Get which phase should be expanded (the current/upcoming one)
function getActivePhase() {
    const now = new Date();

    // Check Phase 1
    if (now < PHASE_DATES.phase1End) {
        return 1; // Phase 1 is current or upcoming
    }
    // Check Phase 2
    if (now < PHASE_DATES.phase2End) {
        return 2; // Phase 2 is current or upcoming
    }
    // Check Phase 3
    if (now < PHASE_DATES.phase3End) {
        return 3; // Phase 3 is current or upcoming
    }
    // All phases ended
    return 0; // Collapse all
}

// Render phase card with mini countdown
function renderPhaseCard(phaseNum, dateStr, color, highlight, rules, phaseStatus, activePhase) {
    const colorClasses = {
        cyan: { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-600', highlight: 'text-cyan-700', date: 'text-gray-800' },
        purple: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-600', highlight: 'text-purple-700', date: 'text-gray-800' },
        amber: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-600', highlight: 'text-amber-700', date: 'text-gray-800' }
    };
    const c = colorClasses[color];

    // Determine if this phase should be expanded on mobile
    // Expand if: this is the active phase, OR activePhase is 0 (all ended) and this is phase 1
    const isExpandedOnMobile = (phaseNum === activePhase);
    const isCollapsible = !isExpandedOnMobile; // All non-active phases are collapsible

    let countdownHtml = '';
    if (phaseStatus.status === 'upcoming') {
        countdownHtml = `
            <div class="mt-3 pt-3 border-t border-gray-200">
                <div class="text-[10px] text-gray-500 mb-2">Starts in</div>
                <div class="flex gap-1.5 phase-countdown" data-phase="${phaseNum}">
                    <span class="bg-gradient-to-b from-indigo-500 to-indigo-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg shadow-md shadow-indigo-500/30">${phaseStatus.days}d</span>
                    <span class="bg-gradient-to-b from-purple-500 to-purple-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg shadow-md shadow-purple-500/30">${phaseStatus.hours}h</span>
                    <span class="bg-gradient-to-b from-pink-500 to-pink-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg shadow-md shadow-pink-500/30">${phaseStatus.mins}m</span>
                    <span class="bg-gradient-to-b from-orange-500 to-orange-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg shadow-md shadow-orange-500/30">${phaseStatus.secs}s</span>
                </div>
            </div>
        `;
    } else if (phaseStatus.status === 'live') {
        countdownHtml = `
            <div class="mt-3 pt-3 border-t border-gray-200">
                <div class="inline-flex items-center gap-2 bg-green-100 px-3 py-1.5 rounded-full">
                    <span class="relative flex h-2 w-2">
                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                    <span class="text-green-700 text-xs font-bold">LIVE NOW</span>
                </div>
            </div>
        `;
    } else {
        countdownHtml = `
            <div class="mt-3 pt-3 border-t border-gray-200">
                <div class="inline-flex items-center gap-2 bg-gray-100 px-3 py-1.5 rounded-full">
                    <i class="fas fa-check-circle text-gray-400 text-xs"></i>
                    <span class="text-gray-500 text-xs font-medium">Completed</span>
                </div>
            </div>
        `;
    }

    if (isCollapsible) {
        // Mini countdown for collapsed header - compact version
        let miniCountdown = '';
        if (phaseStatus.status === 'upcoming') {
            miniCountdown = `
                <div class="flex items-center gap-1 flex-shrink-0 phase-mini-countdown" data-phase="${phaseNum}">
                    <span class="text-[9px] text-gray-400 hidden xs:inline">in</span>
                    <span class="bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap">${phaseStatus.days}d ${phaseStatus.hours}h</span>
                </div>
            `;
        } else if (phaseStatus.status === 'live') {
            miniCountdown = `
                <div class="flex items-center gap-1 bg-green-500 px-1.5 py-0.5 rounded-full flex-shrink-0">
                    <span class="w-1 h-1 rounded-full bg-white animate-pulse"></span>
                    <span class="text-white text-[9px] font-bold">LIVE</span>
                </div>
            `;
        } else {
            miniCountdown = `<span class="text-gray-400 text-[9px] bg-gray-200 px-1.5 py-0.5 rounded-full flex-shrink-0">Done</span>`;
        }

        // Collapsible card for mobile - when expanded looks same as Phase 1
        // Build header countdown (same style for both collapsed and expanded)
        let headerCountdownBadges = '';
        if (phaseStatus.status === 'upcoming') {
            headerCountdownBadges = `
                <div class="flex items-center gap-1.5">
                    <span class="text-[10px] text-gray-500 font-medium">Starts in</span>
                    <div class="flex gap-1 phase-countdown" data-phase="${phaseNum}">
                        <span class="bg-gradient-to-b from-indigo-500 to-indigo-700 text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow-md shadow-indigo-500/30">${phaseStatus.days}d</span>
                        <span class="bg-gradient-to-b from-purple-500 to-purple-700 text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow-md shadow-purple-500/30">${phaseStatus.hours}h</span>
                        <span class="bg-gradient-to-b from-pink-500 to-pink-700 text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow-md shadow-pink-500/30">${phaseStatus.mins}m</span>
                        <span class="bg-gradient-to-b from-orange-500 to-orange-700 text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow-md shadow-orange-500/30 animate-pulse">${phaseStatus.secs}s</span>
                    </div>
                </div>
            `;
        } else if (phaseStatus.status === 'live') {
            headerCountdownBadges = `
                <div class="flex items-center gap-1.5 bg-green-100 px-2 py-1 rounded-full">
                    <span class="relative flex h-2 w-2">
                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                    <span class="text-green-700 text-xs font-bold">LIVE NOW</span>
                </div>
            `;
        } else {
            headerCountdownBadges = `
                <div class="flex items-center gap-1.5 bg-gray-100 px-2 py-1 rounded-full">
                    <svg class="w-3 h-3 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                    </svg>
                    <span class="text-gray-500 text-xs font-medium">Completed</span>
                </div>
            `;
        }

        return `
            <div class="${c.bg} rounded-xl border ${c.border} shadow-sm phase-card overflow-hidden" data-phase="${phaseNum}">
                <!-- Mobile: Collapsed Header (tappable) -->
                <button class="sm:hidden w-full p-4 phase-expand-btn collapsed-header" data-phase="${phaseNum}">
                    <div class="flex items-center justify-between">
                        <div class="${c.text} text-xs font-bold">PHASE ${phaseNum}</div>
                        ${headerCountdownBadges}
                    </div>
                </button>
                
                <!-- Mobile: Expanded Content (hidden by default, full view like Phase 1) -->
                <div class="phase-details hidden sm:hidden p-4" data-phase="${phaseNum}">
                    <!-- Header: PHASE X + Countdown (same as collapsed) -->
                    <div class="flex items-center justify-between mb-2">
                        <div class="${c.text} text-xs font-bold">PHASE ${phaseNum}</div>
                        ${headerCountdownBadges}
                    </div>
                    <!-- Date -->
                    <div class="${c.date} text-lg font-bold mb-2">${dateStr}</div>
                    <!-- Rules -->
                    <div class="text-gray-600 text-xs space-y-1">
                        <p class="${c.highlight} font-semibold">${highlight}</p>
                        ${rules.map(r => `<p>• ${r}</p>`).join('')}
                    </div>
                    <!-- Collapse button -->
                    <button class="phase-collapse-btn mt-3 pt-2 border-t border-gray-200 w-full flex items-center justify-center gap-1 text-gray-400 hover:text-gray-600 text-xs" data-phase="${phaseNum}">
                        <svg class="w-3 h-3 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                        </svg>
                        <span>Collapse</span>
                    </button>
                </div>
                
                <!-- Desktop: Always visible -->
                <div class="hidden sm:block p-4">
                    <div class="${c.text} text-xs font-bold mb-2">PHASE ${phaseNum}</div>
                    <div class="${c.date} text-lg font-bold mb-2">${dateStr}</div>
                    <div class="text-gray-600 text-xs space-y-1">
                        <p class="${c.highlight} font-semibold">${highlight}</p>
                        ${rules.map(r => `<p>• ${r}</p>`).join('')}
                    </div>
                    ${countdownHtml}
                </div>
            </div>
        `;
    } else {
        // Always expanded card (Phase 1) - with full countdown in header on mobile
        let headerCountdown = '';
        let bottomCountdown = countdownHtml; // Keep for desktop

        if (phaseStatus.status === 'upcoming') {
            headerCountdown = `
                <div class="flex items-center gap-2 sm:hidden">
                    <span class="text-[10px] text-gray-500 font-medium">Starts in</span>
                    <div class="flex gap-1 phase-countdown" data-phase="${phaseNum}">
                        <div class="flex flex-col items-center">
                            <span class="bg-gradient-to-b from-indigo-500 to-indigo-700 text-white text-[11px] font-bold px-2 py-1 rounded-lg shadow-md shadow-indigo-500/30">${phaseStatus.days}d</span>
                        </div>
                        <div class="flex flex-col items-center">
                            <span class="bg-gradient-to-b from-purple-500 to-purple-700 text-white text-[11px] font-bold px-2 py-1 rounded-lg shadow-md shadow-purple-500/30">${phaseStatus.hours}h</span>
                        </div>
                        <div class="flex flex-col items-center">
                            <span class="bg-gradient-to-b from-pink-500 to-pink-700 text-white text-[11px] font-bold px-2 py-1 rounded-lg shadow-md shadow-pink-500/30">${phaseStatus.mins}m</span>
                        </div>
                        <div class="flex flex-col items-center">
                            <span class="bg-gradient-to-b from-orange-500 to-orange-700 text-white text-[11px] font-bold px-2 py-1 rounded-lg shadow-md shadow-orange-500/30 animate-pulse">${phaseStatus.secs}s</span>
                        </div>
                    </div>
                </div>
            `;
            // Desktop only countdown at bottom
            bottomCountdown = `
                <div class="mt-3 pt-3 border-t border-gray-200 hidden sm:block">
                    <div class="text-[10px] text-gray-500 mb-1">Starts in</div>
                    <div class="flex gap-1 text-xs font-mono phase-countdown" data-phase="${phaseNum}">
                        <span class="bg-gradient-to-b from-indigo-500 to-indigo-700 text-white px-2 py-1 rounded-lg shadow-md">${phaseStatus.days}d</span>
                        <span class="bg-gradient-to-b from-purple-500 to-purple-700 text-white px-2 py-1 rounded-lg shadow-md">${phaseStatus.hours}h</span>
                        <span class="bg-gradient-to-b from-pink-500 to-pink-700 text-white px-2 py-1 rounded-lg shadow-md">${phaseStatus.mins}m</span>
                        <span class="bg-gradient-to-b from-orange-500 to-orange-700 text-white px-2 py-1 rounded-lg shadow-md">${phaseStatus.secs}s</span>
                    </div>
                </div>
            `;
        } else if (phaseStatus.status === 'live') {
            headerCountdown = `
                <div class="flex items-center gap-1 sm:hidden">
                    <span class="relative flex h-2 w-2">
                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                    <span class="text-green-600 text-xs font-bold">LIVE NOW</span>
                </div>
            `;
            bottomCountdown = `
                <div class="mt-3 pt-3 border-t border-gray-200 hidden sm:block">
                    <div class="flex items-center gap-2">
                        <span class="relative flex h-2 w-2">
                            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                        </span>
                        <span class="text-green-600 text-xs font-bold">LIVE NOW</span>
                    </div>
                </div>
            `;
        } else {
            headerCountdown = `<span class="text-gray-400 text-xs sm:hidden">Completed</span>`;
            bottomCountdown = `
                <div class="mt-3 pt-3 border-t border-gray-200 hidden sm:block">
                    <div class="flex items-center gap-2">
                        <i class="fas fa-check-circle text-gray-400 text-xs"></i>
                        <span class="text-gray-500 text-xs">Completed</span>
                    </div>
                </div>
            `;
        }

        return `
            <div class="${c.bg} rounded-xl p-4 border ${c.border} shadow-sm">
                <div class="flex items-center justify-between mb-2">
                    <div class="${c.text} text-xs font-bold">PHASE ${phaseNum}</div>
                    ${headerCountdown}
                </div>
                <div class="${c.date} text-lg font-bold mb-2">${dateStr}</div>
                <div class="text-gray-600 text-xs space-y-1">
                    <p class="${c.highlight} font-semibold">${highlight}</p>
                    ${rules.map(r => `<p>• ${r}</p>`).join('')}
                </div>
                ${bottomCountdown}
            </div>
        `;
    }
}

function renderSlotCard(title, timeLabel, isActive, status) {
    const statusBadge = status === 'LIVE'
        ? '<span class="px-2 py-1 bg-green-500 text-white text-[10px] font-bold rounded-md animate-pulse shadow-lg shadow-green-500/50">● LIVE</span>'
        : status === 'PASSED'
            ? '<span class="px-2 py-1 bg-red-900/80 text-red-200 text-[10px] font-bold rounded-md border border-red-700/50">PASSED</span>'
            : isActive
                ? '<span class="px-2 py-1 bg-indigo-600 text-indigo-100 text-[10px] font-bold rounded-md">UPCOMING</span>'
                : '';

    return `
        <div class="relative overflow-hidden rounded-2xl p-4 transition-all duration-500 ${isActive
            ? 'bg-gradient-to-br from-[#4c1d95] to-[#312e81] border border-indigo-500/30 shadow-[0_0_30px_rgba(79,70,229,0.3)] transform scale-[1.02]'
            : 'bg-[#1a1c2e] border border-white/5 opacity-80 grayscale-[0.5]'
        }">
            <div class="absolute top-3 right-3">${statusBadge}</div>
            <div class="absolute right-0 bottom-0 opacity-10 transform translate-x-2 translate-y-2 transition-transform duration-500 ${isActive ? 'scale-110' : 'scale-100'}">
                <i class="fas fa-calendar-alt text-6xl text-white"></i>
            </div>
            <div class="relative z-10 pr-8">
                <div class="flex items-center gap-2 mb-1">
                    <div class="w-1 h-3 rounded-full ${isActive ? 'bg-indigo-300 shadow-[0_0_8px_rgba(165,180,252,0.6)]' : 'bg-gray-600'}"></div>
                    <p class="text-[10px] sm:text-xs font-bold uppercase tracking-[0.15em] ${isActive ? 'text-indigo-100' : 'text-gray-500'}">
                        ${title}
                    </p>
                </div>
                <p class="text-xl font-bold ${isActive ? 'text-white' : 'text-gray-300'}">
                    ${timeLabel}
                </p>
            </div>
        </div>
    `;
}

// Light theme slot card for result view
function renderSlotCardLight(title, timeLabel, isActive, status) {
    const statusBadge = status === 'LIVE'
        ? '<span class="px-2 py-0.5 bg-green-500 text-white text-[8px] font-bold rounded animate-pulse whitespace-nowrap">● LIVE</span>'
        : status === 'PASSED'
            ? '<span class="px-2 py-0.5 bg-red-100 text-red-600 text-[8px] font-bold rounded border border-red-200 whitespace-nowrap">PASSED</span>'
            : isActive
                ? '<span class="px-2 py-0.5 bg-white/90 text-teal-600 text-[8px] font-bold rounded shadow-sm whitespace-nowrap">UPCOMING</span>'
                : '';

    return `
        <div class="rounded-xl p-3 transition-all duration-300 ${isActive
            ? 'bg-gradient-to-r from-teal-500 to-cyan-500 shadow-lg shadow-teal-500/20'
            : 'bg-white border border-gray-200'
        }">
            <div class="flex items-center justify-between mb-1">
                <div class="flex items-center gap-1.5">
                    <div class="w-1 h-4 rounded-full ${isActive ? 'bg-white/60' : 'bg-gray-300'}"></div>
                    <p class="text-[10px] font-bold uppercase tracking-wide ${isActive ? 'text-white/80' : 'text-gray-400'}">
                        ${title}
                    </p>
                </div>
                ${statusBadge}
            </div>
            <p class="text-lg font-bold ${isActive ? 'text-white' : 'text-gray-700'} pl-2.5">
                ${timeLabel}
            </p>
        </div>
    `;
}

// Light theme countdown timer for result view
function renderCountdownTimerLight(timeLeft, label) {
    return `
        <div class="flex flex-col items-center">
            ${label ? `
                <div class="relative mb-6 group cursor-default">
                    <div class="absolute -inset-0.5 bg-gradient-to-r from-teal-400 via-cyan-400 to-orange-400 rounded-lg blur opacity-30"></div>
                    <div class="relative px-4 sm:px-6 py-2 bg-white rounded-lg border border-teal-100 flex items-center gap-2 sm:gap-3 shadow-sm">
                        <span class="relative flex h-2 w-2">
                            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                            <span class="relative inline-flex rounded-full h-2 w-2 bg-teal-500"></span>
                        </span>
                        <p class="text-transparent bg-clip-text bg-gradient-to-r from-teal-600 via-cyan-600 to-orange-500 text-xs sm:text-sm font-black uppercase tracking-[0.15em]">
                            ${label}
                        </p>
                    </div>
                </div>
            ` : ''}
            <div class="flex justify-center gap-2 sm:gap-4">
                ${renderCountdownBoxLight(timeLeft.days, 'DAYS', 'from-teal-500 to-cyan-500')}
                ${renderCountdownBoxLight(timeLeft.hours, 'HOURS', 'from-cyan-500 to-teal-500')}
                ${renderCountdownBoxLight(timeLeft.minutes, 'MINS', 'from-orange-400 to-amber-500')}
                ${renderCountdownBoxLight(timeLeft.seconds, 'SECS', 'from-amber-500 to-orange-500')}
            </div>
        </div>
    `;
}

function renderCountdownBoxLight(value, label, gradientColor) {
    return `
        <div class="flex flex-col items-center gap-2">
            <div class="relative group w-14 h-16 sm:w-20 sm:h-24">
                <div class="absolute -inset-0.5 bg-gradient-to-b ${gradientColor} rounded-xl sm:rounded-2xl blur opacity-30"></div>
                <div class="relative w-full h-full bg-white border border-gray-200 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-lg overflow-hidden">
                    <div class="absolute top-0 inset-x-0 h-1/3 bg-gradient-to-b from-gray-50 to-transparent pointer-events-none"></div>
                    <span class="countdown-value text-2xl sm:text-4xl font-bold text-gray-800 z-10 font-mono" data-label="${label}">
                        ${String(value).padStart(2, '0')}
                    </span>
                    <div class="absolute bottom-0 inset-x-0 h-[3px] bg-gradient-to-r ${gradientColor}"></div>
                </div>
            </div>
            <span class="text-[8px] sm:text-[10px] font-bold text-gray-500 tracking-[0.15em] uppercase">${label}</span>
        </div>
    `;
}

function getSlot1Status() {
    if (state.phase === 'SLOT_1_LIVE') return 'LIVE';
    if (['WAITING_SLOT_2', 'SLOT_2_LIVE', 'ENDED'].includes(state.phase)) return 'PASSED';
    return 'UPCOMING';
}

function getSlot2Status() {
    if (state.phase === 'SLOT_2_LIVE') return 'LIVE';
    if (state.phase === 'ENDED') return 'PASSED';
    return 'UPCOMING';
}

// ============================================
// SVG Icons
// ============================================
const SVG_ICONS = {
    clock: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6"><path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" clip-rule="evenodd" /></svg>`,
    idCard: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path fill-rule="evenodd" d="M4.5 3.75a3 3 0 00-3 3v10.5a3 3 0 003 3h15a3 3 0 003-3V6.75a3 3 0 00-3-3h-15zm4.125 3a2.25 2.25 0 100 4.5 2.25 2.25 0 000-4.5zm-3.873 8.703a4.126 4.126 0 017.746 0 .75.75 0 01-.351.92 7.47 7.47 0 01-3.522.877 7.47 7.47 0 01-3.522-.877.75.75 0 01-.351-.92zM15 8.25a.75.75 0 000 1.5h3.75a.75.75 0 000-1.5H15zM14.25 12a.75.75 0 01.75-.75h3.75a.75.75 0 010 1.5H15a.75.75 0 01-.75-.75zm.75 2.25a.75.75 0 000 1.5h3.75a.75.75 0 000-1.5H15z" clip-rule="evenodd" /></svg>`,
    user: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-7 h-7"><path d="M11.7 2.805a.75.75 0 01.6 0A60.65 60.65 0 0122.83 8.72a.75.75 0 01-.231 1.337 49.949 49.949 0 00-9.902 3.912l-.003.002-.34.18a.75.75 0 01-.707 0A50.009 50.009 0 007.5 12.174v-.224c0-.131.067-.248.172-.311a54.614 54.614 0 014.653-2.52.75.75 0 00-.65-1.352 56.129 56.129 0 00-4.78 2.589 1.858 1.858 0 00-.859 1.228 49.803 49.803 0 00-4.634-1.527.75.75 0 01-.231-1.337A60.653 60.653 0 0111.7 2.805z" /><path d="M13.06 15.473a48.45 48.45 0 017.666-3.282c.134 1.414.22 2.843.255 4.285a.75.75 0 01-.46.71 47.878 47.878 0 00-8.105 4.342.75.75 0 01-.832 0 47.877 47.877 0 00-8.104-4.342.75.75 0 01-.461-.71c.035-1.442.121-2.87.255-4.286A48.4 48.4 0 016 13.18v1.27a1.5 1.5 0 00-.14 2.508c-.09.38-.222.753-.397 1.11.452.213.901.434 1.346.661a6.729 6.729 0 00.551-1.608 1.5 1.5 0 00.14-2.67v-.645a48.549 48.549 0 013.44 1.668 2.25 2.25 0 002.12 0z" /><path d="M4.462 19.462c.42-.419.753-.89 1-1.394.453.213.902.434 1.347.661a6.743 6.743 0 01-1.286 1.794.75.75 0 11-1.06-1.06z" /></svg>`,
    calendar: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M12.75 12.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM7.5 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM8.25 17.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM9.75 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM10.5 17.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM12.75 17.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM14.25 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM15 17.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM16.5 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM15 12.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM16.5 13.5a.75.75 0 100-1.5.75.75 0 000 1.5z" /><path fill-rule="evenodd" d="M6.75 2.25A.75.75 0 017.5 3v1.5h9V3A.75.75 0 0118 3v1.5h.75a3 3 0 013 3v11.25a3 3 0 01-3 3H5.25a3 3 0 01-3-3V7.5a3 3 0 013-3H6V3a.75.75 0 01.75-.75zm13.5 9a1.5 1.5 0 00-1.5-1.5H5.25a1.5 1.5 0 00-1.5 1.5v7.5a1.5 1.5 0 001.5 1.5h13.5a1.5 1.5 0 001.5-1.5v-7.5z" clip-rule="evenodd" /></svg>`,
    calendarPlus: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path fill-rule="evenodd" d="M6.75 2.25A.75.75 0 017.5 3v1.5h9V3A.75.75 0 0118 3v1.5h.75a3 3 0 013 3v11.25a3 3 0 01-3 3H5.25a3 3 0 01-3-3V7.5a3 3 0 013-3H6V3a.75.75 0 01.75-.75zm13.5 9a1.5 1.5 0 00-1.5-1.5H5.25a1.5 1.5 0 00-1.5 1.5v7.5a1.5 1.5 0 001.5 1.5h13.5a1.5 1.5 0 001.5-1.5v-7.5zM12 12.75a.75.75 0 01.75.75v2.25h2.25a.75.75 0 010 1.5h-2.25v2.25a.75.75 0 01-1.5 0v-2.25H9a.75.75 0 010-1.5h2.25V13.5a.75.75 0 01.75-.75z" clip-rule="evenodd" /></svg>`,
    arrowLeft: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path fill-rule="evenodd" d="M7.72 12.53a.75.75 0 010-1.06l7.5-7.5a.75.75 0 111.06 1.06L9.31 12l6.97 6.97a.75.75 0 11-1.06 1.06l-7.5-7.5z" clip-rule="evenodd" /></svg>`,
    arrowRight: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path fill-rule="evenodd" d="M16.28 11.47a.75.75 0 010 1.06l-7.5 7.5a.75.75 0 01-1.06-1.06L14.69 12 7.72 5.03a.75.75 0 011.06-1.06l7.5 7.5z" clip-rule="evenodd" /></svg>`,
    users: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.957-4.611 8.586 8.586 0 011.71 5.157v.003z" /></svg>`,
    bell: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path fill-rule="evenodd" d="M5.25 9a6.75 6.75 0 0113.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 01-.297 1.206c-1.544.57-3.16.99-4.831 1.243a3.75 3.75 0 11-7.48 0 24.585 24.585 0 01-4.831-1.244.75.75 0 01-.298-1.205A8.217 8.217 0 005.25 9.75V9zm4.502 8.9a2.25 2.25 0 104.496 0 25.057 25.057 0 01-4.496 0z" clip-rule="evenodd" /></svg>`
};

// ============================================
// Add to Calendar Functions
// ============================================
function generateCalendarEvent(phase, slotNum) {
    if (!state.data) return null;

    const nsuId = state.data.nsuId;
    const slotLabel = slotNum === 1 ? state.data.slot1Label : state.data.slot2Label;
    const slotStart = slotNum === 1 ? state.data.slot1Start : state.data.slot2Start;
    const slotEnd = slotNum === 1 ? state.data.slot1End : state.data.slot2End;

    // For Phase 2, we need to use Phase 2 date with same slot times
    let eventStart, eventEnd;
    if (phase === 1) {
        eventStart = slotStart;
        eventEnd = slotEnd;
    } else {
        // Phase 2 - same time but different date
        const phase2DateStr = state.data.phase2DatePart;
        const phase1Start = new Date(slotStart);
        const phase2Date = new Date(state.data.phase2DateRaw + 'T00:00:00');

        eventStart = new Date(phase2Date);
        eventStart.setHours(phase1Start.getHours(), phase1Start.getMinutes(), 0, 0);

        eventEnd = new Date(phase2Date);
        const phase1End = new Date(slotEnd);
        eventEnd.setHours(phase1End.getHours(), phase1End.getMinutes(), 0, 0);
    }

    return {
        title: `NSU Advising - Phase ${phase} Slot ${slotNum}`,
        description: `Student ID: ${nsuId}\\nSlot Time: ${slotLabel}\\nPhase ${phase} Advising\\n\\nDon't forget to log in to NSU Portal!`,
        start: eventStart,
        end: eventEnd,
        location: 'NSU Portal - rds3.northsouth.edu'
    };
}

function formatDateForGoogle(date) {
    return date.toISOString().replace(/-|:|\.\d{3}/g, '');
}

function formatDateForICS(date) {
    return date.toISOString().replace(/-|:|\.\d{3}/g, '').slice(0, -1);
}

function generateGoogleCalendarUrl(event) {
    const baseUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
    const params = new URLSearchParams({
        text: event.title,
        details: event.description.replace(/\\n/g, '\n'),
        location: event.location,
        dates: `${formatDateForGoogle(event.start)}/${formatDateForGoogle(event.end)}`
    });
    return `${baseUrl}&${params.toString()}`;
}

function generateICSFile(event) {
    // Add 1 minute reminder
    const reminderTime = new Date(event.start.getTime() - 60000); // 1 minute before

    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//NSU Nexus//Advising Slot//EN
BEGIN:VEVENT
DTSTART:${formatDateForICS(event.start)}Z
DTEND:${formatDateForICS(event.end)}Z
SUMMARY:${event.title}
DESCRIPTION:${event.description.replace(/\\n/g, '\\n')}
LOCATION:${event.location}
BEGIN:VALARM
TRIGGER:-PT1M
ACTION:DISPLAY
DESCRIPTION:Your advising slot starts in 1 minute!
END:VALARM
BEGIN:VALARM
TRIGGER:-PT5M
ACTION:DISPLAY
DESCRIPTION:Your advising slot starts in 5 minutes!
END:VALARM
END:VEVENT
END:VCALENDAR`;

    return icsContent;
}

function downloadICSFile(event) {
    const icsContent = generateICSFile(event);
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `NSU_Advising_Phase${event.title.includes('Phase 1') ? '1' : '2'}_Slot${event.title.includes('Slot 1') ? '1' : '2'}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function showCalendarOptions(phase, slotNum) {
    const event = generateCalendarEvent(phase, slotNum);
    if (!event) return;

    const modal = document.createElement('div');
    modal.id = 'calendarModal';
    modal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4';
    modal.innerHTML = `
        <div class="bg-white rounded-2xl p-5 max-w-xs w-full shadow-2xl">
            <h3 class="text-lg font-bold text-gray-800 mb-1">Add to Calendar</h3>
            <p class="text-xs text-gray-500 mb-4">Phase ${phase} - Slot ${slotNum} • Reminder: 1 & 5 min before</p>
            
            <div class="space-y-2">
                <a href="${generateGoogleCalendarUrl(event)}" target="_blank" 
                   class="flex items-center gap-3 p-3 bg-white border-2 border-gray-100 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-all">
                    <img src="https://www.gstatic.com/calendar/images/dynamiclogo_2020q4/calendar_31_2x.png" class="w-6 h-6" alt="Google">
                    <span class="font-medium text-gray-700 text-sm">Google Calendar</span>
                </a>
                
                <button onclick="downloadICSFile(generateCalendarEvent(${phase}, ${slotNum}))" 
                        class="flex items-center gap-3 p-3 bg-white border-2 border-gray-100 rounded-xl hover:border-gray-400 hover:bg-gray-50 transition-all w-full text-left">
                    <svg class="w-6 h-6 text-gray-600" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm-8 4H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/>
                    </svg>
                    <div>
                        <span class="font-medium text-gray-700 text-sm block">Download .ics</span>
                        <span class="text-[10px] text-gray-400">iPhone, Samsung, Outlook, etc.</span>
                    </div>
                </button>
                
                <a href="${generateOutlookUrl(event)}" target="_blank"
                   class="flex items-center gap-3 p-3 bg-white border-2 border-gray-100 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="#0078D4">
                        <path d="M24 7.387v10.478c0 .23-.08.424-.238.576-.158.154-.352.23-.58.23h-8.547v-6.959l1.6 1.229c.102.086.227.129.375.129.148 0 .273-.043.375-.129l.027-.02 6.988-5.369v-.165zm-.238-1.716c.158.152.238.346.238.576v.166l-7.363 5.66-1.602-1.229v-5.173h8.147c.228 0 .422.077.58.23v-.23zM14.635 6.67v12h-8.547c-.228 0-.422-.076-.58-.23-.158-.152-.238-.346-.238-.576V7.387c0-.23.08-.424.238-.576.158-.153.352-.23.58-.23h8.547v.089zM9.094 9.4c-.82 0-1.484.664-1.484 1.484v2.232c0 .82.664 1.484 1.484 1.484.82 0 1.484-.664 1.484-1.484v-2.232c0-.82-.664-1.484-1.484-1.484z"/>
                    </svg>
                    <span class="font-medium text-gray-700 text-sm">Outlook Web</span>
                </a>
                
                <a href="${generateYahooUrl(event)}" target="_blank"
                   class="flex items-center gap-3 p-3 bg-white border-2 border-gray-100 rounded-xl hover:border-purple-400 hover:bg-purple-50 transition-all">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="#6001D2">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                    </svg>
                    <span class="font-medium text-gray-700 text-sm">Yahoo Calendar</span>
                </a>
            </div>
            
            <button onclick="document.getElementById('calendarModal').remove()" 
                    class="mt-4 w-full py-2 text-gray-400 hover:text-gray-600 text-xs font-medium">
                Cancel
            </button>
        </div>
    `;

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);
}

// Show main calendar modal with slot selection
function showCalendarModal() {
    const modal = document.createElement('div');
    modal.id = 'calendarModal';
    modal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4';
    modal.innerHTML = `
        <div class="bg-white rounded-2xl p-5 max-w-xs w-full shadow-2xl">
            <div class="flex items-center gap-2 mb-4">
                <div class="w-10 h-10 bg-gradient-to-br from-teal-500 to-orange-500 rounded-xl flex items-center justify-center text-white">
                    ${SVG_ICONS.bell}
                </div>
                <div>
                    <h3 class="text-lg font-bold text-gray-800">Add to Calendar</h3>
                    <p class="text-[10px] text-gray-500">Get reminded 1 & 5 min before</p>
                </div>
            </div>
            
            <p class="text-xs text-gray-600 mb-3 font-medium">Select which slot to add:</p>
            
            <div class="space-y-2 mb-2">
                <p class="text-[10px] text-teal-600 font-bold uppercase">Phase 1 - ${state.data.phase1DatePart}</p>
                <div class="grid grid-cols-2 gap-2">
                    <button onclick="document.getElementById('calendarModal').remove(); showCalendarOptions(1, 1)" 
                            class="p-2 bg-teal-50 border border-teal-200 rounded-lg text-xs font-medium text-teal-700 hover:bg-teal-100 transition-all">
                        Slot 1<br><span class="text-[10px] text-teal-500">${state.data.slot1Label.split(' - ')[0]}</span>
                    </button>
                    <button onclick="document.getElementById('calendarModal').remove(); showCalendarOptions(1, 2)" 
                            class="p-2 bg-teal-50 border border-teal-200 rounded-lg text-xs font-medium text-teal-700 hover:bg-teal-100 transition-all">
                        Slot 2<br><span class="text-[10px] text-teal-500">${state.data.slot2Label.split(' - ')[0]}</span>
                    </button>
                </div>
            </div>
            
            <div class="space-y-2">
                <p class="text-[10px] text-orange-600 font-bold uppercase">Phase 2 - ${state.data.phase2DatePart}</p>
                <div class="grid grid-cols-2 gap-2">
                    <button onclick="document.getElementById('calendarModal').remove(); showCalendarOptions(2, 1)" 
                            class="p-2 bg-orange-50 border border-orange-200 rounded-lg text-xs font-medium text-orange-700 hover:bg-orange-100 transition-all">
                        Slot 1<br><span class="text-[10px] text-orange-500">${state.data.slot1Label.split(' - ')[0]}</span>
                    </button>
                    <button onclick="document.getElementById('calendarModal').remove(); showCalendarOptions(2, 2)" 
                            class="p-2 bg-orange-50 border border-orange-200 rounded-lg text-xs font-medium text-orange-700 hover:bg-orange-100 transition-all">
                        Slot 2<br><span class="text-[10px] text-orange-500">${state.data.slot2Label.split(' - ')[0]}</span>
                    </button>
                </div>
            </div>
            
            <button onclick="document.getElementById('calendarModal').remove()" 
                    class="mt-4 w-full py-2 text-gray-400 hover:text-gray-600 text-xs font-medium">
                Cancel
            </button>
        </div>
    `;

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);
}

// Generate Outlook Web URL
function generateOutlookUrl(event) {
    const startTime = event.start.toISOString();
    const endTime = event.end.toISOString();
    return `https://outlook.live.com/calendar/0/deeplink/compose?subject=${encodeURIComponent(event.title)}&body=${encodeURIComponent(event.description.replace(/\\n/g, '\n'))}&startdt=${startTime}&enddt=${endTime}&location=${encodeURIComponent(event.location)}`;
}

// Generate Yahoo Calendar URL
function generateYahooUrl(event) {
    const formatYahooDate = (date) => {
        return date.toISOString().replace(/-|:|\.\d{3}/g, '').slice(0, -1);
    };
    return `https://calendar.yahoo.com/?v=60&title=${encodeURIComponent(event.title)}&desc=${encodeURIComponent(event.description.replace(/\\n/g, '\n'))}&st=${formatYahooDate(event.start)}&et=${formatYahooDate(event.end)}&in_loc=${encodeURIComponent(event.location)}`;
}

// ============================================
// Main Render Function
// ============================================
function render() {
    const content = document.getElementById('content');

    if (!state.data) {
        // Search View - Teal & Orange Theme
        content.innerHTML = `
            <div class="flex flex-col items-center text-center py-4">
                <!-- Header Icon -->
                <div class="flex items-center gap-3 mb-4">
                    <div class="w-11 h-11 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-teal-500/25 flex-shrink-0 text-white" style="background: linear-gradient(to bottom right, #14b8a6, #06b6d4);">
                        ${SVG_ICONS.clock}
                    </div>
                    <div class="text-left">
                        <h2 class="text-lg sm:text-2xl font-bold text-gray-800 whitespace-nowrap">Spring 2026 Advising</h2>
                        <p class="text-transparent bg-clip-text bg-gradient-to-r from-teal-500 to-orange-500 text-[9px] sm:text-xs font-bold uppercase tracking-wide whitespace-nowrap">Check your designated time slot</p>
                    </div>
                </div>

                <h3 class="text-xl font-bold text-gray-800 mb-1">Check Your Advising Slot</h3>
                <p class="text-gray-500 text-sm mb-5">
                    Find your designated time for Spring 2026 course registration.
                </p>
                
                <form id="searchForm" class="w-full space-y-4">
                    <!-- Input Field - Clean Design -->
                    <div class="relative w-full">
                        <div class="w-full bg-gray-50 rounded-2xl flex items-center transition-all shadow-sm hover:shadow-md focus-within:shadow-lg focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-400/50 overflow-hidden">
                            <div class="pl-4 pr-3 flex-shrink-0">
                                <div class="w-10 h-10 bg-gradient-to-br from-teal-500 to-cyan-500 rounded-xl flex items-center justify-center text-white shadow-md" style="background: linear-gradient(to bottom right, #14b8a6, #06b6d4);">
                                    ${SVG_ICONS.idCard}
                                </div>
                            </div>
                            <input 
                                type="text" 
                                id="nsuIdInput"
                                value="${state.nsuId}"
                                placeholder="e.g. 2321854"
                                class="w-full bg-transparent text-gray-800 text-xl sm:text-2xl font-bold py-4 pr-4 focus:outline-none placeholder:text-gray-300 tracking-widest font-mono"
                                maxlength="7"
                                autofocus
                            />
                        </div>
                    </div>
                    
                    <!-- Helper text -->
                    <p class="text-center text-gray-400 text-xs">Enter first 7 digits of your NSU ID</p>
                    
                    <!-- Error Message -->
                    ${state.error ? `
                        <div class="w-full bg-red-50 border border-red-200 rounded-xl p-3 flex items-center justify-center gap-2">
                            <i class="fas fa-exclamation-triangle text-red-500"></i>
                            <span class="text-red-600 text-sm font-medium">${state.error}</span>
                        </div>
                    ` : ''}

                    <!-- Submit Button -->
                    <button 
                        type="submit" 
                        ${state.loading || state.nsuId.length < 7 ? 'disabled' : ''}
                        class="relative w-full py-3 rounded-xl font-bold text-base text-white shadow-lg overflow-hidden group transition-all transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 ${state.loading ? 'cursor-wait' : ''}"
                    >
                        <div class="absolute inset-0 bg-gradient-to-r from-teal-500 via-cyan-500 to-orange-500" style="background: linear-gradient(to right, #14b8a6, #06b6d4, #f97316);"></div>
                        <span class="relative z-10 flex items-center justify-center gap-2 drop-shadow-md">
                            ${state.loading ? `
                                <span class="nsunexus-inline-loader"></span>
                                <span>Loading...</span>
                            ` : `
                                <span>View Schedule</span>
                                ${SVG_ICONS.arrowRight}
                            `}
                        </span>
                    </button>
                </form>

                <!-- Status Bar -->
                <div class="mt-4 pt-3 border-t border-gray-100 w-full">
                    <div class="flex items-center justify-center gap-2 text-[9px] sm:text-xs">
                        <!-- Database Status -->
                        <div class="flex items-center gap-1 whitespace-nowrap">
                            ${state.dbStatus === 'checking' ? `
                                <span class="w-2 h-2 rounded-full bg-yellow-500 animate-pulse flex-shrink-0"></span>
                                <span class="text-yellow-600">Connecting...</span>
                            ` : state.dbStatus === 'connected' ? `
                                <span class="w-2 h-2 rounded-full bg-green-500 flex-shrink-0"></span>
                                <span class="text-green-600">Closest Server Connected</span>
                            ` : `
                                <span class="w-2 h-2 rounded-full bg-red-500 flex-shrink-0"></span>
                                <span class="text-red-600">Server Error</span>
                            `}
                        </div>
                        
                        <!-- Divider -->
                        <span class="text-gray-300">|</span>
                        
                        <!-- Total Students -->
                        ${state.dbStatus === 'connected' ? `
                            <div class="flex items-center gap-1 whitespace-nowrap text-teal-600">
                                ${SVG_ICONS.users}
                                <span class="text-gray-500">${state.totalStudents.toLocaleString()} Students this semester</span>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;

        // Attach event listeners
        attachSearchListeners();
    } else {
        // Result View - Teal & Orange Theme - Compact
        const timeLeft = calculateTimeLeft(state.countdownTarget);
        const slot1Active = state.phase === 'WAITING_SLOT_1' || state.phase === 'SLOT_1_LIVE';
        const slot2Active = state.phase === 'WAITING_SLOT_2' || state.phase === 'SLOT_2_LIVE';

        content.innerHTML = `
            <div class="flex flex-col">
                <!-- Header -->
                <div class="flex items-center mb-3 gap-2">
                    <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 via-cyan-500 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-500/30 flex-shrink-0 text-white">
                        ${SVG_ICONS.clock}
                    </div>
                    <div class="min-w-0">
                        <h2 class="text-base sm:text-lg font-bold text-gray-800 whitespace-nowrap">Spring 2026 Advising</h2>
                        <p class="text-transparent bg-clip-text bg-gradient-to-r from-teal-500 to-orange-500 text-[8px] font-bold uppercase tracking-wide whitespace-nowrap">Your designated time slot</p>
                    </div>
                </div>

                <!-- Student ID Card - Compact -->
                <div class="relative bg-gradient-to-r from-teal-500 via-cyan-500 to-orange-500 rounded-xl p-3 mb-3 shadow-lg shadow-teal-500/20 overflow-hidden">
                    <div class="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2"></div>
                    <div class="relative flex items-center justify-between">
                        <div>
                            <p class="text-white/80 text-[9px] font-bold uppercase tracking-wider mb-0.5 flex items-center gap-1">
                                <span class="w-3 h-3">${SVG_ICONS.idCard.replace('w-5 h-5', 'w-3 h-3')}</span>
                                Student ID
                            </p>
                            <p class="text-2xl font-black text-white tracking-widest font-mono drop-shadow-lg">
                                ${state.data.nsuId}
                            </p>
                        </div>
                        <div class="w-11 h-11 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center border border-white/30 text-white">
                            ${SVG_ICONS.user}
                        </div>
                    </div>
                </div>

                <!-- Phase Dates -->
                <div class="grid grid-cols-2 gap-3 mb-4">
                    <!-- Phase 1 Date -->
                    <div class="relative bg-gradient-to-br from-teal-50 to-cyan-50 border-2 border-teal-300 rounded-2xl p-4 shadow-lg shadow-teal-500/10 overflow-hidden">
                        <div class="relative">
                            <div class="flex items-center gap-2 mb-2">
                                <div class="w-7 h-7 bg-gradient-to-br from-teal-500 to-cyan-500 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
                                    <span class="text-white text-sm font-black">1</span>
                                </div>
                                <p class="text-teal-600 text-xs font-bold uppercase tracking-wide">Phase 1</p>
                            </div>
                            <p class="text-gray-800 text-lg font-bold">${state.data.phase1DayOfWeek}</p>
                            <p class="text-gray-500 text-sm font-medium">${state.data.phase1DatePart}</p>
                        </div>
                    </div>
                    
                    <!-- Phase 2 Date -->
                    <div class="relative bg-gradient-to-br from-orange-50 to-amber-50 border-2 border-orange-300 rounded-2xl p-4 shadow-lg shadow-orange-500/10 overflow-hidden">
                        <div class="relative">
                            <div class="flex items-center gap-2 mb-2">
                                <div class="w-7 h-7 bg-gradient-to-br from-orange-500 to-amber-500 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
                                    <span class="text-white text-sm font-black">2</span>
                                </div>
                                <p class="text-orange-600 text-xs font-bold uppercase tracking-wide">Phase 2</p>
                            </div>
                            <p class="text-gray-800 text-lg font-bold">${state.data.phase2DayOfWeek}</p>
                            <p class="text-gray-500 text-sm font-medium">${state.data.phase2DatePart}</p>
                        </div>
                    </div>
                </div>

                <!-- Slot Times - Compact -->
                <div class="bg-white rounded-xl overflow-hidden mb-3 shadow-md border border-red-100">
                    <div class="bg-gradient-to-r from-red-500 via-red-600 to-rose-500 px-3 py-2">
                        <p class="text-white text-[10px] font-bold uppercase tracking-wider text-center flex items-center justify-center gap-1.5">
                            <span class="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
                            Your Slot Times (Same for both phases)
                            <span class="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
                        </p>
                    </div>
                    <div class="p-2 space-y-2">
                        ${renderSlotCardLight('SLOT 1', state.data.slot1Label, slot1Active, getSlot1Status())}
                        ${renderSlotCardLight('SLOT 2', state.data.slot2Label, slot2Active, getSlot2Status())}
                    </div>
                </div>

                <!-- Add to Calendar Button - Small -->
                <div class="flex justify-center mb-3">
                    <button onclick="showCalendarModal()" class="flex items-center gap-1.5 bg-gradient-to-r from-teal-500 to-orange-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-md shadow-teal-500/20 hover:scale-105 transition-all">
                        ${SVG_ICONS.bell}
                        <span>Add to Calendar</span>
                    </button>
                </div>

                <!-- Countdown - Compact -->
                <div class="mb-4">
                    ${state.phase === 'ENDED' ? `
                        <div class="text-center p-4 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl border border-gray-300">
                            <i class="fas fa-check-circle text-2xl text-gray-400 mb-1"></i>
                            <p class="text-sm font-bold text-gray-600">ADVISING SLOT ENDED</p>
                            <p class="text-[10px] text-gray-500">Contact the department if you missed it.</p>
                        </div>
                    ` : renderCountdownTimerLight(timeLeft, state.countdownLabel)}
                </div>

                <!-- Footer Action - Compact -->
                <div class="text-center">
                    <button 
                        id="resetBtn"
                        class="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl font-bold text-white shadow-lg shadow-teal-500/20 transition-all hover:scale-105 active:scale-95 group bg-gradient-to-r from-teal-500 via-cyan-500 to-orange-500 text-sm"
                    >
                        <span>${SVG_ICONS.arrowLeft}</span>
                        <span>Check Another ID</span>
                    </button>
                </div>
            </div>
        `;

        // Attach reset button listener
        document.getElementById('resetBtn').addEventListener('click', resetState);
    }
}

// ============================================
// Event Listeners
// ============================================
function attachSearchListeners() {
    const form = document.getElementById('searchForm');
    const input = document.getElementById('nsuIdInput');

    if (input) {
        input.addEventListener('input', (e) => {
            const val = e.target.value.replace(/\D/g, '');
            if (val.length <= 7) {
                state.nsuId = val;
                e.target.value = val;

                // Clear error when typing
                if (state.error) {
                    state.error = '';
                    render();
                }

                // Auto-fetch when 7 digits entered
                if (val.length === 7) {
                    performFetch(val);
                }
            }
        });
    }

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (state.nsuId.length === 7) {
                performFetch(state.nsuId);
            }
        });
    }
}

function resetState() {
    state = {
        nsuId: '',
        data: null,
        loading: false,
        error: '',
        phase: 'WAITING_SLOT_1',
        countdownTarget: null,
        countdownLabel: '',
        dbStatus: state.dbStatus,
        totalStudents: state.totalStudents
    };
    render();
}

// ============================================
// Countdown Update Loop
// ============================================
let countdownInterval = null;

function startCountdownLoop() {
    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        // Update phase countdowns on search page
        const phaseCountdowns = document.querySelectorAll('.phase-countdown');
        phaseCountdowns.forEach(el => {
            const phaseNum = el.dataset.phase;
            let phaseStart, phaseEnd;
            if (phaseNum === '1') {
                phaseStart = PHASE_DATES.phase1;
                phaseEnd = PHASE_DATES.phase1End;
            } else if (phaseNum === '2') {
                phaseStart = PHASE_DATES.phase2;
                phaseEnd = PHASE_DATES.phase2End;
            } else {
                phaseStart = PHASE_DATES.phase3;
                phaseEnd = PHASE_DATES.phase3End;
            }

            const status = getPhaseStatus(phaseStart, phaseEnd);
            if (status.status === 'upcoming') {
                const spans = el.querySelectorAll('span');
                if (spans.length === 4) {
                    spans[0].textContent = status.days + 'd';
                    spans[1].textContent = status.hours + 'h';
                    spans[2].textContent = status.mins + 'm';
                    spans[3].textContent = status.secs + 's';
                }
            }
        });

        // Update result page countdown
        if (state.data) {
            updatePhase();

            const timeLeft = calculateTimeLeft(state.countdownTarget);
            const countdownValues = document.querySelectorAll('.countdown-value');

            countdownValues.forEach(el => {
                const label = el.dataset.label;
                let newValue;

                switch (label) {
                    case 'DAYS': newValue = timeLeft.days; break;
                    case 'HOURS': newValue = timeLeft.hours; break;
                    case 'MINS': newValue = timeLeft.minutes; break;
                    case 'SECS': newValue = timeLeft.seconds; break;
                }

                const formatted = String(newValue).padStart(2, '0');
                if (el.textContent.trim() !== formatted) {
                    el.textContent = formatted;
                }
            });
        }
    }, 1000);
}

// ============================================
// Initialize
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded');

    // Check if Supabase loaded
    if (!window.supabase) {
        console.error('Supabase library not loaded!');
        document.getElementById('content').innerHTML = `
            <div class="text-center py-8">
                <p class="text-red-400">Error: Failed to load Supabase library. Please refresh.</p>
            </div>
        `;
        return;
    }

    // Initialize Supabase client
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Render phase cards first (outside modal)
    renderPhaseCards();

    render();
    startCountdownLoop();

    // Check database connection
    checkDatabaseStatus();

    // Initialize stats - fetch initial data and subscribe to real-time updates
    fetchInitialStats();
    subscribeToStats();
});