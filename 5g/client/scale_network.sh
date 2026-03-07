#!/usr/bin/env bash
# =============================================================================
# scale_network.sh — CityLearn 5G Infrastructure Auto-Scaler (Bash)
# =============================================================================
#
# Lightweight alternative to scale_network.py — no Python required.
#
# STATE FLOW (no backend needed):
#   [React slider changes]
#     └─ useBuildingSync hook  →  POST /api/buildings
#          └─ Vite middleware (vite.config.js)  →  ./state/buildings.txt
#               └─ this script (--watch) reads the file and scales Docker
#
# Start the React app first:  npm start   (CRA, port 3000)
# Then run this script in a second terminal:  ./scale_network.sh --watch
#
# SCALING TABLE (1 gNB per 8 buildings — 3GPP TR 38.913):
#   Buildings  | Active gNBs | Active edge-UPFs | Active MEC nodes
#   -----------|-------------|------------------|------------------
#   0          |  0          |  0               |  0
#   1 – 8      |  1          |  1               |  1   (Group 1)
#   9 – 16     |  2          |  2               |  2   (Group 1+2)
#   17 – 20    |  3          |  3               |  3   (Group 1+2+3)
#
# Usage:
#   ./scale_network.sh --watch               # recommended: auto-reacts to UI slider
#   ./scale_network.sh --watch --interval 2  # poll every 2 s (default 3 s)
#   ./scale_network.sh <buildings>           # one-shot manual override
#   ./scale_network.sh --file ./state/buildings.txt  # explicit file path
#   ./scale_network.sh --dry-run 12         # show plan, no action
#   ./scale_network.sh --status             # show container states
# =============================================================================

set -euo pipefail

# ─── CONSTANTS ─────────────────────────────────────────────────────────────────

readonly GNB_PER_N=8          # buildings per gNB (3GPP urban micro-cell)
readonly MAX_BUILDINGS=20

# ─── COLOUR CODES ──────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

# ─── SCALABLE CONTAINER GROUPS ─────────────────────────────────────────────────
# Group 1 — gNB-1, edge-UPF-1, MEC-1  (buildings ≥ 1)
GROUP1_CONTAINERS=(
    "ueransim-gnb-1"
    "free5gc-upf-edge-1"
    "mec-node-1"
)

# Group 2 — gNB-2, edge-UPF-2, MEC-2  (buildings ≥ 9)
GROUP2_CONTAINERS=(
    "ueransim-gnb-2"
    "free5gc-upf-edge-2"
    "mec-node-2"
)

# Group 3 — gNB-3, edge-UPF-3, MEC-3  (buildings ≥ 17)
GROUP3_CONTAINERS=(
    "ueransim-gnb-3"
    "free5gc-upf-edge-3"
    "mec-node-3"
)

# Core containers — always running, never touched by this script
ALWAYS_ON=(
    "free5gc-mongodb"
    "free5gc-nrf"
    "free5gc-ausf"
    "free5gc-udr"
    "free5gc-udm"
    "free5gc-pcf"
    "free5gc-nssf"
    "free5gc-bsf"
    "free5gc-amf"
    "free5gc-smf"
    "free5gc-upf-central"
    "free5gc-webui"
    "free5gc-prometheus"
    "citylearn-state-server"
)

# ─── GLOBALS ───────────────────────────────────────────────────────────────────
DRY_RUN=false
WATCH=false
INTERVAL=3
BUILDINGS=""
SOURCE_FILE=""
SOURCE_API=""

# =============================================================================
# HELPERS
# =============================================================================

log_info()    { echo -e "${CYAN}  ℹ  $*${NC}"; }
log_success() { echo -e "${GREEN}  ✓  $*${NC}"; }
log_warn()    { echo -e "${YELLOW}  ⚠  $*${NC}"; }
log_error()   { echo -e "${RED}  ✗  $*${NC}" >&2; }
log_step()    { echo -e "${BOLD}  ▶  $*${NC}"; }
separator()   { echo -e "${DIM}─────────────────────────────────────────────────────────${NC}"; }

# Check if a container is currently running
is_running() {
    local name="$1"
    local status
    status=$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || echo "not_found")
    [[ "$status" == "running" ]]
}

# Check if a container exists (any state)
container_exists() {
    docker inspect "$1" &>/dev/null
}

# Start a container (must exist — created by `docker compose up --no-start`)
start_container() {
    local name="$1"
    if ! container_exists "$name"; then
        log_warn "$name does not exist. Run 'docker compose up --no-start' first."
        return 1
    fi
    if is_running "$name"; then
        log_info "$name already running — skipping."
        return 0
    fi
    if $DRY_RUN; then
        log_info "[dry-run] would START → $name"
        return 0
    fi
    log_step "Starting $name …"
    docker start "$name" >/dev/null
    log_success "Started $name"
}

# Stop a container gracefully (10 s timeout)
stop_container() {
    local name="$1"
    if ! container_exists "$name"; then
        log_warn "$name not found — skipping."
        return 0
    fi
    if ! is_running "$name"; then
        log_info "$name not running — skipping."
        return 0
    fi
    if $DRY_RUN; then
        log_info "[dry-run] would STOP  → $name"
        return 0
    fi
    log_step "Stopping $name …"
    docker stop --time 10 "$name" >/dev/null
    log_success "Stopped $name"
}

