#!/usr/bin/env bash
# TradeHub AI — one-command startup
# Usage: bash start.sh

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${CYAN}[tradehub]${NC} $*"; }
success() { echo -e "${GREEN}[tradehub]${NC} $*"; }
warn()    { echo -e "${YELLOW}[tradehub]${NC} $*"; }
error()   { echo -e "${RED}[tradehub]${NC} $*"; exit 1; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

echo ""
echo -e "${CYAN}  ╔══════════════════════════════════╗"
echo -e "  ║     TradeHub AI  ⚡  v1.0.0      ║"
echo -e "  ║  Lead Intelligence Platform      ║"
echo -e "  ╚══════════════════════════════════╝${NC}"
echo ""

# ── Check .env ────────────────────────────────────────────────────────────────
if [ ! -f "$BACKEND_DIR/.env" ]; then
  if [ -f "$BACKEND_DIR/.env.example" ]; then
    cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
    warn ".env not found — copied from .env.example"
    warn "Please edit backend/.env and add your GEMINI_API_KEY"
  else
    error "backend/.env not found. Create it from backend/.env.example"
  fi
fi

# ── Python venv ───────────────────────────────────────────────────────────────
info "Setting up Python environment..."
if [ ! -d "$BACKEND_DIR/venv" ]; then
  python3 -m venv "$BACKEND_DIR/venv" || error "Failed to create virtualenv. Install python3-venv."
  success "Created virtualenv"
fi

source "$BACKEND_DIR/venv/bin/activate"
info "Installing Python dependencies..."
pip install -q --upgrade pip
pip install -q -r "$BACKEND_DIR/requirements.txt"
success "Python dependencies installed"

# ── Frontend deps ────────────────────────────────────────────────────────────
info "Installing frontend dependencies..."
cd "$FRONTEND_DIR"
if command -v pnpm &>/dev/null; then
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
elif command -v npm &>/dev/null; then
  npm install --prefer-offline 2>/dev/null || npm install
else
  error "Neither npm nor pnpm found. Install Node.js 18+."
fi
success "Frontend dependencies installed"

# ── Credentials dir ──────────────────────────────────────────────────────────
mkdir -p "$BACKEND_DIR/credentials"

# ── Start both servers ───────────────────────────────────────────────────────
info "Starting backend (port 8000)..."
cd "$BACKEND_DIR"
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload --log-level info &
BACKEND_PID=$!

sleep 2  # give backend a moment to bind

info "Starting frontend (port 5173)..."
cd "$FRONTEND_DIR"
if command -v pnpm &>/dev/null; then
  pnpm dev &
else
  npm run dev &
fi
FRONTEND_PID=$!

success ""
success "  🚀  Backend  → http://localhost:8000"
success "  🎨  Frontend → http://localhost:5173"
success "  📚  API Docs → http://localhost:8000/docs"
echo ""
warn "Press Ctrl+C to stop both servers"
echo ""

# Graceful shutdown on Ctrl+C
trap 'info "Stopping servers..."; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0' INT TERM

wait
