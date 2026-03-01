#!/usr/bin/env bash
#
# Pawd Bridge Installer
# Installs and configures the Pawd bridge server on Linux or macOS.
#
# Usage:
#   curl -fsSL pawd.app/install.sh | bash
#   curl -fsSL pawd.app/install.sh | bash -s -- --token <TOKEN>
#
# Options:
#   --token TOKEN          Auto-detect: sk-ant-oat* = OAuth, else API key
#   --oauth-token TOKEN    Explicitly set CLAUDE_CODE_OAUTH_TOKEN
#   --api-key KEY          Explicitly set ANTHROPIC_API_KEY
#   --domain DOMAIN        Custom domain (skip subdomain provisioning)
#   --port PORT            Bridge port (default: 3001)
#   --skip-nginx           Skip Nginx reverse-proxy setup
#   --skip-subdomain       Skip automatic subdomain provisioning
#   --skip-ssl             Skip Certbot / Let's Encrypt setup
#   --yes                  Accept all prompts automatically
#   --help                 Show this help message
#
set -euo pipefail

# ── Constants ──────────────────────────────────────────────────────────────────

PAWD_REPO="https://github.com/pawd-app/pawd.git"
PAWD_TARBALL="https://github.com/pawd-app/pawd/archive/refs/heads/main.tar.gz"
INSTALL_DIR="/opt/pawd"
CONFIG_DIR="${HOME}/.pawd"
RUNTIME_DIR="${HOME}/.pawd-bridge"
ENV_FILE="${CONFIG_DIR}/.env"
DEFAULT_PORT=3001
NODE_MIN_VERSION=20

# Supabase credentials — read from env or ~/.pawd/.env
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"

# ── Input defaults ─────────────────────────────────────────────────────────────

TOKEN=""
OAUTH_TOKEN=""
API_KEY=""
DOMAIN=""
PORT="${DEFAULT_PORT}"
SKIP_NGINX=false
SKIP_SUBDOMAIN=false
SKIP_SSL=false
AUTO_YES=false

# ── Color / formatting utilities ───────────────────────────────────────────────

setup_colors() {
  if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
    BOLD="\033[1m"
    DIM="\033[2m"
    RED="\033[0;31m"
    GREEN="\033[0;32m"
    YELLOW="\033[0;33m"
    BLUE="\033[0;34m"
    CYAN="\033[0;36m"
    RESET="\033[0m"
  else
    BOLD="" DIM="" RED="" GREEN="" YELLOW="" BLUE="" CYAN="" RESET=""
  fi
}

info()    { printf "${BLUE}${BOLD}==>${RESET} %s\n" "$*"; }
success() { printf "${GREEN}${BOLD} ok${RESET} %s\n" "$*"; }
warn()    { printf "${YELLOW}${BOLD}wrn${RESET} %s\n" "$*" >&2; }
error()   { printf "${RED}${BOLD}err${RESET} %s\n" "$*" >&2; }
step()    { printf "\n${CYAN}${BOLD}[%s]${RESET} ${BOLD}%s${RESET}\n" "$1" "$2"; }
dim()     { printf "${DIM}%s${RESET}\n" "$*"; }