# =============================================================================
# BUILDING COUNT RESOLUTION
# =============================================================================

get_buildings_from_file() {
    local path="$1"
    if [[ ! -f "$path" ]]; then
        log_error "State file not found: $path"
        exit 1
    fi
    local val
    val=$(head -n1 "$path" | tr -d '[:space:]')
    if ! [[ "$val" =~ ^[0-9]+$ ]]; then
        log_error "Invalid building count in file '$path': '$val'"
        exit 1
    fi
    echo "$val"
}

get_buildings_from_api() {
    local url="$1"
    local raw
    raw=$(curl -sf --max-time 5 "$url" || true)
    if [[ -z "$raw" ]]; then
        log_error "No response from API: $url"
        exit 1
    fi
    # Try JSON {"buildings": N} first, then plain integer
    local val
    val=$(echo "$raw" | grep -oP '"buildings"\s*:\s*\K[0-9]+' 2>/dev/null \
          || echo "$raw" | tr -d '[:space:]')
    if ! [[ "$val" =~ ^[0-9]+$ ]]; then
        log_error "Cannot parse building count from API response: '$raw'"
        exit 1
    fi
    echo "$val"
}

validate_buildings() {
    local n="$1"
    if (( n < 0 )); then
        log_error "Building count must be >= 0"
        exit 1
    fi
    if (( n > MAX_BUILDINGS )); then
        log_warn "Building count $n > max $MAX_BUILDINGS — clamping to $MAX_BUILDINGS"
        echo "$MAX_BUILDINGS"
        return
    fi
    echo "$n"
}

resolve_buildings() {
    local raw
    if [[ -n "$BUILDINGS" ]]; then
        raw="$BUILDINGS"
    elif [[ -n "$SOURCE_FILE" ]]; then
        raw=$(get_buildings_from_file "$SOURCE_FILE")
    elif [[ -n "$SOURCE_API" ]]; then
        raw=$(get_buildings_from_api "$SOURCE_API")
    else
        log_error "No building count source. Use a number, --file, or --api."
        usage
        exit 1
    fi
    validate_buildings "$raw"
}

# =============================================================================
# SCALING LOGIC
# =============================================================================

compute_gnbs() {
    # ceil(buildings / GNB_PER_N)
    local n="$1"
    if (( n == 0 )); then echo 0; return; fi
    echo $(( (n + GNB_PER_N - 1) / GNB_PER_N ))
}

# Determine which groups should be active for a given building count
# Outputs: space-separated list of active group numbers (1, 2, 3)
desired_active_groups() {
    local n="$1"
    local groups=()
    (( n >= 1  )) && groups+=(1)   # gNB-1 needed for 1–8 buildings
    (( n >= 9  )) && groups+=(2)   # gNB-2 needed for 9–16 buildings
    (( n >= 17 )) && groups+=(3)   # gNB-3 needed for 17–20 buildings
    echo "${groups[*]:-}"
}

# Get containers for a given group number
group_containers() {
    local g="$1"
    case "$g" in
        1) echo "${GROUP1_CONTAINERS[*]}" ;;
        2) echo "${GROUP2_CONTAINERS[*]}" ;;
        3) echo "${GROUP3_CONTAINERS[*]}" ;;
        *) echo "" ;;
    esac
}

# Check if any container in a group is running (group is "active" if any is up)
group_is_active() {
    local g="$1"
    for c in $(group_containers "$g"); do
        if is_running "$c"; then return 0; fi
    done
    return 1
}

# =============================================================================
# PLAN & APPLY
# =============================================================================

print_header() {
    local buildings="$1" gnbs="$2"
    separator
    echo -e "${BOLD}  CityLearn 5G Auto-Scaler${NC}"
    echo -e "  Buildings: ${CYAN}${buildings}${NC}  →  gNBs required: ${YELLOW}${gnbs}${NC}"
    $DRY_RUN && echo -e "  ${YELLOW}[DRY RUN — no changes will be made]${NC}"
    separator
}

print_plan_table() {
    local buildings="$1"
    local active_groups=$2   # space-separated

    printf "  %-10s %-30s %-12s\n" "Group" "Container" "Action"
    separator
    for g in 1 2 3; do
        local want=false
        [[ " $active_groups " =~ " $g " ]] && want=true

        local current=false
        group_is_active "$g" && current=true

        local action
        if $want && ! $current; then
            action="${GREEN}START${NC}"
        elif ! $want && $current; then
            action="${RED}STOP ${NC}"
        else
            action="${DIM}KEEP ${NC}"
        fi

        for c in $(group_containers "$g"); do
            printf "  %-10s %-30s " "Group $g" "$c"
            echo -e "$action"
        done
    done
    separator
}

