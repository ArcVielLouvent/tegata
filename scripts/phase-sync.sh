#!/usr/bin/env bash
#
# phase-sync.sh — keep GitHub Issues in sync with Tegata build phases.
#
# Requires: GitHub CLI (`gh`) authenticated. In a GitHub Codespace this is
# already configured for you.
#
# Usage:
#   ./scripts/phase-sync.sh <phase-number> start   # open/reopen issue, mark in-progress
#   ./scripts/phase-sync.sh <phase-number> done    # close issue, mark done, comment summary
#   ./scripts/phase-sync.sh status                 # print a status table for all phases
#
set -euo pipefail

PHASES=(
  "0:Repo Foundation"
  "1:Risk Engine + State Machine"
  "2:Conditional Document (Doctavian)"
  "3:Signature & Verification (Foxit)"
  "4:AI Front-Door (Two-Pass NLU)"
  "5:Auto-Expire & Audit Trail"
  "6:Frontend Demo"
  "7:Stretch Features"
  "8:Documentation & Submission"
)

phase_title() {
  local num="$1"
  for entry in "${PHASES[@]}"; do
    local p="${entry%%:*}"
    local title="${entry#*:}"
    if [[ "$p" == "$num" ]]; then
      echo "$title"
      return 0
    fi
  done
  echo ""
  return 1
}

ensure_gh() {
  if ! command -v gh &>/dev/null; then
    echo "Error: GitHub CLI ('gh') not found. Install it or run this inside a Codespace." >&2
    exit 1
  fi
}

find_issue_number() {
  local phase_num="$1"
  gh issue list --label "phase:${phase_num}" --state all --json number --jq '.[0].number // empty'
}

create_issue() {
  local phase_num="$1"
  local title
  title="$(phase_title "$phase_num")"
  if [[ -z "$title" ]]; then
    echo "Error: unknown phase number '$phase_num'." >&2
    exit 1
  fi
  gh label create "phase:${phase_num}" --color "0e8a16" --force >/dev/null 2>&1 || true
  gh label create "status:in-progress" --color "fbca04" --force >/dev/null 2>&1 || true
  gh label create "status:done" --color "5319e7" --force >/dev/null 2>&1 || true
  gh issue create \
    --title "Phase ${phase_num}: ${title}" \
    --body "Tracking issue for Phase ${phase_num} (${title}). See ROADMAP.md for scope and done-when criteria." \
    --label "phase:${phase_num}" \
    --label "status:in-progress"
}

cmd_start() {
  local phase_num="$1"
  ensure_gh
  local issue_num
  issue_num="$(find_issue_number "$phase_num")"
  if [[ -z "$issue_num" ]]; then
    echo "No existing issue for phase ${phase_num}, creating one..."
    create_issue "$phase_num"
    return 0
  fi
  gh issue reopen "$issue_num" >/dev/null 2>&1 || true
  gh issue edit "$issue_num" --remove-label "status:done" --add-label "status:in-progress" >/dev/null 2>&1 || true
  echo "Phase ${phase_num} (#${issue_num}) marked in-progress."
}

cmd_done() {
  local phase_num="$1"
  ensure_gh
  local issue_num
  issue_num="$(find_issue_number "$phase_num")"
  if [[ -z "$issue_num" ]]; then
    echo "Error: no issue found for phase ${phase_num}. Run 'start' first." >&2
    exit 1
  fi
  gh issue edit "$issue_num" --remove-label "status:in-progress" --add-label "status:done" >/dev/null 2>&1 || true
  gh issue comment "$issue_num" --body "Phase ${phase_num} marked done via phase-sync.sh." >/dev/null 2>&1 || true
  gh issue close "$issue_num" >/dev/null 2>&1 || true
  echo "Phase ${phase_num} (#${issue_num}) closed and marked done."
}

cmd_status() {
  ensure_gh
  printf "%-6s %-32s %-10s %s\n" "PHASE" "TITLE" "ISSUE" "STATE"
  for entry in "${PHASES[@]}"; do
    local p="${entry%%:*}"
    local title="${entry#*:}"
    local issue_num
    issue_num="$(find_issue_number "$p" || true)"
    if [[ -z "$issue_num" ]]; then
      printf "%-6s %-32s %-10s %s\n" "$p" "$title" "-" "not created"
    else
      local state
      state="$(gh issue view "$issue_num" --json state,labels --jq '.state + " (" + ([.labels[].name] | join(",")) + ")"')"
      printf "%-6s %-32s %-10s %s\n" "$p" "$title" "#${issue_num}" "$state"
    fi
  done
}

main() {
  if [[ $# -eq 1 && "$1" == "status" ]]; then
    cmd_status
    exit 0
  fi
  if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <phase-number> <start|done>" >&2
    echo "       $0 status" >&2
    exit 1
  fi
  local phase_num="$1"
  local action="$2"
  case "$action" in
    start) cmd_start "$phase_num" ;;
    done) cmd_done "$phase_num" ;;
    *)
      echo "Error: unknown action '$action'. Use 'start' or 'done'." >&2
      exit 1
      ;;
  esac
}

main "$@"