banner() {
  printf "${CYAN}"
  cat << 'ART'

    ____                    __
   / __ \____ __      ____/ /
  / /_/ / __ `/ | /| / / __/
 / ____/ /_/ /| |/ |/ / /_
/_/    \__,_/ |__/|__/\__/

ART
  printf "${RESET}"
  dim "  Bridge Installer  v1.0"
  dim "  pawd.app"
  echo ""
}

# ── Helpers ────────────────────────────────────────────────────────────────────

abort() { error "$1"; exit 1; }

confirm() {
  if [[ "${AUTO_YES}" == "true" ]]; then return 0; fi
  local prompt="${1:-Continue?}"
  printf "${BOLD}%s [Y/n]${RESET} " "$prompt"
  read -r reply < /dev/tty || reply="y"
  case "$reply" in
    [nN]*) return 1 ;;
    *)     return 0 ;;
  esac
}

command_exists() { command -v "$1" &>/dev/null; }

version_ge() {
  # Returns 0 if $1 >= $2 (semver major comparison)
  local have="${1%%.*}"
  local need="${2%%.*}"
  [[ "$have" -ge "$need" ]]
}

detect_os() {
  case "$(uname -s)" in
    Linux*)  echo "linux" ;;
    Darwin*) echo "macos" ;;
    *)       echo "unknown" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)  echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *)             echo "$(uname -m)" ;;
  esac
}

is_root() { [[ "${EUID:-$(id -u)}" -eq 0 ]]; }

# ── Argument parsing ──────────────────────────────────────────────────────────

show_help() {
  cat << 'HELP'
Pawd Bridge Installer

Usage:
  curl -fsSL pawd.app/install.sh | bash
  curl -fsSL pawd.app/install.sh | bash -s -- --token <TOKEN> --yes

Options:
  --token TOKEN          Auto-detect token type (sk-ant-oat* = OAuth, else API key)
  --oauth-token TOKEN    Explicitly set CLAUDE_CODE_OAUTH_TOKEN
  --api-key KEY          Explicitly set ANTHROPIC_API_KEY
  --domain DOMAIN        Custom domain for Nginx/SSL (skips subdomain provisioning)
  --port PORT            Bridge port (default: 3001)
  --skip-nginx           Skip Nginx reverse-proxy setup
  --skip-subdomain       Skip automatic subdomain provisioning
  --skip-ssl             Skip Certbot / Let's Encrypt setup
  --yes                  Accept all prompts automatically
  --help                 Show this help message
HELP
  exit 0
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --token)
        TOKEN="$2"; shift 2 ;;
      --oauth-token)
        OAUTH_TOKEN="$2"; shift 2 ;;
      --api-key)
        API_KEY="$2"; shift 2 ;;
      --domain)
        DOMAIN="$2"; shift 2 ;;
      --port)
        PORT="$2"; shift 2 ;;
      --skip-nginx)
        SKIP_NGINX=true; shift ;;
      --skip-subdomain)
        SKIP_SUBDOMAIN=true; shift ;;
      --skip-ssl)
        SKIP_SSL=true; shift ;;
      --yes|-y)
        AUTO_YES=true; shift ;;
      --help|-h)
        show_help ;;
      *)
        warn "Unknown option: $1 (ignored)"; shift ;;
    esac
  done

  # Auto-detect token type
  if [[ -n "$TOKEN" ]]; then
    if [[ "$TOKEN" == sk-ant-oat* ]]; then
      OAUTH_TOKEN="$TOKEN"
      info "Detected OAuth token (sk-ant-oat prefix)"
    else
      API_KEY="$TOKEN"
      info "Detected API key"
    fi
  fi
}

# ── Step functions ─────────────────────────────────────────────────────────────

check_prerequisites() {
  step "1/12" "Checking prerequisites"

  OS=$(detect_os)
  ARCH=$(detect_arch)

  if [[ "$OS" == "unknown" ]]; then
    abort "Unsupported operating system: $(uname -s). Pawd supports Linux and macOS."
  fi

  info "OS: ${OS} | Arch: ${ARCH}"

  # Require curl or wget
  if ! command_exists curl && ! command_exists wget; then
    abort "curl or wget is required. Install one and re-run."
  fi

  # Require git or curl (for tarball fallback)
  if ! command_exists git; then
    warn "git not found. Will use tarball download as fallback."
  fi

  # Require openssl for key generation
  if ! command_exists openssl; then
    warn "openssl not found. Device identity generation will be skipped."
  fi

  success "Prerequisites satisfied"
}

setup_node() {
  step "2/12" "Checking Node.js (>= ${NODE_MIN_VERSION})"

  if command_exists node; then
    local node_version
    node_version="$(node --version | sed 's/^v//')"
    if version_ge "$node_version" "$NODE_MIN_VERSION"; then
      success "Node.js ${node_version} found"
      return 0
    else
      warn "Node.js ${node_version} is below minimum (${NODE_MIN_VERSION}+)"
    fi
  fi

  info "Installing Node.js via nvm..."

  # Install nvm if not present
  if [[ -z "${NVM_DIR:-}" ]]; then
    export NVM_DIR="${HOME}/.nvm"
  fi

  if [[ ! -s "${NVM_DIR}/nvm.sh" ]]; then
    info "Installing nvm..."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | PROFILE=/dev/null bash
  fi

  # shellcheck source=/dev/null
  source "${NVM_DIR}/nvm.sh" || abort "Failed to load nvm"

  nvm install 20 --default || abort "Failed to install Node.js 20 via nvm"
  nvm use 20

  if ! command_exists node; then
    abort "Node.js installation failed. Install Node.js >= ${NODE_MIN_VERSION} manually and re-run."
  fi

  success "Node.js $(node --version) installed via nvm"
}

create_service_user() {
  step "3/12" "Service user setup"

  if ! is_root; then
    info "Not running as root — skipping service user creation"
    PAWD_USER="$(whoami)"
    PAWD_HOME="${HOME}"
    success "Running as ${PAWD_USER}"
    return 0
  fi

  PAWD_USER="pawd"
  if id "$PAWD_USER" &>/dev/null; then
    info "Service user '${PAWD_USER}' already exists"
  else
    info "Creating service user '${PAWD_USER}'..."
    if [[ "$OS" == "linux" ]]; then
      useradd --system --create-home --shell /usr/sbin/nologin "$PAWD_USER" || abort "Failed to create user"
    else
      # macOS: create a standard user (no dscl system user for simplicity)
      sysadminctl -addUser "$PAWD_USER" -home "/Users/${PAWD_USER}" -shell /usr/bin/false 2>/dev/null \
        || dscl . -create "/Users/${PAWD_USER}" 2>/dev/null \
        || warn "Could not create macOS service user — continuing as root"
    fi
  fi

  PAWD_HOME="$(eval echo "~${PAWD_USER}")"
  CONFIG_DIR="${PAWD_HOME}/.pawd"
  RUNTIME_DIR="${PAWD_HOME}/.pawd-bridge"
  ENV_FILE="${CONFIG_DIR}/.env"
  success "Service user: ${PAWD_USER}"
}

setup_directories() {
  step "4/12" "Setting up directories"

  local dirs=(
    "${INSTALL_DIR}"
    "${CONFIG_DIR}"
    "${RUNTIME_DIR}"
    "${RUNTIME_DIR}/data"
    "${RUNTIME_DIR}/workspaces"
    "${RUNTIME_DIR}/logs"
  )

  for dir in "${dirs[@]}"; do
    if [[ ! -d "$dir" ]]; then
      mkdir -p "$dir"
      dim "  Created ${dir}"
    fi
  done

  # Fix ownership if running as root
  if is_root && [[ "${PAWD_USER}" != "root" ]]; then
    chown -R "${PAWD_USER}:${PAWD_USER}" "${CONFIG_DIR}" "${RUNTIME_DIR}" 2>/dev/null || true
  fi

  success "Directories ready"
}

clone_or_download() {
  step "5/12" "Downloading Pawd"

  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    info "Existing install found — pulling latest changes..."
    git -C "${INSTALL_DIR}" fetch --depth 1 origin main 2>/dev/null || true
    git -C "${INSTALL_DIR}" reset --hard origin/main 2>/dev/null || true
    success "Updated existing installation"
    return 0
  fi

  # Clean stale install directory (non-git)
  if [[ -d "${INSTALL_DIR}" ]] && [[ ! -d "${INSTALL_DIR}/.git" ]]; then
    local has_files
    has_files="$(ls -A "${INSTALL_DIR}" 2>/dev/null | head -1)"
    if [[ -n "$has_files" ]]; then
      warn "Non-git directory at ${INSTALL_DIR} — removing and re-cloning"
      rm -rf "${INSTALL_DIR}"
      mkdir -p "${INSTALL_DIR}"
    fi
  fi

  if command_exists git; then
    info "Cloning repository..."
    git clone --depth 1 "${PAWD_REPO}" "${INSTALL_DIR}" || {
      warn "git clone failed — falling back to tarball download"
      download_tarball
      return 0
    }
    success "Repository cloned"
  else
    download_tarball
  fi
}

download_tarball() {
  info "Downloading release tarball..."
  local tmp_tar
  tmp_tar="$(mktemp /tmp/pawd-XXXXXX.tar.gz)"

  curl -fsSL "${PAWD_TARBALL}" -o "${tmp_tar}" || abort "Failed to download tarball"
  tar xzf "${tmp_tar}" -C "${INSTALL_DIR}" --strip-components=1 || abort "Failed to extract tarball"
  rm -f "${tmp_tar}"

  success "Tarball extracted to ${INSTALL_DIR}"
}

build_project() {
  step "6/12" "Building Pawd bridge and CLI"

  # Ensure npm is available (nvm may need reloading)
  if ! command_exists npm; then
    if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
      # shellcheck source=/dev/null
      source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    fi
  fi
  command_exists npm || abort "npm not found. Ensure Node.js is installed correctly."

  # Install root workspace dependencies
  info "Installing dependencies..."
  (cd "${INSTALL_DIR}" && npm install --omit=dev 2>&1) || {
    warn "Root npm install had warnings — retrying with full install..."
    (cd "${INSTALL_DIR}" && npm install 2>&1) || abort "npm install failed"
  }

  # Build bridge
  info "Building bridge..."
  (cd "${INSTALL_DIR}/apps/bridge" && npm run build 2>&1) || abort "Bridge build failed"
  success "Bridge built"

  # Build CLI
  info "Building CLI..."
  (cd "${INSTALL_DIR}/apps/cli" && npm run build 2>&1) || abort "CLI build failed"
  success "CLI built"

  # Link CLI globally
  info "Linking 'pawd' command..."
  (cd "${INSTALL_DIR}/apps/cli" && npm link 2>/dev/null) || {
    warn "npm link failed — you may need to add the CLI to your PATH manually"
  }

  if command_exists pawd; then
    success "'pawd' command available globally"
  else
    dim "  Hint: you may need to restart your shell or add npm bin to PATH"
  fi
}

persist_credentials() {
  step "7/12" "Configuring credentials"

  # Prompt for token if not provided
  if [[ -z "$OAUTH_TOKEN" ]] && [[ -z "$API_KEY" ]]; then
    # Check if credentials already exist
    if [[ -f "$ENV_FILE" ]]; then
      if grep -qE "^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)=.+" "$ENV_FILE" 2>/dev/null; then
        info "Existing credentials found in ${ENV_FILE}"
        if ! confirm "Overwrite existing credentials?"; then
          success "Keeping existing credentials"
          return 0
        fi
      fi
    fi

    if [[ "${AUTO_YES}" != "true" ]]; then
      echo ""
      info "Enter your Claude authentication token."
      dim "  OAuth tokens start with sk-ant-oat-*"
      dim "  API keys start with sk-ant-api-*"
      echo ""
      printf "${BOLD}Token: ${RESET}"
      read -r TOKEN < /dev/tty || true

      if [[ -n "$TOKEN" ]]; then
        if [[ "$TOKEN" == sk-ant-oat* ]]; then
          OAUTH_TOKEN="$TOKEN"
        else
          API_KEY="$TOKEN"
        fi
      fi
    fi
  fi

  if [[ -z "$OAUTH_TOKEN" ]] && [[ -z "$API_KEY" ]]; then
    warn "No credentials provided. The bridge will start but cannot run agents."
    warn "Set credentials later: echo 'ANTHROPIC_API_KEY=sk-...' >> ${ENV_FILE}"
    return 0
  fi

  # Write .env file (atomic write)
  local tmp_env
  tmp_env="$(mktemp)"

  {
    echo "# Pawd Bridge credentials"
    echo "# Generated by install.sh on $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo ""
    echo "PORT=${PORT}"
    echo "DATA_DIR=${RUNTIME_DIR}/data"
    echo "AGENT_WORKSPACES_DIR=${RUNTIME_DIR}/workspaces"
    [[ -n "$OAUTH_TOKEN" ]] && echo "CLAUDE_CODE_OAUTH_TOKEN=${OAUTH_TOKEN}"
    [[ -n "$API_KEY" ]]     && echo "ANTHROPIC_API_KEY=${API_KEY}"
  } > "$tmp_env"

  mv "$tmp_env" "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  # Fix ownership if running as root
  if is_root && [[ "${PAWD_USER}" != "root" ]]; then
    chown "${PAWD_USER}:${PAWD_USER}" "$ENV_FILE" 2>/dev/null || true
  fi

  success "Credentials saved to ${ENV_FILE}"
}

install_claude_code() {
  step "8/12" "Installing Claude Code CLI"

  if command_exists claude; then
    local claude_ver
    claude_ver="$(claude --version 2>/dev/null || echo 'unknown')"
    info "Claude Code CLI already installed (${claude_ver})"

    if confirm "Update to latest?"; then
      npm install -g @anthropic-ai/claude-code@latest 2>&1 || {
        warn "Claude Code update failed — continuing with existing version"
        return 0
      }
      success "Claude Code CLI updated"
    fi
    return 0
  fi

  info "Installing @anthropic-ai/claude-code..."
  npm install -g @anthropic-ai/claude-code@latest 2>&1 || {
    warn "Claude Code CLI installation failed. Install manually: npm i -g @anthropic-ai/claude-code@latest"
    return 0
  }

  success "Claude Code CLI installed"
}

generate_device_identity() {
  step "9/12" "Generating device identity"

  local key_dir="${CONFIG_DIR}/keys"
  local private_key="${key_dir}/device.key"
  local public_key="${key_dir}/device.pub"
  local device_id_file="${CONFIG_DIR}/device-id"

  if [[ -f "$private_key" ]] && [[ -f "$public_key" ]]; then
    info "Device identity already exists"
    if [[ -f "$device_id_file" ]]; then
      dim "  Device ID: $(cat "$device_id_file")"
    fi
    success "Existing identity preserved"
    return 0
  fi

  if ! command_exists openssl; then
    warn "openssl not found — skipping device identity generation"
    return 0
  fi

  mkdir -p "$key_dir"

  # Generate Ed25519 key pair
  openssl genpkey -algorithm Ed25519 -out "$private_key" 2>/dev/null || {
    warn "Ed25519 key generation failed — trying RSA fallback"
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$private_key" 2>/dev/null || {
      warn "Key generation failed entirely — skipping"
      return 0
    }
  }

  openssl pkey -in "$private_key" -pubout -out "$public_key" 2>/dev/null || {
    warn "Public key extraction failed"
    return 0
  }

  chmod 600 "$private_key"
  chmod 644 "$public_key"

  # Derive a stable device ID from the public key fingerprint
  local fingerprint
  fingerprint="$(openssl pkey -pubin -in "$public_key" -outform DER 2>/dev/null | openssl dgst -sha256 -hex 2>/dev/null | awk '{print $NF}' | head -c 16)"

  if [[ -n "$fingerprint" ]]; then
    echo "pawd_${fingerprint}" > "$device_id_file"
    dim "  Device ID: pawd_${fingerprint}"
  fi

  # Fix ownership
  if is_root && [[ "${PAWD_USER}" != "root" ]]; then
    chown -R "${PAWD_USER}:${PAWD_USER}" "$key_dir" "$device_id_file" 2>/dev/null || true
  fi

  success "Device identity generated"
}

provision_subdomain() {
  step "10/12" "Provisioning subdomain"

  if [[ "${SKIP_SUBDOMAIN}" == "true" ]]; then
    info "Skipping subdomain provisioning (--skip-subdomain)"
    return 0
  fi

  # Load Supabase credentials from ~/.pawd/.env if not already set
  if [[ -z "$SUPABASE_URL" || -z "$SUPABASE_ANON_KEY" ]] && [[ -f "${ENV_FILE}" ]]; then
    [[ -z "$SUPABASE_URL" ]] && SUPABASE_URL="$(grep -E '^SUPABASE_URL=' "${ENV_FILE}" | head -1 | sed 's/^SUPABASE_URL=//' | sed 's/^["'\'']//' | sed 's/["'\'']$//')"
    [[ -z "$SUPABASE_ANON_KEY" ]] && SUPABASE_ANON_KEY="$(grep -E '^SUPABASE_ANON_KEY=' "${ENV_FILE}" | head -1 | sed 's/^SUPABASE_ANON_KEY=//' | sed 's/^["'\'']//' | sed 's/["'\'']$//')"
  fi

  if [[ -z "$SUPABASE_URL" || -z "$SUPABASE_ANON_KEY" ]]; then
    warn "SUPABASE_URL or SUPABASE_ANON_KEY not set — skipping subdomain provisioning"
    info "Set them in ~/.pawd/.env or as environment variables to enable subdomain provisioning"
    return 0
  fi

  if [[ -n "$DOMAIN" ]]; then
    info "Custom domain provided — skipping subdomain provisioning"
    return 0
  fi

  local device_id_file="${CONFIG_DIR}/device-id"
  local subdomain_file="${CONFIG_DIR}/subdomain"

  # Check for existing subdomain
  if [[ -f "$subdomain_file" ]]; then
    local existing_subdomain
    existing_subdomain="$(cat "$subdomain_file")"
    info "Existing subdomain: ${existing_subdomain}"
    DOMAIN="${existing_subdomain}"
    success "Using existing subdomain"
    return 0
  fi

  if [[ ! -f "$device_id_file" ]]; then
    warn "No device ID found — cannot provision subdomain"
    return 0
  fi

  local device_id
  device_id="$(cat "$device_id_file")"

  info "Requesting subdomain from Pawd..."

  local response
  response="$(curl -fsSL -X POST "${SUPABASE_URL}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -d "{\"device_id\": \"${device_id}\"}" 2>/dev/null)" || {
    warn "Subdomain provisioning failed — you can set a domain manually later"
    return 0
  }

  # Parse subdomain from JSON response (portable: no jq dependency)
  local subdomain
  subdomain="$(echo "$response" | grep -oE '"subdomain"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"subdomain"\s*:\s*"\([^"]*\)".*/\1/')"

  if [[ -z "$subdomain" ]]; then
    # Try alternative field name
    subdomain="$(echo "$response" | grep -oE '"domain"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"domain"\s*:\s*"\([^"]*\)".*/\1/')"
  fi

  if [[ -n "$subdomain" ]]; then
    echo "$subdomain" > "$subdomain_file"
    DOMAIN="$subdomain"
    success "Subdomain provisioned: ${subdomain}"
  else
    warn "Could not parse subdomain from response"
    dim "  Response: ${response}"
  fi
}

setup_nginx() {
  step "11/12" "Setting up Nginx reverse proxy"

  if [[ "${SKIP_NGINX}" == "true" ]]; then
    info "Skipping Nginx setup (--skip-nginx)"
    return 0
  fi

  local nginx_script="${INSTALL_DIR}/apps/bridge/scripts/install-nginx-bridge.sh"

  if [[ ! -f "$nginx_script" ]]; then
    warn "Nginx install script not found at ${nginx_script}"
    warn "Skipping Nginx setup — configure manually if needed"
    return 0
  fi

  info "Delegating to install-nginx-bridge.sh..."

  local nginx_args=("--bridge-port" "${PORT}")
  [[ -n "$DOMAIN" ]] && nginx_args+=("--domain" "$DOMAIN")

  if is_root; then
    bash "$nginx_script" "${nginx_args[@]}" || {
      warn "Nginx setup encountered errors — the bridge will still work on localhost:${PORT}"
      return 0
    }
  else
    if command_exists sudo; then
      sudo bash "$nginx_script" "${nginx_args[@]}" || {
        warn "Nginx setup failed (may need root). Run manually:"
        dim "  sudo bash ${nginx_script} ${nginx_args[*]}"
        return 0
      }
    else
      warn "Nginx setup requires root. Run manually:"
      dim "  sudo bash ${nginx_script} ${nginx_args[*]}"
      return 0
    fi
  fi

  # SSL via certbot
  if [[ "${SKIP_SSL}" == "true" ]]; then
    info "Skipping SSL setup (--skip-ssl)"
  elif [[ -n "$DOMAIN" ]]; then
    if command_exists certbot; then
      info "Requesting SSL certificate for ${DOMAIN}..."
      local certbot_cmd=(certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos)

      # Add email if available, otherwise use register-unsafely-without-email
      certbot_cmd+=(--register-unsafely-without-email)

      if is_root; then
        "${certbot_cmd[@]}" || warn "Certbot failed — set up SSL manually: sudo certbot --nginx -d ${DOMAIN}"
      else
        sudo "${certbot_cmd[@]}" 2>/dev/null || warn "Certbot failed — set up SSL manually: sudo certbot --nginx -d ${DOMAIN}"
      fi
    else
      warn "certbot not found — install it for HTTPS:"
      dim "  sudo apt install certbot python3-certbot-nginx   # Debian/Ubuntu"
      dim "  sudo dnf install certbot python3-certbot-nginx   # Fedora"
      dim "  brew install certbot                             # macOS"
    fi
  else
    info "No domain set — skipping SSL"
  fi

  success "Nginx setup complete"
}

start_bridge() {
  step "12/12" "Starting Pawd bridge"

  local bridge_dir="${INSTALL_DIR}/apps/bridge"

  # Source .env for the bridge process
  local env_args=()
  if [[ -f "$ENV_FILE" ]]; then
    while IFS='=' read -r key value; do
      [[ "$key" =~ ^#.*$ ]] && continue
      [[ -z "$key" ]] && continue
      env_args+=("${key}=${value}")
    done < "$ENV_FILE"
  fi

  # Ensure DATA_DIR and AGENT_WORKSPACES_DIR are set
  local has_data_dir=false
  for arg in "${env_args[@]:-}"; do
    [[ "$arg" == DATA_DIR=* ]] && has_data_dir=true
  done
  if [[ "$has_data_dir" == "false" ]]; then
    env_args+=("DATA_DIR=${RUNTIME_DIR}/data")
    env_args+=("AGENT_WORKSPACES_DIR=${RUNTIME_DIR}/workspaces")
  fi

  # Try systemd (Linux)
  if [[ "$OS" == "linux" ]] && command_exists systemctl; then
    setup_systemd_service "${env_args[@]}"
    return 0
  fi

  # Try launchd (macOS)
  if [[ "$OS" == "macos" ]]; then
    setup_launchd_service
    return 0
  fi

  # Fallback: nohup
  start_with_nohup "${bridge_dir}" "${env_args[@]}"
}

setup_systemd_service() {
  local env_args=("$@")
  local service_file="/etc/systemd/system/pawd-bridge.service"
  local run_user="${PAWD_USER:-$(whoami)}"
  local node_path
  node_path="$(which node)"

  # Build Environment lines
  local env_lines=""
  for arg in "${env_args[@]}"; do
    env_lines+="Environment=\"${arg}\"\n"
  done

  local service_content
  service_content="$(cat << UNIT
[Unit]
Description=Pawd Bridge Server
After=network.target

[Service]
Type=simple
User=${run_user}
WorkingDirectory=${INSTALL_DIR}/apps/bridge
ExecStart=${node_path} dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=append:${RUNTIME_DIR}/logs/bridge.log
StandardError=append:${RUNTIME_DIR}/logs/bridge.err
$(echo -e "$env_lines")

[Install]
WantedBy=multi-user.target
UNIT
)"

  if is_root; then
    echo "$service_content" > "$service_file"
  elif command_exists sudo; then
    echo "$service_content" | sudo tee "$service_file" > /dev/null
  else
    warn "Cannot write systemd service (not root). Falling back to nohup."
    start_with_nohup "${INSTALL_DIR}/apps/bridge" "${env_args[@]}"
    return 0
  fi

  if is_root; then
    systemctl daemon-reload
    systemctl enable pawd-bridge
    systemctl restart pawd-bridge
  else
    sudo systemctl daemon-reload
    sudo systemctl enable pawd-bridge
    sudo systemctl restart pawd-bridge
  fi

  success "Bridge started via systemd"
  dim "  Logs:    journalctl -u pawd-bridge -f"
  dim "  Status:  systemctl status pawd-bridge"
}

setup_launchd_service() {
  local plist_dir="${HOME}/Library/LaunchAgents"
  local plist_file="${plist_dir}/app.pawd.bridge.plist"
  local node_path
  node_path="$(which node)"

  mkdir -p "$plist_dir"

  # Build environment dict entries
  local env_dict=""
  if [[ -f "$ENV_FILE" ]]; then
    while IFS='=' read -r key value; do
      [[ "$key" =~ ^#.*$ ]] && continue
      [[ -z "$key" ]] && continue
      env_dict+="      <key>${key}</key>\n      <string>${value}</string>\n"
    done < "$ENV_FILE"
  fi

  cat > "$plist_file" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>app.pawd.bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node_path}</string>
    <string>${INSTALL_DIR}/apps/bridge/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${INSTALL_DIR}/apps/bridge</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DATA_DIR</key>
    <string>${RUNTIME_DIR}/data</string>
    <key>AGENT_WORKSPACES_DIR</key>
    <string>${RUNTIME_DIR}/workspaces</string>
    <key>PORT</key>
    <string>${PORT}</string>
$(echo -e "$env_dict")  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${RUNTIME_DIR}/logs/bridge.log</string>
  <key>StandardErrorPath</key>
  <string>${RUNTIME_DIR}/logs/bridge.err</string>
</dict>
</plist>
PLIST

  # Unload if already loaded (idempotent)
  launchctl bootout "gui/$(id -u)/app.pawd.bridge" 2>/dev/null || true

  launchctl bootstrap "gui/$(id -u)" "$plist_file" 2>/dev/null \
    || launchctl load "$plist_file" 2>/dev/null \
    || {
      warn "launchctl bootstrap failed — starting with nohup fallback"
      start_with_nohup "${INSTALL_DIR}/apps/bridge"
      return 0
    }

  success "Bridge started via launchd"
  dim "  Logs:    tail -f ${RUNTIME_DIR}/logs/bridge.log"
  dim "  Stop:    launchctl bootout gui/$(id -u)/app.pawd.bridge"
}

start_with_nohup() {
  local bridge_dir="$1"
  shift
  local env_args=("$@")

  info "Starting bridge with nohup..."
  local log_file="${RUNTIME_DIR}/logs/bridge.log"

  (
    cd "$bridge_dir"
    for arg in "${env_args[@]:-}"; do
      export "${arg?}"
    done
    nohup node dist/index.js >> "$log_file" 2>&1 &
    echo $! > "${RUNTIME_DIR}/bridge.pid"
  )

  success "Bridge started in background (PID: $(cat "${RUNTIME_DIR}/bridge.pid" 2>/dev/null || echo '?'))"
  dim "  Logs: tail -f ${log_file}"
  dim "  Stop: kill \$(cat ${RUNTIME_DIR}/bridge.pid)"
}

health_check() {
  info "Running health check..."
  local retries=5
  local delay=2
  local url="http://127.0.0.1:${PORT}/api/status"

  for i in $(seq 1 $retries); do
    if curl -fsSL "$url" -o /dev/null 2>/dev/null; then
      success "Bridge is healthy (${url})"
      return 0
    fi
    dim "  Waiting for bridge to start... (${i}/${retries})"
    sleep "$delay"
  done

  warn "Health check failed after ${retries} attempts."
  warn "The bridge may still be starting. Check logs at ${RUNTIME_DIR}/logs/bridge.log"
}

print_summary() {
  echo ""
  printf "${GREEN}${BOLD}"
  cat << 'DONE'

  ╔══════════════════════════════════════════╗
  ║       Pawd Bridge - Installed!           ║
  ╚══════════════════════════════════════════╝

DONE
  printf "${RESET}"

  echo "  Configuration"
  dim "    Install dir:    ${INSTALL_DIR}"
  dim "    Config dir:     ${CONFIG_DIR}"
  dim "    Runtime dir:    ${RUNTIME_DIR}"
  dim "    Env file:       ${ENV_FILE}"
  dim "    Bridge port:    ${PORT}"
  [[ -n "$DOMAIN" ]] && dim "    Domain:         ${DOMAIN}"

  echo ""
  echo "  Quick commands"
  dim "    pawd status          Check bridge status"
  dim "    pawd logs            View bridge logs"
  dim "    pawd restart         Restart the bridge"
  echo ""

  if [[ -n "$DOMAIN" ]]; then
    local proto="http"
    if [[ "${SKIP_SSL}" != "true" ]] && command_exists certbot; then
      proto="https"
    fi
    info "Bridge accessible at: ${proto}://${DOMAIN}"
  else
    info "Bridge accessible at: http://localhost:${PORT}"
  fi

  echo ""
  dim "  Documentation: https://pawd.app/docs"
  dim "  Issues:        https://github.com/pawd-app/pawd/issues"
  echo ""
}

# ── Main ───────────────────────────────────────────────────────────────────────

main() {
  setup_colors
  banner
  parse_args "$@"

  check_prerequisites
  setup_node
  create_service_user
  setup_directories
  clone_or_download
  build_project
  persist_credentials
  install_claude_code
  generate_device_identity
  provision_subdomain
  setup_nginx
  start_bridge
  health_check
  print_summary
}

main "$@"
