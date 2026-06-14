#!/usr/bin/env bash
# CRE MIRROR — corre el workflow CRE en loop (SIN --broadcast, read-only).
# Muestra lo que el gemelo descentralizado DECIDIRÍA, en paralelo al bot Node
# que ejecuta de verdad. No toca la cadena (solo lectura + quote).
export PATH="$HOME/.cre/bin:$HOME/.bun/bin:$PATH"
cd "$(dirname "$0")"
i=0
while true; do
  i=$((i+1))
  echo ""
  echo "════════ CRE MIRROR · tick #$i · $(date -u +%H:%M:%S)Z ════════"
  cre workflow simulate ./tick --target=production-settings 2>&1 \
    | grep -E '\[USER LOG\]' | sed -E 's/.*\[USER LOG\] \[cre-tick\] /  /'
  sleep 8
done
