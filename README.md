# Zed Money offers

Every day GitHub Actions here collects the published card and wallet offers of
Bangladesh's banks and mobile wallets (bKash, City Bank, BRAC, EBL, MTB,
Standard Chartered, LankaBangla and 30+ more), politely and within each site's
robots.txt, and publishes them to the `data` branch as `catalogue.json.gz`.
The Zed Money website and apps download that file — nothing to deploy.

Only the collector lives here (copied from the app's repo by
`scripts/sync-offer-collector.mjs`). No keys, no user data.
