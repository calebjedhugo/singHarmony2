#!/bin/bash
# Build and deploy singHarmony2 to sing-harmony-beta.calebhugo.com
set -euo pipefail
cd "$(dirname "$0")"

PI_HOST="chugo@hugopi"
WEBROOT="/var/www/sing-harmony-beta.calebhugo.com"

npm run build
rsync -avz --delete dist/ "$PI_HOST:$WEBROOT/"
echo "Deployed. Verify: curl -sI https://sing-harmony-beta.calebhugo.com | head -3"
