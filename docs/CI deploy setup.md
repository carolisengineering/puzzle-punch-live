# CI deploy setup

`.github/workflows/deploy.yml` runs `scripts/deploy.sh` on every push to `main` (a merged PR is a
push). It runs the unit and Firestore-rules tests first, then deploys Hosting plus Firestore rules
and indexes. Pushes that only touch `docs/` or `*.md` do not deploy. The release label comes out as
`PUZZLE PUNCH v<version> @ <sha>`, same as a manual deploy.

`.github/workflows/test.yml` runs the same tests on every pull request, so a break shows before the
merge. The CLI is pinned in `package.json` (`firebase-tools`), so a new release cannot break a deploy.

It needs one secret: a service account key that may deploy. Set it up once.

## 1. Create the service account

    gcloud config set project puzzle-punch
    gcloud iam service-accounts create github-deploy --display-name "GitHub Actions deploy"

Grant it only what the deploy touches:

    SA=github-deploy@puzzle-punch.iam.gserviceaccount.com
    for role in roles/firebasehosting.admin roles/firebaserules.admin roles/datastore.indexAdmin roles/serviceusage.apiKeysViewer roles/serviceusage.serviceUsageConsumer; do
      gcloud projects add-iam-policy-binding puzzle-punch --member "serviceAccount:$SA" --role "$role"
    done

If the first CI run fails with a permission error, the message names the missing permission; add the
role that carries it. Avoid `roles/editor` or `roles/owner`.

## 2. Make a key and store it as a secret

    gcloud iam service-accounts keys create "$TMPDIR/sa.json" --iam-account "$SA"
    gh secret set FIREBASE_SERVICE_ACCOUNT < "$TMPDIR/sa.json"
    rm "$TMPDIR/sa.json"

The key is a long-lived credential. Rotate it now and then (create a new key, update the secret,
delete the old key). Your org may block key creation; then use Workload Identity Federation instead
(`google-github-actions/auth` with a workload identity provider) and drop the "Write credentials" step.

## 3. Use it

Merge a PR into `main`; the Actions tab shows the run. Run it by hand from Actions → Deploy →
Run workflow. Deploying from your machine still works (`scripts/deploy.sh`) but is no longer the
normal path.

## Recommended: protect main

Settings → Branches → add a rule for `main`: require a pull request before merging, and require the
`test` status check (from `test.yml`) to pass. Then nothing reaches `main` (and so production)
without a PR and green tests. Until this is set, a direct push to `main` deploys.

## Rolling back

Firebase console → Hosting → Release history → the earlier release → Rollback. This is instant and
does not touch Firestore rules; revert the commit on `main` for those.
