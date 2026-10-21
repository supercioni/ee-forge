#!/usr/bin/env bash
# Put an ISOLATED EmptyEpsilon clone back to "no Forge project installed": removes the files Forge installed for the template-ship
# projects, the ledger and the require lines. Refuses anything that is not under C:\ForgeCollaudo\T (the test clones).
#   scripts/template-ship/reset-clone.sh /mnt/c/ForgeCollaudo/T/e26
set -euo pipefail
clone="${1:?clone folder}"
case "$(realpath "$clone")" in /mnt/c/ForgeCollaudo/T/*) ;; *) echo "refusing: $clone is not a test clone" >&2; exit 2;; esac
scripts="$clone/scripts"
rm -f "$scripts"/ship_test_* "$scripts"/scenario_ship_test_* "$scripts"/shiptemplates/ship_test_* "$scripts"/.ee-forge-ledger.json
rm -rf "$clone/.ee-forge-backups"
sed -i '/ship_test_/d;/EE FORGE generated templates/d' "$scripts/shipTemplates.lua"
echo "reset $clone: $(ls "$scripts" | grep -c "ship_test_") project files left; shipTemplates.lua ends with: $(tail -n1 "$scripts/shipTemplates.lua")"