scale() {
    local buildings="$1"
    local gnbs
    gnbs=$(compute_gnbs "$buildings")
    local active_groups
    active_groups=$(desired_active_groups "$buildings")

    print_header "$buildings" "$gnbs"
    print_plan_table "$buildings" "$active_groups"

    local changed=false

    # ── STOP groups that are no longer needed (stop before start to free resources)
    for g in 3 2 1; do
        if [[ " $active_groups " =~ " $g " ]]; then continue; fi
        if group_is_active "$g"; then
            echo -e "\n${RED}⏹  Deactivating Group $g …${NC}"
            for c in $(group_containers "$g"); do
                stop_container "$c"
            done
            changed=true
        fi
    done

    # ── START groups that are now needed
    for g in 1 2 3; do
        if ! [[ " $active_groups " =~ " $g " ]]; then continue; fi
        if ! group_is_active "$g"; then
            echo -e "\n${GREEN}▶  Activating Group $g …${NC}"
            for c in $(group_containers "$g"); do
                start_container "$c"
            done
            changed=true
        fi
    done

    if ! $changed; then
        log_success "Network already at the correct scale — no changes needed."
    fi
}

# =============================================================================
# STATUS
# =============================================================================

show_status() {
    separator
    echo -e "${BOLD}  Container Status${NC}"
    separator
    printf "  %-40s %-12s %s\n" "Container" "Status" "Role"
    separator

    for c in "${ALWAYS_ON[@]}"; do
        local status
        status=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo "not found")
        local color="$DIM"
        [[ "$status" == "running" ]] && color="$GREEN"
        [[ "$status" == "not found" ]] && color="$RED"
        printf "  %-40s ${color}%-12s${NC} %s\n" "$c" "$status" "core"
    done

    for g in 1 2 3; do
        for c in $(group_containers "$g"); do
            local status
            status=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo "not found")
            local color="$DIM"
            [[ "$status" == "running" ]] && color="$GREEN"
            [[ "$status" == "exited"  ]] && color="$YELLOW"
            [[ "$status" == "not found" ]] && color="$RED"
            printf "  %-40s ${color}%-12s${NC} group-%s\n" "$c" "$status" "$g"
        done
    done
    separator
}

# =============================================================================
# WATCH MODE
# =============================================================================

watch_loop() {
    log_info "Watch mode — polling every ${INTERVAL}s …"
    log_info "Press Ctrl+C to stop."

    local last_buildings=-1

    while true; do
        local buildings
        buildings=$(resolve_buildings 2>/dev/null || echo "-1")

        if [[ "$buildings" == "-1" ]]; then
            log_warn "Could not read building count — retrying in ${INTERVAL}s …"
            sleep "$INTERVAL"
            continue
        fi

        if [[ "$buildings" != "$last_buildings" ]]; then
            echo -e "\n${CYAN}🔄  Building count changed: ${last_buildings} → ${buildings}${NC}"
            scale "$buildings"
            last_buildings="$buildings"
        fi

        sleep "$INTERVAL"
    done
}

# =============================================================================
# ARGUMENT PARSING
# =============================================================================

usage() {
    cat <<EOF
Usage:
  ./scale_network.sh <buildings>
  ./scale_network.sh --file <path>
  ./scale_network.sh --api  <url>
  ./scale_network.sh --watch [--interval <seconds>]
  ./scale_network.sh --dry-run <buildings>
  ./scale_network.sh --status

Options:
  --file <path>        Read building count from file written by Vite middleware
                       (default: ./state/buildings.txt). Run `npm run dev` first.
  --watch              Continuous polling and auto-scaling (recommended)
  --interval <sec>     Poll interval for watch mode (default: 3)
  --dry-run            Show what would happen without making changes
  --status             Print current container statuses and exit
  -h, --help           Show this help
EOF
}

parse_args() {
    local show_status=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run|-n)
                DRY_RUN=true
                shift
                ;;
            --watch|-w)
                WATCH=true
                shift
                ;;
            --interval|-i)
                INTERVAL="${2:?'--interval requires a value'}"
                shift 2
                ;;
            --file|-f)
                SOURCE_FILE="${2:?'--file requires a path'}"
                shift 2
                ;;
            --api|-a)
                SOURCE_API="${2:?'--api requires a URL'}"
                shift 2
                ;;
            --status|-s)
                show_status=true
                shift
                ;;
            --help|-h)
                usage; exit 0
                ;;
            [0-9]*)
                # positional integer → building count
                BUILDINGS="$1"
                shift
                ;;
            *)
                log_error "Unknown argument: $1"
                usage; exit 1
                ;;
        esac
    done

    if $show_status; then
        show_status
        exit 0
    fi
}

# =============================================================================
# MAIN
# =============================================================================

main() {
    # Require Docker
    if ! command -v docker &>/dev/null; then
        log_error "docker not found in PATH."
        exit 1
    fi
    if ! docker info &>/dev/null; then
        log_error "Cannot connect to Docker daemon."
        exit 1
    fi

    parse_args "$@"

    if $WATCH; then
        trap 'echo -e "\n${YELLOW}🛑  Watch mode stopped.${NC}"; exit 0' INT TERM
        watch_loop
    else
        local buildings
        buildings=$(resolve_buildings)
        scale "$buildings"
        echo -e "\n${GREEN}✅  Scale operation complete.${NC}"
    fi
}

main "$@"